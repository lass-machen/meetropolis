import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  // eigener Cache-Ordner, um alte Optimierungen sicher zu umgehen (Docker)
  cacheDir: '/tmp/.vite',
  resolve: {
    // Verhindert doppelte React-Instanzen (Invalid hook call #321)
    dedupe: ['react', 'react-dom'],
    alias: {
      react: require.resolve('react'),
      'react-dom': require.resolve('react-dom')
    }
  },
  build: {
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2020'
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
    allowedHosts: ['meetropolis.s4.lmwow.de', 'localhost', 'razor-crest.local'],
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

