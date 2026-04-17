# Pocket — gift card wallet

A clean React front-end for a local-only gift card wallet app.

## Run it

You need Node.js installed (version 18 or newer). Get it from https://nodejs.org if you don't have it.

From the project folder, run these two commands:

```
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173) in your browser.

## What's where

```
pocket-app/
├── index.html              ← HTML entry point
├── package.json            ← dependencies + scripts
├── vite.config.js          ← Vite build config
└── src/
    ├── main.jsx            ← mounts React into #root
    ├── App.jsx             ← top-level state + navigation
    ├── components/
    │   ├── WalletScreen.jsx       ← home list + empty state
    │   ├── AddCardScreen.jsx      ← new card form
    │   ├── CardDetailScreen.jsx   ← detail view with deduct/undo
    │   ├── Barcode.jsx            ← Code 128 barcode renderer
    │   └── Toast.jsx              ← bottom-of-screen message
    ├── lib/
    │   ├── helpers.js             ← pure utilities (formatting, theming)
    │   ├── storage.js             ← localStorage wrapper
    │   └── sampleData.js          ← demo cards for first-time users
    └── styles/
        └── global.css             ← all the CSS
```

## Test on your phone

Vite is configured with `host: true`, so after `npm run dev` it prints two URLs — one is localhost, the other is your local network IP (something like `http://192.168.1.42:5173`). Open that second URL on your phone while it's on the same Wi-Fi and the app loads there.

## Data

Cards are saved to `localStorage` under the key `pocket_wallet_cards_v1`. To clear everything: open browser dev tools → Application → Local Storage → delete that key, then refresh.

On first load, three sample cards appear so the app isn't empty. Once you save, edit, or remove any card, those saves take over and sample data is never re-seeded.
