// lib/supabase.js
// Single Supabase client for the whole app. Reads its config from
// Vite env vars, which Vercel injects at build time. The client
// persists sessions to localStorage automatically — that's how
// "stay logged in" works without any extra code.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Surfacing this loudly in the console makes "blank screen on Vercel"
  // bugs much easier to diagnose if env vars haven't been wired up.
  console.error(
    'Supabase env vars missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
