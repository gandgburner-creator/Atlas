import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Where the app will be served from.
 *
 * GitHub Pages puts a project site under /<repo>/, not the domain root, and
 * every asset URL plus the service worker's scope has to agree with that or
 * the install silently half-works. The deploy workflow sets BASE_PATH; local
 * dev and any root-domain host need nothing.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Everything ships in the precache. The app must open with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: `${base}index.html`,
        // Rest-timer notifications have to be scheduled from inside the
        // worker, since the page is usually backgrounded by the time a rest
        // is up. Pulled in rather than hand-writing the whole worker, so
        // Workbox keeps generating the precache as before.
        importScripts: ['sw-alarm.js'],
      },
      manifest: {
        name: 'Atlas',
        short_name: 'Atlas',
        description: 'Personal tracking. Local only.',
        // Both must sit inside the base, or iOS opens the installed app in a
        // browser tab instead of standalone.
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ede5d6',
        theme_color: '#ede5d6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
