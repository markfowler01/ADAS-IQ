import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            return 'vendor'
          }
          // Split heavy admin/ops screens into separate chunks
          if (id.includes('/OpsHub')) return 'ops'
          if (id.includes('/KanbanBoard')) return 'kanban'
          if (id.includes('/CRMScreen') || id.includes('/ShopDetailPanel')
              || id.includes('/CRMImportModal') || id.includes('/GooglePlacesModal')
              || id.includes('/CRMBroadcastModal') || id.includes('/CRMTemplatesModal')) return 'crm'
          if (id.includes('/books/') || id.includes('/BooksScreen')) return 'books'
          if (id.includes('/CalibrationRulesScreen') || id.includes('/RepairEstimateScreen')) return 'tools'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API calls to local Catalyst serve (catalyst serve --except client)
      '/server': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
