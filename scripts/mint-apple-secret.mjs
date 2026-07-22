// scripts/mint-apple-secret.mjs
// Mints the Apple "client secret" JWT that Supabase's Apple provider needs
// for the OAuth / identity-linking flow. This secret is signed from your
// Sign in with Apple key (.p8) and expires after ~6 months — re-run this
// to regenerate.
//
// USAGE:
//   node scripts/mint-apple-secret.mjs /full/path/to/AuthKey_VFTZVXY75Z.p8
//
// It prints ONE long line — that whole line is the secret. Paste it into
// Supabase → Authentication → Providers → Apple → "Secret Key (for OAuth)".
//
// The .p8 is read locally and never leaves your machine. Zero npm deps.

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

// Your Apple identifiers (not secret — safe to keep in the repo).
const TEAM_ID = 'UHRWW3699Q'
const KEY_ID = 'VFTZVXY75Z'
const SERVICES_ID = 'com.getstashly.app.web'

const p8Path = process.argv[2]
if (!p8Path) {
  console.error('Usage: node scripts/mint-apple-secret.mjs /path/to/AuthKey_XXXX.p8')
  process.exit(1)
}

const privateKey = readFileSync(p8Path, 'utf8')

const b64url = (v) =>
  Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

const now = Math.floor(Date.now() / 1000)
const header = { alg: 'ES256', kid: KEY_ID }
const payload = {
  iss: TEAM_ID,
  iat: now,
  exp: now + 15777000, // ~6 months — Apple's maximum
  aud: 'https://appleid.apple.com',
  sub: SERVICES_ID,
}

const signingInput = `${b64url(header)}.${b64url(payload)}`
// ES256 JWTs need the raw R||S signature (ieee-p1363), not DER.
const signature = createSign('SHA256')
  .update(signingInput)
  .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
  .toString('base64url')

console.log(`${signingInput}.${signature}`)
