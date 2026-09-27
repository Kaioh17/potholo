import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre starts its own web worker from a sibling file. Pre-bundling moves
  // the main file and leaves the worker behind, so it is served as-is.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    // The API runs on its own port in development. Proxying keeps the browser
    // on one origin, so the map page can fetch /api/... with no CORS round trip
    // and no base URL baked into the build.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
