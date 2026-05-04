// App.jsx
// Root component. Now responsible for:
//   - gating the wallet behind Supabase auth
//   - loading cards from Supabase (was localStorage)
//   - one-time migration of legacy localStorage cards into the account
//   - the optional birthday onboarding card after first login
//
// Card mutations are still optimistic locally then persisted to
// Supabase, so the existing UI feels instant. If a write fails, we
// re-read from the server to stay consistent.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import WalletScreen from './components/WalletScreen.jsx'
import AddCardScreen from './components/AddCardScreen.jsx'
import CardDetailScreen from './components/CardDetailScreen.jsx'
import ArchivesScreen from './components/ArchivesScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import BottomNav from './components/BottomNav.jsx'
import ConfirmModal from './components/ConfirmModal.jsx'
import Toast from './components/Toast.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import MigrateCardsModal from './components/MigrateCardsModal.jsx'
import BirthdaySection from './components/BirthdaySection.jsx'
import { loadCards as loadLocalCards } from './lib/storage.js'
import { deletePhoto } from './lib/photoStorage.js'
import { themeForCard } from './lib/helpers.js'
import { useAuth } from './lib/auth.jsx'
import {
  fetchCards,
  insertCard,
  insertManyCards,
  updateCard,
  deleteCard,
} from './lib/cardsApi.js'
import { fetchProfile, upsertProfile } from './lib/profileApi.js'
import { track, identifyUser, ageRange, safeBrand } from './lib/posthog.js'

// Pull the most useful bits out of a Supabase/PostgrestError so we can
// log + display the *real* failure instead of a generic "try again".
const describeSupabaseError = (err) => {
  if (!err) return 'Unknown error'
  const code = err.code ? ` (${err.code})` : ''
  return (err.message || 'Unknown error') + code
}
const logSupabaseError = (label, err) => {
  // Group is collapsed in DevTools but expandable for full details.
  console.error(`[${label}]`, {
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    error: err,
  })
}

const LEGACY_KEY = 'stashly_cards_v1'
const MIGRATION_DECISION_KEY = 'stashly_migration_decision_v1'

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth()

  const [screen, setScreen] = useState('wallet')
  const [cards, setCards] = useState([])
  const [cardsLoaded, setCardsLoaded] = useState(false)
  const [activeCardId, setActiveCardId] = useState(null)
  const [pendingArchive, setPendingArchive] = useState(null)
  const [toast, setToast] = useState({ message: '', visible: false })

  const [profile, setProfile] = useState(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [migration, setMigration] = useState(null) // { localCards: [...] }
  const [migrationBusy, setMigrationBusy] = useState(false)

  // Two timers per toast: one to start the slide-out (visible -> false),
  // one to drop the message after the transition has finished so the
  // node fully unmounts and can never be left lingering on screen.
  const toastHideTimer = useRef(null)
  const toastClearTimer = useRef(null)

  const showToast = (message) => {
    if (toastHideTimer.current) clearTimeout(toastHideTimer.current)
    if (toastClearTimer.current) clearTimeout(toastClearTimer.current)
    setToast({ message, visible: true })
    toastHideTimer.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }))
    }, 1800)
    toastClearTimer.current = setTimeout(() => {
      setToast({ message: '', visible: false })
    }, 1800 + 400)
  }

  useEffect(
    () => () => {
      if (toastHideTimer.current) clearTimeout(toastHideTimer.current)
      if (toastClearTimer.current) clearTimeout(toastClearTimer.current)
    },
    []
  )

  // --- Load remote data when auth state resolves -----------------

  // Key the load on the user's id, not the user object — supabase-js
  // emits a brand-new session/user object on every TOKEN_REFRESHED
  // event, which previously made this effect (and any transient errors
  // it surfaced as toasts) re-fire on a quiet timer in the background.
  const userId = user?.id || null

  useEffect(() => {
    if (!userId) {
      setCards([])
      setCardsLoaded(false)
      setProfile(null)
      setProfileLoaded(false)
      setMigration(null)
      setActiveCardId(null)
      setScreen('wallet')
      return
    }

    let cancelled = false
    ;(async () => {
      // Cards and profile are loaded independently so a missing/empty
      // profile (the normal first-login state) can't trigger the
      // "Could not load your cards" toast. The toast only fires if
      // cards specifically fail.
      let cardsFailed = false
      try {
        const remote = await fetchCards()
        if (!cancelled) {
          setCards(remote)
        }
      } catch (err) {
        cardsFailed = true
        console.warn('Failed to load cards from Supabase', err)
      }
      if (!cancelled) setCardsLoaded(true)

      let prof = null
      try {
        prof = await fetchProfile(userId)
        if (!cancelled) setProfile(prof)
      } catch (err) {
        // Profile errors are not user-visible — the birthday section
        // is optional polish, not a blocker. Logging is enough.
        console.warn('Failed to load profile from Supabase', err)
      }
      if (!cancelled) setProfileLoaded(true)

      identifyUser(userId, {
        birthday_reminder_enabled: !!prof?.birthdayRemindersEnabled,
        age_range: ageRange(prof?.birthdayYear),
      })

      const localCards = loadLocalCards() || []
      const decided = localStorage.getItem(MIGRATION_DECISION_KEY)
      if (!cancelled && localCards.length > 0 && !decided) {
        setMigration({ localCards })
      }

      if (!cancelled && cardsFailed) {
        showToast('Could not load your cards')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [userId])

  // --- Migration ----------------------------------------------------

  const handleMigrate = async () => {
    if (!migration || !user) return
    setMigrationBusy(true)
    try {
      const inserted = await insertManyCards(migration.localCards, user.id)
      setCards((prev) => [...inserted, ...prev])
      try {
        localStorage.removeItem(LEGACY_KEY)
      } catch {}
      localStorage.setItem(MIGRATION_DECISION_KEY, 'migrated')
      track('local_cards_migrated', {
        user_id: user.id,
        count: inserted.length,
      })
      setMigration(null)
      showToast(
        inserted.length === 1
          ? '1 card moved in'
          : `${inserted.length} cards moved in`
      )
    } catch (err) {
      logSupabaseError('insertManyCards (migration)', err)
      showToast('Migration failed: ' + describeSupabaseError(err))
    } finally {
      setMigrationBusy(false)
    }
  }

  const handleSkipMigration = () => {
    localStorage.setItem(MIGRATION_DECISION_KEY, 'skipped')
    setMigration(null)
  }

  // --- Card mutations (optimistic, then persisted) ----------------

  const handleAddCard = async (newCard) => {
    if (!user) {
      throw new Error('Not signed in')
    }
    try {
      const saved = await insertCard(newCard, user.id)
      setCards((prev) => [saved, ...prev])
      setScreen('wallet')
      showToast('Card added')
      track('card_added', { user_id: user.id, brand: safeBrand(saved) })
      return saved
    } catch (err) {
      logSupabaseError('insertCard', err)
      // Toast is intentionally short — full error details go to the
      // inline error slot inside AddCardScreen and to the browser console.
      showToast('Save failed — see error in form')
      throw err
    }
  }

  const handleOpenCard = (id) => {
    setActiveCardId(id)
    setScreen('detail')
    const card = cards.find((c) => c.id === id)
    track('card_viewed', { user_id: user?.id, brand: safeBrand(card) })
  }

  const persistUpdate = useCallback(
    async (cardId, updates, { silent = false } = {}) => {
      // Optimistic local update.
      setCards((prev) =>
        prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c))
      )
      try {
        await updateCard(cardId, updates)
      } catch (err) {
        console.warn('Could not save card change', err)
        if (!silent) showToast('Could not save change')
        // Best-effort re-sync.
        try {
          const fresh = await fetchCards()
          setCards(fresh)
        } catch {}
      }
    },
    []
  )

  const handleDeduct = (cardId, transaction) => {
    const card = cards.find((c) => c.id === cardId)
    const nextTx = [...(card?.transactions || []), transaction]
    persistUpdate(cardId, { transactions: nextTx }, { silent: true })
    showToast('Balance updated')
    track('balance_updated', { user_id: user?.id, brand: safeBrand(card) })
  }

  const handleUndo = (cardId, txId) => {
    const card = cards.find((c) => c.id === cardId)
    const nextTx = (card?.transactions || []).filter((t) => t.id !== txId)
    persistUpdate(cardId, { transactions: nextTx }, { silent: true })
    showToast('Entry removed')
  }

  const handleUpdateCard = (cardId, updates) => {
    persistUpdate(cardId, updates)
    track('card_updated', { user_id: user?.id })
  }

  const handleToggleFavorite = (cardId) => {
    const card = cards.find((c) => c.id === cardId)
    if (!card) return
    const next = !card.favorite
    persistUpdate(cardId, { favorite: next }, { silent: true })
    track(next ? 'card_favorited' : 'card_unfavorited', {
      user_id: user?.id,
      brand: safeBrand(card),
    })
  }

  const requestArchive = (cardId) => setPendingArchive({ id: cardId })

  const confirmArchive = () => {
    if (!pendingArchive) return
    const id = pendingArchive.id
    const card = cards.find((c) => c.id === id)
    persistUpdate(id, { archived: true }, { silent: true })
    setPendingArchive(null)
    if (activeCardId === id) {
      setActiveCardId(null)
      setScreen('wallet')
    }
    showToast('Card archived')
    track('card_archived', { user_id: user?.id, brand: safeBrand(card) })
  }

  const handleRestore = (cardId) => {
    const card = cards.find((c) => c.id === cardId)
    persistUpdate(cardId, { archived: false }, { silent: true })
    showToast('Card restored')
    track('card_unarchived', { user_id: user?.id, brand: safeBrand(card) })
  }

  const handleDelete = async (cardId) => {
    const removed = cards.find((c) => c.id === cardId)
    setCards((prev) => prev.filter((c) => c.id !== cardId))
    setActiveCardId(null)
    setScreen('wallet')
    showToast('Card removed')
    if (removed?.frontPhotoId) deletePhoto(removed.frontPhotoId).catch(() => {})
    if (removed?.backPhotoId) deletePhoto(removed.backPhotoId).catch(() => {})
    try {
      await deleteCard(cardId)
    } catch (err) {
      console.warn('Could not delete card', err)
      showToast('Could not delete on the server')
      try {
        const fresh = await fetchCards()
        setCards(fresh)
      } catch {}
    }
  }

  // --- Profile ---------------------------------------------------

  const handleSaveProfile = async (updates) => {
    if (!user) return
    // Saving counts as completing onboarding so the inline prompt on
    // the wallet doesn't reappear on the next visit.
    const merged = {
      ...(profile || {}),
      ...updates,
      onboardingCompleted: true,
    }
    try {
      const saved = await upsertProfile(user.id, merged)
      setProfile(saved)
      showToast('Saved')
      track('profile_birthday_saved', {
        user_id: user.id,
        age_range: ageRange(saved.birthdayYear),
        birthday_reminder_enabled: !!saved.birthdayRemindersEnabled,
      })
      identifyUser(user.id, {
        birthday_reminder_enabled: !!saved.birthdayRemindersEnabled,
        age_range: ageRange(saved.birthdayYear),
      })
    } catch (err) {
      logSupabaseError('upsertProfile', err)
      showToast('Save failed: ' + describeSupabaseError(err))
    }
  }

  const handleSkipBirthday = async () => {
    if (!user) return
    try {
      const saved = await upsertProfile(user.id, {
        ...(profile || {}),
        onboardingCompleted: true,
      })
      setProfile(saved)
      track('profile_birthday_skipped', { user_id: user.id })
    } catch (err) {
      logSupabaseError('upsertProfile (skip)', err)
      showToast('Skip failed: ' + describeSupabaseError(err))
    }
  }

  const handleSignOut = async () => {
    await signOut()
  }

  // --- Derived view state ----------------------------------------

  const activeCards = useMemo(() => {
    const visible = cards.filter((c) => !c.archived)
    return [...visible].sort((a, b) => {
      const fa = a.favorite ? 1 : 0
      const fb = b.favorite ? 1 : 0
      if (fa !== fb) return fb - fa
      return (a.merchant || '').localeCompare(b.merchant || '', undefined, {
        sensitivity: 'base',
      })
    })
  }, [cards])

  const archivedCards = useMemo(
    () =>
      cards
        .filter((c) => c.archived)
        .sort((a, b) =>
          (a.merchant || '').localeCompare(b.merchant || '', undefined, {
            sensitivity: 'base',
          })
        ),
    [cards]
  )

  const activeCard = activeCardId
    ? cards.find((c) => c.id === activeCardId) || null
    : null
  const activeTheme = activeCard ? themeForCard(activeCard) : null

  const showBottomNav =
    screen === 'wallet' || screen === 'archives' || screen === 'profile'

  const handleTabChange = (tabId) => {
    setActiveCardId(null)
    setScreen(tabId)
  }

  // Show the birthday onboarding card on the wallet only when the user
  // has not yet saved or dismissed it.
  // The onboarding card stays out of the way once the user has either
  // saved a birthday or hit Skip — both paths flip onboarding_completed.
  const showBirthdayOnboarding =
    profileLoaded && !!user && !profile?.onboardingCompleted

  // --- Render ----------------------------------------------------

  if (authLoading) {
    return (
      <div className="pw-app">
        <div className="pw-loading">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return <AuthScreen />
  }

  return (
    <div className={'pw-app' + (showBottomNav ? ' has-bottomnav' : '')}>
      {screen === 'wallet' && (
        <>
          <WalletScreen
            cards={activeCards}
            onAdd={() => setScreen('add')}
            onOpen={handleOpenCard}
            onArchive={requestArchive}
            onToggleFavorite={handleToggleFavorite}
          />
          {showBirthdayOnboarding && (
            <div className="pw-birthday-onboarding-wrap">
              <BirthdaySection
                variant="onboarding"
                profile={profile}
                onSave={handleSaveProfile}
                onSkip={handleSkipBirthday}
              />
            </div>
          )}
        </>
      )}

      {screen === 'archives' && (
        <ArchivesScreen
          cards={archivedCards}
          onRestore={handleRestore}
          onOpen={handleOpenCard}
        />
      )}

      {screen === 'profile' && (
        <ProfileScreen
          profile={profile}
          onSaveProfile={handleSaveProfile}
          onSignOut={handleSignOut}
        />
      )}

      {screen === 'add' && (
        <AddCardScreen
          onCancel={() => setScreen('wallet')}
          onSave={handleAddCard}
        />
      )}

      {screen === 'detail' && activeCard && (
        <CardDetailScreen
          card={activeCard}
          theme={activeTheme}
          onBack={() => setScreen(activeCard.archived ? 'archives' : 'wallet')}
          onDeduct={handleDeduct}
          onUndo={handleUndo}
          onDelete={handleDelete}
          onUpdateCard={handleUpdateCard}
          onArchive={requestArchive}
          onToggleFavorite={handleToggleFavorite}
          onRestore={handleRestore}
        />
      )}

      {showBottomNav && (
        <BottomNav active={screen} onChange={handleTabChange} />
      )}

      {pendingArchive && (
        <ConfirmModal
          title="Archive this card?"
          body="You can restore it later from Archives."
          confirmLabel="Archive"
          cancelLabel="Cancel"
          onConfirm={confirmArchive}
          onCancel={() => setPendingArchive(null)}
        />
      )}

      {migration && cardsLoaded && (
        <MigrateCardsModal
          count={migration.localCards.length}
          busy={migrationBusy}
          onMigrate={handleMigrate}
          onSkip={handleSkipMigration}
        />
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
