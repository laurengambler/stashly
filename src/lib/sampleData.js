// lib/sampleData.js
// Three sample cards so the app is populated on first load.
// These load ONLY if the user has no existing saved cards —
// we never overwrite real data.
//
// Delete this file (and the import in App.jsx) when you're done
// with demos.

import { uid } from './helpers.js'

export const SAMPLE_CARDS = [
  {
    id: uid(),
    merchant: 'Starbucks',
    number: '6011234567890123',
    pin: '4821',
    balance: '$47.50',
    startingBalance: 47.5,
    transactions: [],
    notes: 'Gift from Jen — expires Dec 2026',
    createdAt: Date.now(),
  },
  {
    id: uid(),
    merchant: 'Target',
    number: '4532015112830366',
    pin: '7739',
    balance: '$120.00',
    startingBalance: 120.0,
    transactions: [],
    notes: '',
    createdAt: Date.now(),
  },
  {
    id: uid(),
    merchant: 'Sephora',
    number: '5555341244442222',
    pin: '',
    balance: '$25.00',
    startingBalance: 25.0,
    transactions: [],
    notes: '',
    createdAt: Date.now(),
  },
]
