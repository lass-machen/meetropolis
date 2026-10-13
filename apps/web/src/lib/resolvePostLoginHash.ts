const ALLOWED_NEXT = /^#\/connect(\?[A-Za-z0-9_\-=&%.~]*)?$/;

/** Return `next` only when it is exactly a `#/connect` hash (optional query). */
export function resolvePostLoginHash(next: string | null): string {
  if (next !== null && ALLOWED_NEXT.test(next)) return next;
  return '#/app';
}

/** Read the decoded `next` query from a `#/login?next=…` hash. */
export function readLoginNextParam(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  if (q < 0) return null;
  if (raw.slice(0, q) !== '/login') return null;
  return new URLSearchParams(raw.slice(q + 1)).get('next');
}
