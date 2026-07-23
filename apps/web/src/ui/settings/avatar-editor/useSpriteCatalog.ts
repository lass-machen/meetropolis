import { useEffect, useState } from 'react';
// Vite emits the catalog as a content-hashed asset and returns its URL, so the
// 186 KB stays out of the JS bundle and cache-busting is automatic: a changed
// catalog yields a new hashed filename, so the editor preview can never render
// against a stale catalog (which would drift from the server-composited sheet).
import catalogUrl from '@meetropolis/shared/sprite/catalog.json?url';
import { assertSpriteCatalog, type SpriteCatalog } from '@meetropolis/shared';

let cached: SpriteCatalog | null = null;
let inflight: Promise<SpriteCatalog> | null = null;

async function fetchCatalog(): Promise<SpriteCatalog> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch(catalogUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`sprite catalog fetch failed: ${res.status}`);
        cached = assertSpriteCatalog(await res.json());
        return cached;
      })
      .catch((err) => {
        inflight = null; // allow a retry on a later mount
        throw err;
      });
  }
  return inflight;
}

interface CatalogState {
  catalog: SpriteCatalog | null;
  loading: boolean;
  error: string | null;
}

/** Load the shared sprite catalog once (module-cached), for the editor. */
export function useSpriteCatalog(): CatalogState {
  const [catalog, setCatalog] = useState<SpriteCatalog | null>(cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    void fetchCatalog().then(
      (c) => alive && setCatalog(c),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      alive = false;
    };
  }, []);

  return { catalog, loading: catalog === null && error === null, error };
}
