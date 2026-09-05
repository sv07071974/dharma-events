import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Without this, the service worker's SPA "navigate fallback" (which
        // serves the cached index.html for any full-page navigation, so
        // deep links work offline) also swallows navigations to backend
        // routes like the Reports CSV/XLSX download links (plain <a href>
        // clicks are navigations, not fetches) - the browser would load the
        // cached app shell instead of the actual file, which looks like the
        // link "just goes back to the home page". Excluding /api/ lets
        // those requests reach the network/API directly.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'Dharma Events',
        short_name: 'DharmaEvents',
        description: 'Event registration, QR check-in and attendance tracking',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
