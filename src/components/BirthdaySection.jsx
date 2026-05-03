// components/BirthdaySection.jsx
// One reusable card used in two places:
//   1) On the Wallet screen after signup as an optional onboarding prompt.
//   2) Permanently inside Profile so the user can edit it later.
//
// Year is optional. We never display the user's exact age in the UI —
// the year is only used to compute a coarse age range for analytics.

import { useEffect, useState } from 'react'

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

const daysInMonth = (m, y) => {
  if (!m) return 31
  // Year defaults to a leap year so Feb 29 is selectable when year is blank.
  return new Date(y || 2024, m, 0).getDate()
}

export default function BirthdaySection({
  variant = 'profile', // 'profile' | 'onboarding'
  profile,
  onSave,
  onSkip,
}) {
  const [month, setMonth] = useState(profile?.birthdayMonth || '')
  const [day, setDay] = useState(profile?.birthdayDay || '')
  const [year, setYear] = useState(profile?.birthdayYear || '')
  const [reminders, setReminders] = useState(
    profile?.birthdayRemindersEnabled ?? true
  )
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  // If the parent re-fetches the profile, sync our local form state
  // so the editor reflects the latest saved values.
  useEffect(() => {
    setMonth(profile?.birthdayMonth || '')
    setDay(profile?.birthdayDay || '')
    setYear(profile?.birthdayYear || '')
    setReminders(profile?.birthdayRemindersEnabled ?? true)
  }, [
    profile?.birthdayMonth,
    profile?.birthdayDay,
    profile?.birthdayYear,
    profile?.birthdayRemindersEnabled,
  ])

  const maxDay = daysInMonth(Number(month) || null, Number(year) || null)
  const canSave = !!month && !!day

  const submit = async (e) => {
    e?.preventDefault?.()
    if (!canSave || busy) return
    setBusy(true)
    try {
      await onSave({
        birthdayMonth: Number(month),
        birthdayDay: Number(day),
        birthdayYear: year ? Number(year) : null,
        birthdayRemindersEnabled: reminders,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setBusy(false)
    }
  }

  const dayOptions = []
  for (let d = 1; d <= maxDay; d++) dayOptions.push(d)

  // Reasonable year range for a birthday picker — current year back ~110 years.
  const thisYear = new Date().getFullYear()
  const yearOptions = []
  for (let y = thisYear; y >= thisYear - 110; y--) yearOptions.push(y)

  return (
    <form className="pw-birthday-card" onSubmit={submit}>
      <div className="pw-birthday-head">
        <h3 className="pw-birthday-title">
          {variant === 'onboarding' ? 'Add your birthday' : 'Birthday'}
        </h3>
        <p className="pw-birthday-sub">
          We&rsquo;ll remind you to check for gift cards around your birthday.
        </p>
      </div>

      <div className="pw-birthday-grid">
        <label className="pw-birthday-field">
          <span>Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            required
          >
            <option value="">—</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pw-birthday-field">
          <span>Day</span>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            required
          >
            <option value="">—</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="pw-birthday-field">
          <span>Year (optional)</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">—</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="pw-birthday-toggle">
        <input
          type="checkbox"
          checked={reminders}
          onChange={(e) => setReminders(e.target.checked)}
        />
        <span>Send me birthday gift card reminders</span>
      </label>

      <div className="pw-birthday-actions">
        <button
          type="submit"
          className="pw-modal-btn primary"
          disabled={!canSave || busy}
        >
          {busy ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
        {variant === 'onboarding' && onSkip && (
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onSkip}
            disabled={busy}
          >
            Skip for now
          </button>
        )}
      </div>
    </form>
  )
}
