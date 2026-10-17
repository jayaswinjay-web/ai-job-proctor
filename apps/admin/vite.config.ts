import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Admin build.
 *
 * The admin bundle is loaded by staff on desktops, so it optimises for first paint of
 * the dashboard rather than for bundle size. The kiosk's constraints (slow hardware,
 * one screen, one task) are the opposite problem and are tuned separately.
 */
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Only the production build is served from /admin/ (by the Cloudflare Worker's static
  // assets). Dev and preview must keep `/`, because Vite prefixes the base onto every
  // module URL and a `base` other than the served path breaks the dev server's rewriting.
  base: command === 'build' ? '/admin/' : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@proctor/ui'],
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
      '/healthz': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  preview: { port: 5174, strictPort: true },
}));