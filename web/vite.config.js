import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // MapLibre starts its own web worker from a sibling file. Pre-bundling moves
  // the main file and leaves the worker behind, so it is served as-is.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 8840,
    strictPort: true,
  },
})
