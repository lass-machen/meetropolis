import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // eigener Cache-Ordner, um alte Optimierungen sicher zu umgehen (Docker)
  cacheDir: '/tmp/.vite',
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
    allowedHosts: ['meetropolis.s7.lmwow.de', 'localhost']
  }
});

