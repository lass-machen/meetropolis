import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { existsSync, mkdirSync, symlinkSync } from 'fs';
import react from '@vitejs/plugin-react';

/**
 * Vite-Plugin: Optional private submodules als leeres Modul auflösen.
 * Verhindert Fehler wenn @meetropolis/desktop (privates Submodule) nicht installiert ist.
 * Der desktopLoader.ts fängt den fehlenden Export per try/catch ab.
 *
 * Wenn das Submodule vorhanden ist (packages/desktop/package.json existiert),
 * wird der Import normal aufgelöst — das Plugin greift dann NICHT ein.
 * Als Fallback wird auch ein node_modules Symlink angelegt, falls npm ihn
 * nicht automatisch erstellt (bekanntes Problem mit Git Submodules).
 */
function optionalSubmodules(moduleIds: string[]): Plugin {
  const set = new Set(moduleIds);

  // Prüfe beim Plugin-Init welche Module tatsächlich vorhanden sind
  // und stelle sicher, dass der Workspace-Symlink existiert
  const present = new Set<string>();
  for (const id of moduleIds) {
    const pkgName = id.replace(/^@meetropolis\//, '');
    const pkgDir = resolve(__dirname, '../../packages', pkgName);
    const pkgJson = resolve(pkgDir, 'package.json');
    if (existsSync(pkgJson)) {
      present.add(id);
      // Symlink in node_modules sicherstellen (npm erstellt ihn bei Submodules nicht immer)
      const scope = id.split('/')[0]; // @meetropolis
      const linkDir = resolve(__dirname, '../../node_modules', scope);
      const linkPath = resolve(linkDir, pkgName);
      if (!existsSync(linkPath)) {
        try {
          mkdirSync(linkDir, { recursive: true });
          symlinkSync(pkgDir, linkPath, 'dir');
        } catch {}
      }
    }
  }

  return {
    name: 'optional-submodules',
    enforce: 'pre',
    resolveId(source) {
      if (set.has(source) && !present.has(source)) {
        return { id: `\0optional:${source}`, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      if (id.startsWith('\0optional:')) {
        return 'export default null;';
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    optionalSubmodules(['@meetropolis/desktop']),
    react(),
  ],
  // eigener Cache-Ordner, um alte Optimierungen sicher zu umgehen (Docker)
  cacheDir: '/tmp/.vite',
  resolve: {
    // Verhindert doppelte React-Instanzen (Invalid hook call #321)
    dedupe: ['react', 'react-dom'],
    alias: {
      // Desktop-Submodule (packages/desktop) importiert UI-Components aus der Web-App.
      // Dieser Alias ermöglicht saubere Imports wie '@app/ui/system' statt langer relativer Pfade.
      '@app': resolve(__dirname, 'src'),
    }
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

