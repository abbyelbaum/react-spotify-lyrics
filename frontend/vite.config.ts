import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// We bind to 127.0.0.1 (not localhost) so the Spotify OAuth redirect URI
// `http://127.0.0.1:5173/auth/callback` matches exactly. /api and /auth are
// proxied to the FastAPI backend so the browser sees a single origin
// (avoids cross-site cookie pain in dev).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
})
