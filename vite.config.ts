import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 转发到 server/index.mjs(pnpm dev:server)
      '/api': 'http://localhost:8787',
    },
  },
})
