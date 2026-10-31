import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `npm run dev` serves the UI on :5173 and proxies the API to the Go server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
})
