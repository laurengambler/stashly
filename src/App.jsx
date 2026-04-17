// App.jsx
// The root component. Owns all state (cards, current screen) and
// persists cards to localStorage whenever they change.

import { useState, useEffect, useMemo } from 'react'
import WalletScreen from './components/WalletScreen.jsx'
import AddCardScreen from './components/AddCardScreen.jsx'
import CardDetailScreen from './components/CardDetailScreen.jsx'
import Toast from './components/Toast.jsx'
import { loadCards, saveCards } from './lib/storage.js'
import { SAMPLE_CARDS } from './lib/sampleData.js'
import { themeAtPosition } from './lib/helpers.js'

export default function App() {
  // `screen` is one of: 'wallet' | 'add' | 'detail'
  const [screen, setScreen] = useState('wallet')

  // All saved cards. Loaded synchronously from localStorage on first
  // render so we never overwrite storage with an empty default before
  // hydration. Falls back to sample data only when storage is truly
  // absent (first-ever visit).
  const [cards, setCards] = useState(() => {
    const stored = loadCards()
    return stored === null ? SAMPLE_CARDS : stored
  })

  // The currently-open card ID (only relevant on the detail screen).
  const [activeCardId, setActiveCardId] = useState(null)

  // Transient toast message.
  const [toast, setToast] = useState({ message: '', visible: false })
  const showToast = (message) => {
    setToast({ message, visible: true })
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 1800)
  }

  // --- Persist whenever cards change. ---
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

  const handleDelete = (cardId) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId))
    setActiveCardId(null)
    setScreen('wallet')
    showToast('Card removed')
  }

  // Single source of truth for card ordering: sorted A→Z by merchant.
  // The gradient is indexed against this list, so both the wallet list
  // and the detail screen derive the same color for any given card.
  const sortedCards = useMemo(
    () =>
      [...cards].sort((a, b) =>
        (a.merchant || '').localeCompare(b.merchant || '', undefined, {
          sensitivity: 'base',
        })
      ),
    [cards]
  )

  // Find the currently-active card and its gradient position.
  const activeIndex = sortedCards.findIndex((c) => c.id === activeCardId)
  const activeCard = activeIndex >= 0 ? sortedCards[activeIndex] : null
  const activeTheme =
    activeIndex >= 0 ? themeAtPosition(activeIndex, sortedCards.length) : null

  return (
    <div className="pw-app">
      {screen === 'wallet' && (
        <WalletScreen
          cards={sortedCards}
          onAdd={() => setScreen('add')}
          onOpen={handleOpenCard}
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
          onBack={() => setScreen('wallet')}
          onDeduct={handleDeduct}
          onUndo={handleUndo}
          onDelete={handleDelete}
        />
      )}

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
