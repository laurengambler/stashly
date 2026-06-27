<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. The app already had a comprehensive `posthog-js` client-side integration with a privacy-first wrapper (`src/lib/posthog.js`). This run added three previously missing event tracking callsites and confirmed environment variable values are up to date.

| Event | Description | File |
|---|---|---|
| `user_signed_up` | User created a new account | `src/lib/auth.jsx` |
| `user_logged_in` | User signed into their account | `src/lib/auth.jsx` |
| `user_logged_out` | User signed out | `src/lib/auth.jsx` |
| `signup_failed` | Signup attempt returned an error | `src/components/AuthScreen.jsx` |
| `login_failed` | Login attempt returned an error | `src/components/AuthScreen.jsx` |
| `signup_confirmation_sent` | Supabase sent a confirmation email (no session yet) — top of email-confirmation funnel *(added)* | `src/components/AuthScreen.jsx` |
| `card_add_started` | User tapped the Add Card button | `src/App.jsx` |
| `card_add_cancelled` | User cancelled out of the Add Card screen | `src/components/AddCardScreen.jsx` |
| `open_loop_card_detected` | Visa/Mastercard PAN detected during add | `src/components/AddCardScreen.jsx` |
| `save_without_photo_chosen` | User chose to save card without a photo | `src/components/AddCardScreen.jsx` |
| `card_added` | Card successfully saved | `src/App.jsx` |
| `card_viewed` | User opened a card detail screen | `src/App.jsx` |
| `card_updated` | Card details were edited | `src/App.jsx` |
| `card_color_changed` | Card color changed from the detail screen *(added)* | `src/components/CardDetailScreen.jsx` |
| `card_favorited` | Card was marked as favourite | `src/App.jsx` |
| `card_unfavorited` | Card was unmarked as favourite | `src/App.jsx` |
| `card_archived` | Card was archived | `src/App.jsx` |
| `card_unarchived` | Archived card was restored | `src/App.jsx` |
| `card_deleted` | Card was permanently removed | `src/App.jsx` |
| `balance_updated` | A spend transaction was logged | `src/App.jsx` |
| `tab_changed` | User switched between wallet/archives/profile tabs | `src/App.jsx` |
| `card_scanned` | User opened the fullscreen barcode scanner | `src/components/CardDetailScreen.jsx` |
| `barcode_scan_dismissed` | Fullscreen scan closed without logging a spend *(added)* | `src/components/CardDetailScreen.jsx` |
| `card_scan_used` | User confirmed they used the card after scanning | `src/components/CardDetailScreen.jsx` |
| `pin_revealed` | User revealed a hidden PIN | `src/components/CardDetailScreen.jsx` |
| `photo_added` | Photo added to a card | `src/components/CardDetailScreen.jsx` |
| `photo_removed` | Photo removed from a card | `src/components/CardDetailScreen.jsx` |
| `photo_viewed` | Photo opened in fullscreen viewer | `src/components/CardDetailScreen.jsx` |
| `profile_birthday_saved` | User saved their birthday/reminder preference | `src/App.jsx` |
| `profile_birthday_skipped` | User skipped the birthday onboarding prompt | `src/App.jsx` |
| `local_cards_migrated` | Legacy localStorage cards migrated to account | `src/App.jsx` |
| `migration_skipped` | User skipped the localStorage migration prompt | `src/App.jsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1619666)
- [Signup → Login funnel](/insights/FFVipIro) — conversion from confirmation email sent to first login
- [Auth events over time](/insights/5ECulq9e) — signups, logins, and logouts over 30 days
- [Card lifecycle](/insights/03llOrQs) — cards added, archived, and deleted over time
- [Scan-to-spend conversion](/insights/DkvyJD6k) — barcode scan to spend deduction funnel
- [Card engagement](/insights/D34l58Kd) — card views, balance updates, and favorites over time

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
