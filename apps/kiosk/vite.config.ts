import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Kiosk build configuration.
 *
 * Two deliberate choices:
 *  * Manual chunks for React and the speech pipeline, because the kiosk often runs on
 *    modest hardware and a single 700 kB bundle delays the welcome screen — which is
 *    the one moment a candidate is definitely waiting.
 *  * The dev server proxies the API so the kiosk runs same-origin in development and in
 *    production, keeping cookies and the WebSocket on one origin.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          speech: ['@proctor/speech'],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
      '/healthz': {
        target: process.env.API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 5173, strictPort: true },
});