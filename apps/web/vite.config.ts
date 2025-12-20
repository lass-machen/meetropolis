import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const isDesktop = process.env.VITE_TARGET === 'desktop';

export default defineConfig({
  plugins: [react()],
  // eigener Cache-Ordner, um alte Optimierungen sicher zu umgehen (Docker)
  cacheDir: '/tmp/.vite',
  base: isDesktop ? './' : '/',
  resolve: {
    // Verhindert doppelte React-Instanzen (Invalid hook call #321)
    dedupe: ['react', 'react-dom'],
    alias: {}
  },
  build: {
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2020',
    chunkSizeWarningLimit: 1500, // Increase limit - large deps like Phaser, LiveKit are unavoidable
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split large dependencies into separate chunks
          if (id.includes('node_modules')) {
            if (id.includes('phaser')) return 'vendor-phaser';
            if (id.includes('livekit-client')) return 'vendor-livekit';
            if (id.includes('colyseus') || id.includes('@colyseus')) return 'vendor-colyseus';
            if (id.includes('react-dom') || id.includes('react-router')) return 'vendor-react';
          }
        },
      },
    },
  },
  optimizeDeps: {
    force: true,
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    host: true,
    hmr: {
      host: process.env.VITE_HMR_HOST || 'localhost',
      protocol: process.env.VITE_HMR_PROTOCOL || 'ws'
    },
    allowedHosts: ['localhost'],
    proxy: {
      // Nur /packs proxien, damit statische Web-Assets (z. B. /maps/office.json) unangetastet bleiben
      '/packs': {
        // Hinweis: Im Browser nutzen wir VITE_API_BASE (localhost),
        // aber der Proxy läuft im Container. Dafür VITE_PROXY_TARGET (z. B. http://server:2567) verwenden.
        target: process.env.VITE_PROXY_TARGET || process.env.VITE_API_BASE || 'http://localhost:2567',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});

