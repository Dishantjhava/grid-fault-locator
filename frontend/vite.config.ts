import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so the container port is reachable from the host.
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Any request to /health or /api/* gets forwarded to the backend service.
      // "backend" resolves inside Docker to the backend container's IP.
      // The browser never sees this — the proxy runs server-side inside the
      // Vite dev server process, which can resolve Docker hostnames.
      '/health': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://backend:3001',
        changeOrigin: true,
      },
    },
  },
})
