import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/global.css'
import { AuthProvider } from './lib/auth.jsx'
import { initPostHog } from './lib/posthog.js'

// Fire-and-forget analytics init. Safe to call before rendering — if
// no PostHog key is configured, this is a no-op.
initPostHog()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
