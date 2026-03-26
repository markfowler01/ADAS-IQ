import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to local Catalyst serve (catalyst serve --except client)
      '/server': {
        target: 'http://localhost:9000',
        changeOrigin: true,
      },
    },
  },
})
