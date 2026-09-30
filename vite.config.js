import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config — minimal, just enables React with fast refresh
export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // lets you open on your phone via local network
  },
  esbuild: {
    // Strip console.log/debug/trace from production bundles.
    //
    // This is a backstop, not the fix: the payload dumps that logged card
    // numbers and PINs in plaintext have been removed at the source (see
    // logShape in lib/cardsApi.js). But on iOS the console is readable by
    // anyone who can attach to the device, so a stray console.log added
    // later must not be one debugging session away from leaking a card
    // number.
    //
    // console.warn, console.error and console.info survive on purpose —
    // they carry diagnostics with no payload values in them, and losing
    // them would make production failures harder to understand, which is
    // its own risk.
    pure:
      command === 'build'
        ? ['console.log', 'console.debug', 'console.trace']
        : [],
  },
}))
