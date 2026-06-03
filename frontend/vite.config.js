import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/places':  { target: 'http://localhost:8000', changeOrigin: true },
      '/trips':   { target: 'http://localhost:8000', changeOrigin: true },
      '/alerts':  { target: 'http://localhost:8000', changeOrigin: true },
      '/transit': { target: 'http://localhost:8000', changeOrigin: true },
      '/users':   { target: 'http://localhost:8000', changeOrigin: true },
      '/chat':    { target: 'http://localhost:8000', changeOrigin: true },
      '/health':  { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    globals: true,
    passWithNoTests: true,
  },
})
