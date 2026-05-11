import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { optionalSubmodules } from './optional-submodules';

export default defineConfig({
  plugins: [
    optionalSubmodules(),
    // Two vite versions coexist (root 5.x as transitive, apps/web 6.x direct).
    // The plugin-react types resolve against root's vite — runtime is fine,
    // tsc just sees mismatching nominal types. Double-cast keeps the check clean.
    react(),
  ],
  // Dedicated cache folder to safely bypass stale optimizations (Docker).
  cacheDir: '/tmp/.vite',
  resolve: {
    // Prevents duplicate React instances (Invalid hook call #321).
    dedupe: ['react', 'react-dom'],
    alias: {
      // The desktop submodule (packages/desktop) imports UI components from the web app.
      // This alias enables clean imports like '@app/ui/system' instead of long relative paths.
      '@app': resolve(__dirname, 'src'),
    },
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
      protocol: process.env.VITE_HMR_PROTOCOL || 'ws',
    },
    allowedHosts: ['localhost'],
    proxy: {
      // Only proxy /packs so static web assets (e.g. /maps/office.json) stay untouched.
      '/packs': {
        // Note: In the browser we use VITE_API_BASE (localhost),
        // but the proxy runs inside the container. Use VITE_PROXY_TARGET (e.g. http://server:2567) for that case.
        target: process.env.VITE_PROXY_TARGET || process.env.VITE_API_BASE || 'http://localhost:2567',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
