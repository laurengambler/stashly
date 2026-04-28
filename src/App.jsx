// App.jsx
// The root component. Owns all state (cards, current screen) and
// persists cards to localStorage whenever they change.

import { useState, useEffect, useMemo } from 'react'
import WalletScreen from './components/WalletScreen.jsx'
import AddCardScreen from './components/AddCardScreen.jsx'
import CardDetailScreen from './components/CardDetailScreen.jsx'
import ArchivesScreen from './components/ArchivesScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import BottomNav from './components/BottomNav.jsx'
import ConfirmModal from './components/ConfirmModal.jsx'
import Toast from './components/Toast.jsx'
import { loadCards, saveCards } from './lib/storage.js'
import { deletePhoto } from './lib/photoStorage.js'
import { themeForCard } from './lib/helpers.js'

export default function App() {
  // 'wallet' | 'add' | 'detail' | 'archives' | 'profile'
  const [screen, setScreen] = useState('wallet')

  const [cards, setCards] = useState(() => loadCards() ?? [])
  const [activeCardId, setActiveCardId] = useState(null)

  // Pending archive — { id } while the confirmation modal is open.
  const [pendingArchive, setPendingArchive] = useState(null)

  // Transient toast message.
  const [toast, setToast] = useState({ message: '', visible: false })
  const showToast = (message) => {
    setToast({ message, visible: true })
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 1800)
  }

  useEffect(() => {
    saveCards(cards)
  }, [cards])

  // --- Handlers passed down to child screens. ---

  const handleAddCard = (newCard) => {
    setCards((prev) => [newCard, ...prev])
    setScreen('wallet')
    showToast('Card added')
  }

  const handleOpenCard = (id) => {
    setActiveCardId(id)
    setScreen('detail')
  }

  const handleDeduct = (cardId, transaction) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? { ...c, transactions: [...(c.transactions || []), transaction] }
          : c
      )
    )
    showToast('Balance updated')
  }

  const handleUndo = (cardId, txId) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? {
              ...c,
              transactions: (c.transactions || []).filter(
                (t) => t.id !== txId
              ),
            }
          : c
      )
    )
    showToast('Entry removed')
  }

  const handleUpdateCard = (cardId, updates) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c))
    )
  }

  const handleToggleFavorite = (cardId) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, favorite: !c.favorite } : c
      )
    )
  }

  const requestArchive = (cardId) => {
    setPendingArchive({ id: cardId })
  }

  const confirmArchive = () => {
    if (!pendingArchive) return
    const id = pendingArchive.id
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, archived: true } : c))
    )
    setPendingArchive(null)
    // If the user archived the card they were viewing, return to list.
    if (activeCardId === id) {
      setActiveCardId(null)
      setScreen('wallet')
    }
    showToast('Card archived')
  }

  const handleRestore = (cardId) => {
    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, archived: false } : c))
    )
    showToast('Card restored')
  }

  const handleDelete = (cardId) => {
    const removed = cards.find((c) => c.id === cardId)
    setCards((prev) => prev.filter((c) => c.id !== cardId))
    setActiveCardId(null)
    setScreen('wallet')
    showToast('Card removed')
    if (removed) {
      if (removed.frontPhotoId) deletePhoto(removed.frontPhotoId).catch(() => {})
      if (removed.backPhotoId) deletePhoto(removed.backPhotoId).catch(() => {})
    }
  }

  // Active list: hide archived. Sort favorites first, then A→Z by merchant.
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

  // The currently-open card and its theme (uses card color).
  const activeCard = activeCardId
    ? cards.find((c) => c.id === activeCardId) || null
    : null
  const activeTheme = activeCard ? themeForCard(activeCard) : null

  // Bottom nav is hidden on the add and detail flows so they feel
  // like full-screen tasks.
  const showBottomNav = screen === 'wallet' || screen === 'archives' || screen === 'profile'

  const handleTabChange = (tabId) => {
    setActiveCardId(null)
    setScreen(tabId)
  }

  return (
    <div className={'pw-app' + (showBottomNav ? ' has-bottomnav' : '')}>
      {screen === 'wallet' && (
        <WalletScreen
          cards={activeCards}
          onAdd={() => setScreen('add')}
          onOpen={handleOpenCard}
          onArchive={requestArchive}
          onToggleFavorite={handleToggleFavorite}
        />
      )}

      {screen === 'archives' && (
        <ArchivesScreen
          cards={archivedCards}
          onRestore={handleRestore}
          onOpen={handleOpenCard}
        />
      )}

      {screen === 'profile' && <ProfileScreen />}

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

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
