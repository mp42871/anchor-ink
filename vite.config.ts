import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import legacy from '@vitejs/plugin-legacy';

/**
 * Interactive displays often run an old built-in Chrome / Android WebView.
 * Compile down to Chrome 80-era syntax and add polyfills for any newer
 * built-ins the code (or a library) uses, e.g. Promise.withResolvers.
 */
const TARGETS = ['chrome>=80', 'edge>=80', 'safari>=14', 'firefox>=78'];

export default defineConfig({
  // relative base so the build works from any folder / GitHub Pages sub-path
  base: './',
  build: { target: ['chrome80', 'edge80', 'safari14', 'firefox78'], chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
  plugins: [
    legacy({ renderLegacyChunks: false, modernPolyfills: true, modernTargets: TARGETS }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: 'Anchor Ink',
        short_name: 'Anchor Ink',
        description: 'Annotate school documents on interactive displays. Ink stays anchored to the page.',
        theme_color: '#1a66d9',
        background_color: '#e8ebf0',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/pdf': ['.pdf'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
              'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
              'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
            },
          },
        ],
      } as any,
    }),
  ],
});
