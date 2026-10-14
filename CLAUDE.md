# Stashly — project rules

## Privacy and data-collection review

**Whenever we add, change, or integrate anything that collects, stores,
transmits, or connects user data — including any new SDK, library, API,
analytics tool, or third-party service — STOP before proceeding and walk
through these five points:**

1. **What data it touches.** What is collected, stored, or sent.
2. **Where it goes.** Stays on the device, hits our backend, or goes to a
   third party — and which one.
3. **Consent.** Whether it needs user consent, and if so, whether we have a
   specific consent prompt for it.
4. **Privacy policy.** Whether the policy still covers it. If not, say so
   plainly: the policy needs updating *before shipping*.
5. **App Store privacy label.** Whether the label is still accurate. If not,
   say exactly what needs to change.

**Do not let a data-touching feature ship without this walkthrough.** If a
dependency collects more than was asked for, call it out even when nobody
asked.

### What counts as data-touching

Not just obvious features. All of these trigger the review:

- A new analytics event, or a new **property** on an existing event — a
  property is where a card number or an email address slips out.
- Any new npm or Swift dependency, including transitive ones. A dependency
  can collect without the app calling it.
- A new column, table or bucket in Supabase.
- Moving data between device and server **in either direction**.
- Logging. `console.log` of a payload object has already put card numbers
  and PINs into production logs here once.
- Anything that makes a network request to a host we do not control.

### Current data inventory

Baseline, so the review has something to compare against. Verified
2026-10-13; re-verify rather than trust it.

| Data | Where it lives | Notes |
|---|---|---|
| Card number, PIN, access code, balances, notes, transactions | Supabase Postgres | RLS: every policy is `auth.uid() = user_id`. No cross-user read path. |
| Card photos | Device only, IndexedDB | Only the photo **ID** syncs. No Supabase Storage anywhere. |
| Email, auth identity | Supabase Auth | Email + Sign in with Apple. |
| Product analytics | PostHog | `autocapture: false`, `disable_session_recording: true`. Events carry IDs, enums, booleans and counts — never a card number, PIN or barcode value. |
| Scanned card text | Device only | Apple Vision / VisionKit. Recognition is entirely on-device; images are not uploaded. |

Known gaps to raise when relevant:

- **PINs are plaintext columns in Postgres.** Device-only storage is built
  and tested but switched off (`pinsAreDeviceOnly()` in `lib/pinStorage.js`).
  Turning it on is a data migration and needs its own release.
- `merchant_unmatched` sends a **user-typed merchant name**, normalized and
  length-capped. It is the only user-authored string that leaves the device.
- `IONCameraLib.framework` (via `@capacitor/camera`) ships **no
  `PrivacyInfo.xcprivacy`** and references file-timestamp APIs
  (`NSURLCreationDateKey`). That is a required-reason API and can trigger
  ITMS-91053 on upload.

### Why this rule exists

Three things have already gone wrong here that this review would have
caught: card numbers and PINs written to the production console; session
replay left to a dashboard toggle that would have recorded card photos; and
PINs made device-only on the web, where Safari evicts the store after seven
days.

## Release checklist

Before any App Store submission, work through this and report the result of
each — don't assume, check:

1. **Every new feature fully wired.** Trace each one end to end: native
   emits it, JS consumes it, the component is imported and rendered, the
   CSS classes it uses exist. No half-built code, no stubs, no `TODO`.
2. **Debug flags off.** `ScanLog.enabled` must be `false` — it prints real
   card numbers and PINs to the Xcode console. Check for any other flag
   that should not ship enabled.
3. **Green across the board.** `npm test`, `npm run test:swift`,
   `npm run lint` (0 errors), and a clean Release build with no errors.
   Report any warning and say whether it blocks submission.
4. **Icon sanity.** Every icon in the built bundle must report
   `hasAlpha: no` — the App Store rejects alpha.
5. **Bump version and build number.** Build numbers must be unique within a
   version; a version already released is closed to new builds.
6. **Remind Lauren to test on her phone via TestFlight BEFORE submitting.**
   Say which specific things to exercise. A build cannot be swapped after
   submission without withdrawing it.
7. **Release manually, never automatically.** She controls when it goes
   live.

## Ship small

Prefer shipping a finished feature in a small update over holding it back
to bundle with more. A release that does one thing is easier to test,
easier to write release notes for, and easier to roll back.

When something is not ready, hold that one thing — do not delay the rest of
the release for it. Holding the PIN migration out of 1.3.2 while shipping
the photo-library fix is the pattern to follow.

## Held-back work

**The PIN migration is intentionally off.** `pinsAreDeviceOnly()` in
`src/lib/pinStorage.js` returns `false`, so PINs save to the server exactly
as they always have. The device-only code behind it is written and tested,
just not switched on.

**Do not turn it on without asking.** Turning it on is a data migration
affecting real users' PINs, not a feature flag flip. When it is raised:

- it needs its own release, not a ride-along
- **the App Store privacy label will need updating** — PINs stop being
  collected on the app side
- the 90-day plan to clear the server column must be scoped to app users,
  because the web keeps PINs on the server by design and a blanket delete
  would destroy them

## How I work

Lauren is a solo, non-engineer founder. She owns the product decisions and
does every click herself.

- **Anything in Xcode or App Store Connect gets numbered, click-by-click
  steps.** Name the actual menu, button or field — "Product → Archive", not
  "archive the app". Say what she should expect to see, and roughly how
  long it takes.
- Explain what a thing does before why it is built that way.
- Flag anything irreversible before she does it: submitting a build,
  deleting data, sending an email to users.
- Surface the decisions that are genuinely hers — anything touching user
  data, money, or what users see — rather than quietly picking one.
