import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

const getBuildTag = () => {
  try {
    const versionFile = path.resolve(__dirname, 'build-version.json');
    if (fs.existsSync(versionFile)) {
      const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      if (data.buildId) return String(data.buildId).trim();
    }
  } catch {}
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}${dd}-0001`;
};

export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'electron' || mode === 'portable' || process.env.ELECTRON === 'true';

  return {
    base: isDesktop ? './' : '/',
  plugins: [
    react(),
    VitePWA({
      // INV-PWA-UPDATE-PROMPT: 'prompt', never the automatic registration
      // type. With the automatic type the plugin enables skipWaiting +
      // clientsClaim in the generated worker AND injects its own registration
      // script that reloads the page the moment the new worker activates — a
      // white-screen reload mid-sale or mid-form, even though main.tsx itself
      // never forces an update.
      // injectRegister: false leaves the manual Workbox registration in
      // src/main.tsx as the single owner: a waiting worker only dispatches
      // 'pwa-update-available', the banner offers the update, and only the
      // user's click takes over. (PERF-11: index.html is served no-cache, so
      // the next fresh navigation still picks up the new build.)
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: 'Z-ERP - منظومة إدارة الأعمال',
        short_name: 'Z-ERP',
        description: 'نظام إدارة المبيعات ونقاط البيع والمخزون والحسابات المتكامل',
        theme_color: '#170c5c',
        background_color: '#0f172a',
        id: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'ar',
        dir: 'rtl',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        shortcuts: [
          {
            name: 'نقطة البيع (الكاشير)',
            short_name: 'الكاشير',
            url: '/pos',
            icons: [{ src: '/logo.png', sizes: '192x192' }]
          },
          {
            name: 'مبيعات الفان والتوزيع',
            short_name: 'مبيعات الفان',
            url: '/van-sales',
            icons: [{ src: '/logo.png', sizes: '192x192' }]
          },
          {
            name: 'بوابة مندوب التوصيل',
            short_name: 'المندوب',
            url: '/driver',
            icons: [{ src: '/logo.png', sizes: '192x192' }]
          },
          {
            name: 'متابعة المالك الحية',
            short_name: 'لوحة المالك',
            url: '/owner-companion',
            icons: [{ src: '/logo.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\/.*/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-webfonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } }
          }
        ]
      }
    })
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_ID__: JSON.stringify(getBuildTag()),
  },
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_DEV_BACKEND_URL || 'http://localhost:3101', changeOrigin: true } }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // PERF-5 (ARCHITECTURE_INVARIANTS.md §2.6) — read before editing:
        // 1. Rollup moves every *unassigned* dependency of a manual chunk INTO that chunk. Vite's
        //    preload helper (used by every lazy route) is a dependency of jspdf, so it used to land in
        //    vendor-jspdf — and every page, the public storefront included, preloaded ~390KB of jspdf
        //    at startup just to get that helper. Shared runtime helpers are pinned to 'vendor-runtime'.
        // 2. Match on the exact node_modules package, never a loose substring: '/react/' also matched
        //    '@sentry/react', pulling Sentry into the vendor-react chunk everyone downloads.
        // Guarded by `npm run qa:perf` (source rules) and `npm run qa:perf:dist` (built output).
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (
            normalizedId.includes('vite/preload-helper') ||
            normalizedId.includes('vite/modulepreload-polyfill') ||
            normalizedId.includes('commonjsHelpers') ||
            normalizedId.includes('/node_modules/@babel/runtime/') ||
            normalizedId.includes('/node_modules/tslib/')
          ) {
            return 'vendor-runtime';
          }
          if (
            normalizedId.includes('/src/locales/') ||
            normalizedId.includes('/src/lib/ui-dictionary.json')
          ) {
            return 'i18n-locales';
          }
          if (normalizedId.includes('/src/shared/components/icons/AppIcons')) {
            return 'vendor-icons';
          }
          const match = normalizedId.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//g);
          if (!match) return undefined;
          // Innermost package wins (handles nested node_modules).
          const pkgName = match[match.length - 1].replace(/^\/node_modules\//, '').replace(/\/$/, '');
          const chunkByPackage: Record<string, string> = {
            jspdf: 'vendor-jspdf',
            html2canvas: 'vendor-html2canvas',
            xlsx: 'vendor-xlsx',
            'pdfjs-dist': 'vendor-pdfjs',
            recharts: 'vendor-recharts',
            'lucide-react': 'vendor-icons',
            react: 'vendor-react',
            'react-dom': 'vendor-react',
            scheduler: 'vendor-react',
            // Shared by react-i18next (startup) AND recharts (lazy): pinned here so it can never drag
            // vendor-recharts into the startup graph via rule 1 above.
            'use-sync-external-store': 'vendor-react',
            'react-is': 'vendor-react',
            'react-router': 'vendor-router',
            'react-router-dom': 'vendor-router',
            '@tanstack/react-query': 'vendor-query',
            '@tanstack/query-core': 'vendor-query',
            '@tanstack/react-table': 'vendor-table',
            '@tanstack/table-core': 'vendor-table',
            'react-hook-form': 'vendor-forms',
            '@hookform/resolvers': 'vendor-forms',
            zod: 'vendor-forms',
            zustand: 'vendor-state',
            i18next: 'vendor-i18n',
            'react-i18next': 'vendor-i18n',
            'html5-qrcode': 'vendor-qrcode',
            'browser-image-compression': 'vendor-image-compression',
          };
          if (pkgName.startsWith('@sentry/') || pkgName.startsWith('@sentry-internal/')) return 'vendor-sentry';
          if (pkgName.startsWith('@capacitor/')) return 'vendor-capacitor';
          return chunkByPackage[pkgName];
        },
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
      },
    },
  },
};
});
