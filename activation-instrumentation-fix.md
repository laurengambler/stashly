# Activation instrumentation fix — reconciliation report

**Scope:** measurement only. No product UI or add-card UX changed. Event
names kept exactly (`card_added`, `card_add_started`, `user_signed_up`).

**Files changed:** `src/lib/auth.jsx`, `src/lib/profileApi.js`, `src/App.jsx`.

---

## BUG 1 — `user_signed_up` over-fired ~3x and fragmented into ~48 people

### Root cause
`user_signed_up` fired inside `signUp()` on the signup **attempt**, whenever
`supabase.auth.signUp()` returned `!error && data.user`. Two consequences:

1. **Over-count.** With email confirmation enabled, `signUp()` returns a
   populated `data.user`:
   - for a brand-new but **unconfirmed** signup (may never confirm), and
   - for an attempt on an **already-registered email** — Supabase returns a
     look-alike success (enumeration protection), not an error.
   So retries, double-taps, and returning users who forgot they had an
   account all emit `user_signed_up`. 65 events / 17 real signups ≈ 3x.
2. **Person fragmentation.** At attempt time there is no session yet
   (`data.session` is null until email confirmation), so `identify()` had not
   run. The event attached to the **anonymous** PostHog person, which is
   per-browser/per-session → 48 distinct `person_id`s for 17 real users.

### Fix
- **`auth.jsx`** — removed the `user_signed_up` call from `signUp()` (it is an
  attempt, not a completion).
- **`profileApi.js`** — added `ensureProfile(userId, email)`: an
  insert-if-absent (`upsert … { ignoreDuplicates: true }`) that returns
  `{ row, created }`. `created` is true **only** when this call actually
  inserted the row — a server-side, once-per-user ledger.
- **`App.jsx` load effect** — on the first authenticated load, when the
  profile fetch succeeds and confirms there is no row yet:
  1. `identifyUser(uid, { email })` runs **first**, so the session (and any
     anonymous pre-signup events) bind to the real auth uid;
  2. `ensureProfile` creates the profile row;
  3. `user_signed_up` fires **once**, only if `ensureProfile` reported
     `created: true`.

`profiles.id = cards.user_id = auth.uid`, so events now join cleanly to the
DB and `user_signed_up` count tracks the `profiles` table.

**Demonstrated (headless Chrome, captured events):**
- New user → exactly **1** `user_signed_up`, `distinct_id = uid` (not
  anonymous), and `identify(uid)` ordered before it.
- Returning user (profile row already exists) → **0** `user_signed_up`.

---

## BUG 2 — `card_added` under-fired ~25% (85 DB cards vs 64 events)

### Root cause
There are exactly **two** code paths that create `cards` rows, and only one
emitted the event:

| Path | Code | Emitted before |
|---|---|---|
| Manual add | `handleAddCard` → `insertCard` | ✅ `card_added` |
| **Legacy import** | `handleMigrate` → `insertManyCards` | ❌ only `local_cards_migrated` (one summary event) |

The migration path bulk-inserts a user's legacy localStorage cards and fired a
single `local_cards_migrated` with a `count`, but **no `card_added` per card**.
Those are real `cards` rows with no activation event → the ~21-card gap
(85 − 64). There is no scan / photo-import / offline-sync creation path; the
missing path was the import/migration one.

### Fix
- **`App.jsx` `handleMigrate`** — after `insertManyCards` succeeds, emit one
  `card_added` per inserted card (kept `local_cards_migrated` for the
  migration-specific dashboard).
- Added a `source` property (`'manual'` | `'migration'`) to `card_added` on
  both paths — **event name unchanged**, so existing dashboards keep working
  while you can now segment activation by path.
- Manual add already fired exactly once, **after** the DB write succeeds
  (inside the `try`, after `insertCard` resolves; skipped on error). No
  double-fire on retry.

**Demonstrated:** 3 migrated cards → exactly **3** `card_added` (source
`migration`) + **1** `local_cards_migrated`; one manual add → exactly **1**
`card_added` (source `manual`). All carry the real uid.

---

## Task 3 — `card_add_started` fires whenever the add-card flow opens

Confirmed correct, no change needed. The only way to open the add form is the
`onAdd` handler in `App.jsx`, which fires `card_add_started` and is wired to
**both** wallet entry points — the header "+" button and the empty-state "Add
your first card" button (`WalletScreen.jsx`). There is no other
`setScreen('add')`. The edit flow uses a separate handler and correctly does
**not** emit `card_add_started`.

**Demonstrated:** opening the form emits exactly one `card_add_started`.

> **North-star definition (decided):** add-card activation counts **only**
> `card_added` where `source = 'manual'`. Migrated cards emit `card_added`
> with `source = 'migration'` for **reconciliation only** and are **excluded**
> from the activation / north-star funnel (they were imported, not created
> through the add-card flow, and have no `card_add_started`). This is noted in
> the code comments at both emit sites.

---

## Task 4 — the 10 `cards.user_id` values with no `profiles` row

### Explanation
Before this change, a `profiles` row was created **only** when a user saved or
skipped the birthday onboarding (`upsertProfile`). A user could confirm, log
in, and add cards while ignoring that prompt → cards but no profile. Combined
with accounts that predate the profiles flow (added after launch) and any test
accounts, that produces the 10 profile-less card owners. **Nothing was deleted
or migrated.**

### Fix (approved)
All 10 are confirmed **real users** (verified against `auth.users` emails) —
none are test accounts. Nothing is deleted.

1. **Going forward (already in this change):** `ensureProfile` runs on every
   user's first authenticated load, so every future card owner gets a profile
   row automatically.
2. **One-time backfill** for the existing 10 — see
   [`db/backfill_missing_profiles.sql`](db/backfill_missing_profiles.sql).
   It is idempotent (`ON CONFLICT DO NOTHING`), additive only, and must be run
   with **service_role** privileges (Supabase SQL editor) — the app's anon key
   cannot and must not do this. **Run it at deploy, BEFORE the new tracking
   goes live**, so these users already have a row (`created:false`) and do not
   emit a spurious `user_signed_up` on their next login.

---

## Reconciliation — how to verify PostHog now matches Supabase

Run these over a recent window (inside both tracked windows: `card_added` since
2026-05-22, `user_signed_up` post-deploy). **Ignore rows older than those dates**
— pre-tracking gaps are expected.

**Signups:**
```sql
-- Supabase: profiles created in window
select count(*) from profiles where created_at >= '<deploy_date>';
```
PostHog: unique `person_id` with `user_signed_up` in the same window. These
should now be **equal** (1 event/person/user), not 3x.

**Card creations (reconciliation — uses ALL `card_added`):**
```sql
-- Supabase: cards created in window
select count(*) from cards where created_at >= '2026-05-22';
```
PostHog: total `card_added` event count (both sources) in the same window.
Should now **match** the cards count. Break down by `properties.source` —
`manual + migration` should reconcile to the table.

**North-star activation (uses ONLY `source = 'manual'`):**
The add-card activation metric is `card_added` filtered to
`properties.source = 'manual'`. **Exclude `source = 'migration'`** — those are
reconciliation-only. So: *reconciliation* = all `card_added` vs `cards` table;
*activation/north-star* = `card_added where source = 'manual'`.

**Per-user spot check (sample 5 recent users):**
```sql
select c.user_id, count(*) as db_cards
from cards c
where c.created_at >= '2026-05-22'
group by c.user_id
order by max(c.created_at) desc
limit 5;
```
For each `user_id`, in PostHog the count of `card_added` where
`distinct_id = user_id` should equal `db_cards`, and there should be exactly
one `user_signed_up` for that `distinct_id`.

---

## Deploy checklist
1. **First**, run [`db/backfill_missing_profiles.sql`](db/backfill_missing_profiles.sql)
   with service_role privileges — BEFORE the new tracking goes live — so the 10
   existing profile-less owners don't emit a one-time spurious `user_signed_up`.
   Confirm step 3 of that script returns 0.
2. Deploy the code change.
3. After ~a few days of data, run the reconciliation queries above and confirm
   PostHog ≈ Supabase: `profiles` ≈ unique `user_signed_up` persons, and `cards`
   ≈ total `card_added`. Track the north-star as `card_added` where
   `source = 'manual'` only.
