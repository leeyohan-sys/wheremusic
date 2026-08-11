import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    proxy: {
      '/wm-analyze': {
        target: 'http://127.0.0.1:18790',
        changeOrigin: true,
      },
    },
  },
})
