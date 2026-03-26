import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  server: {
    port: 5173,
    proxy: {
      // Proxy all API and auth calls to the Catalyst staging environment
      '/server': {
        target: 'https://adas-iq-904191467.development.catalystserverless.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
