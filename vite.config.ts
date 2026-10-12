/// <reference types="vitest/config" />
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// `npm run dev:phone`: HTTPS + one origin that proxies every emulator, so a phone
// on the same Wi-Fi can use the app (camera needs HTTPS; emulators stay on localhost).
const phone = process.env.FILMROLL_PHONE === '1';
// Production lives at arkaprabho.com/filmroll (BASE_PATH=/filmroll/ in vercel.json).
const base = process.env.BASE_PATH || '/';
const emu = (port: number) => ({ target: `http://127.0.0.1:${port}`, changeOrigin: true, ws: true });

export default defineConfig(async () => ({
  base,
  plugins: [
    ...(phone ? [((await import('@vitejs/plugin-basic-ssl')).default() as PluginOption)] : []),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'FilmRoll',
        short_name: 'FilmRoll',
        description: 'Different lives. One roll of film.',
        theme_color: '#F4EBDD',
        background_color: '#F4EBDD',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only. Photos are fetched with an auth header from the photo
        // function and are never put in a service-worker cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//, /^\/__\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  resolve: {
    // node_modules is a symlink to node_modules.nosync (keeps iCloud Desktop sync out of it);
    // keep the symlinked paths so Vite still treats them as dependencies.
    preserveSymlinks: true,
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  optimizeDeps: { entries: ['index.html'] },
  server: {
    watch: { ignored: ['**/node_modules.nosync/**', '**/functions/**', '**/.emulator-data/**'] },
    ...(phone && {
      host: true,
      proxy: {
        // Auth emulator (REST + sign-in popup handler)
        '/identitytoolkit.googleapis.com': emu(9099),
        '/securetoken.googleapis.com': emu(9099),
        '/emulator': emu(9099),
        // Firestore emulator (WebChannel streams + REST)
        '/google.firestore.v1.Firestore': emu(8080),
        '/v1/projects': emu(8080),
        // Storage emulator
        '/v0': emu(9199),
        // Functions emulator (callables + the photo endpoint)
        '/__functions': { ...emu(5001), rewrite: (p: string) => p.replace(/^\/__functions/, '') },
      },
    }),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'firebase';
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'src/**/*.test.ts', 'functions/src/**/*.test.ts'],
  },
}));
