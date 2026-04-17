import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config — minimal, just enables React with fast refresh
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // lets you open on your phone via local network
  },
})
