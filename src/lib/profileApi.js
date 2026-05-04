// lib/profileApi.js
// Reads and writes for the per-user profile row. Only file in the
// codebase that knows real `profiles` column names.
//
// Schema this file is paired with (see reconciliation SQL):
//   public.profiles
//     id                          uuid PK = auth.uid()
//     email                       text
//     birthday_month              smallint
//     birthday_day                smallint
//     birthday_year               smallint
//     birthday_reminders_enabled  boolean default true
//     birthday_prompt_dismissed   boolean default false   ← canonical skip flag
//     onboarding_completed        boolean default false   ← legacy mirror
//     created_at, updated_at      timestamptz
//
// `birthday_prompt_dismissed` is the canonical name per the spec.
// We mirror writes to `onboarding_completed` so any code or report
// that still queries the legacy name keeps reading the same value.

import { supabase } from './supabase.js'

const rowToProfile = (row) => ({
  id: row.id,
  email: row.email || null,
  birthdayMonth: row.birthday_month,
  birthdayDay: row.birthday_day,
  birthdayYear: row.birthday_year,
  birthdayRemindersEnabled: !!row.birthday_reminders_enabled,
  // Prefer the canonical column; fall back to onboarding_completed
  // so a row written before the rename still loads correctly.
  birthdayPromptDismissed: !!(
    row.birthday_prompt_dismissed ?? row.onboarding_completed
  ),
  onboardingCompleted: !!(
    row.onboarding_completed ?? row.birthday_prompt_dismissed
  ),
})

const logErr = (label, err, extra = {}) => {
  console.error(`[${label}]`, {
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    ...extra,
    error: err,
  })
}

export const fetchProfile = async (userId) => {
  if (!userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    logErr('fetchProfile', error, { userId })
    throw error
  }
  if (!data) return null
  return rowToProfile(data)
}

// Insert-or-update the profile row for `userId`. Always sends every
// column the schema cares about so the row stays whole on first
// insert. `userEmail` is captured here (not from the row) because
// email lives on auth.users — the profiles row mirrors it for easy
// joins/exports.
export const upsertProfile = async (userId, userEmail, updates) => {
  if (!userId) throw new Error('upsertProfile: userId is required')

  const dismissed = !!updates.birthdayPromptDismissed
  const completed = !!(updates.onboardingCompleted ?? dismissed)

  const payload = {
    id: userId,
    email: userEmail || null,
    birthday_month: updates.birthdayMonth ?? null,
    birthday_day: updates.birthdayDay ?? null,
    birthday_year: updates.birthdayYear ?? null,
    birthday_reminders_enabled: !!updates.birthdayRemindersEnabled,
    birthday_prompt_dismissed: dismissed,
    onboarding_completed: completed,
  }

  console.log('[upsertProfile] payload →', payload)

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()

  if (error) {
    logErr('upsertProfile', error, { payload })
    throw error
  }
  return rowToProfile(data)
}
