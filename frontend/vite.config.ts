import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.up.railway.app', '.railway.app', 'steadfast-nourishment-production-7968.up.railway.app'],
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.up.railway.app', '.railway.app', 'steadfast-nourishment-production-7968.up.railway.app'],
  },
})
