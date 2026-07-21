-- backfill_missing_profiles.sql
-- ---------------------------------------------------------------------------
-- One-time backfill: create a profiles row for every card owner that does not
-- have one yet (the ~10 real users identified in the activation instrumentation
-- review — all verified against auth.users, none are test accounts).
--
-- WHY / WHEN: run this ONCE, at deploy, BEFORE the new tracking goes live.
-- The new user_signed_up logic fires exactly once when a profile row is first
-- created (ensureProfile.created === true). Backfilling these existing users
-- first means they already have a row, so they will NOT emit a spurious
-- user_signed_up on their next login.
--
-- PRIVILEGES: must be run with service_role (e.g. the Supabase SQL editor).
-- It reads auth.users and inserts profiles rows for other users, which the
-- app's anon key cannot and must not be able to do.
--
-- SAFETY: idempotent (ON CONFLICT DO NOTHING) and additive only — it never
-- updates or deletes anything. Onboarding is left NOT dismissed, matching what
-- a normal first login would create, so nothing about these users' UX changes.
-- ---------------------------------------------------------------------------

-- 1) PREVIEW — confirm the set before writing (expect the 10 known user_ids).
select distinct c.user_id, u.email
from cards c
join auth.users u on u.id = c.user_id
left join profiles p on p.id = c.user_id
where p.id is null
order by u.email;

-- 2) BACKFILL — create the missing rows.
insert into profiles (
  id,
  email,
  birthday_reminders_enabled,
  birthday_prompt_dismissed,
  onboarding_completed
)
select distinct
  c.user_id,
  u.email,
  true,   -- default, same as ensureProfile()
  false,  -- onboarding NOT dismissed (prompt still shows, like a real first login)
  false
from cards c
join auth.users u on u.id = c.user_id
left join profiles p on p.id = c.user_id
where p.id is null
on conflict (id) do nothing;

-- 3) VERIFY — should return 0 rows after the backfill.
select count(*) as card_owners_still_missing_profile
from cards c
left join profiles p on p.id = c.user_id
where p.id is null;
