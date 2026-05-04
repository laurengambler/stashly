// lib/profileApi.js
// Reads and upserts the per-user profile row.
//
// Schema this file is paired with (see PROFILES_RECONCILE_SQL.md):
//   public.profiles
//     id          uuid primary key references auth.users(id) on delete cascade
//     birthday_month  smallint
//     birthday_day    smallint
//     birthday_year   smallint
//     birthday_reminders_enabled boolean not null default true
//     onboarding_completed       boolean not null default false
//     created_at, updated_at timestamptz
//
// The PK column is `id` and equals auth.uid(). RLS policies use
// `auth.uid() = id`, which means the upsert below is allowed for the
// signed-in user without any extra wiring.

import { supabase } from './supabase.js'

// Database row → in-memory profile shape the React components use.
const rowToProfile = (row) => ({
  id: row.id,
  birthdayMonth: row.birthday_month,
  birthdayDay: row.birthday_day,
  birthdayYear: row.birthday_year,
  birthdayRemindersEnabled: !!row.birthday_reminders_enabled,
  onboardingCompleted: !!row.onboarding_completed,
})

export const fetchProfile = async (userId) => {
  if (!userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    // Surface the full PostgREST error object so we can see exactly
    // why a fetch failed (column missing? RLS?) without having to
    // poke around the network tab.
    console.error('[fetchProfile]', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      error,
    })
    throw error
  }
  if (!data) return null
  return rowToProfile(data)
}

// Insert-or-update the profile row for `userId`. `updates` is the
// partial in-memory shape (camelCase). We always send the full row
// payload because upsert needs every NOT NULL column on insert; on
// update, the same payload just rewrites the values that changed.
export const upsertProfile = async (userId, updates) => {
  if (!userId) throw new Error('upsertProfile: userId is required')

  const payload = {
    id: userId,
    birthday_month: updates.birthdayMonth ?? null,
    birthday_day: updates.birthdayDay ?? null,
    birthday_year: updates.birthdayYear ?? null,
    birthday_reminders_enabled: !!updates.birthdayRemindersEnabled,
    onboarding_completed: !!updates.onboardingCompleted,
  }

  // Diagnostic — temporarily logs every outbound profile write so a
  // schema mismatch shows up immediately in the browser console.
  console.log('[upsertProfile] payload →', payload)

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single()

  if (error) {
    console.error('[upsertProfile]', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      payload,
      error,
    })
    throw error
  }
  return rowToProfile(data)
}
