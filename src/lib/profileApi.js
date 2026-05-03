// lib/profileApi.js
// Reads and upserts the per-user profile row. The only thing on the
// profile today is the optional birthday + reminders toggle, but it
// lives in its own table so we can grow it without touching cards.

import { supabase } from './supabase.js'

export const fetchProfile = async (userId) => {
  if (!userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    userId: data.user_id,
    birthdayMonth: data.birthday_month,
    birthdayDay: data.birthday_day,
    birthdayYear: data.birthday_year,
    birthdayRemindersEnabled: !!data.birthday_reminders_enabled,
    birthdayPromptDismissed: !!data.birthday_prompt_dismissed,
  }
}

export const upsertProfile = async (userId, updates) => {
  const payload = {
    user_id: userId,
    birthday_month: updates.birthdayMonth ?? null,
    birthday_day: updates.birthdayDay ?? null,
    birthday_year: updates.birthdayYear ?? null,
    birthday_reminders_enabled: !!updates.birthdayRemindersEnabled,
    birthday_prompt_dismissed: !!updates.birthdayPromptDismissed,
  }
  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return {
    userId: data.user_id,
    birthdayMonth: data.birthday_month,
    birthdayDay: data.birthday_day,
    birthdayYear: data.birthday_year,
    birthdayRemindersEnabled: !!data.birthday_reminders_enabled,
    birthdayPromptDismissed: !!data.birthday_prompt_dismissed,
  }
}
