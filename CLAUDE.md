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
