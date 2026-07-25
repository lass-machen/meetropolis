/**
 * Global test setup: make supertest's HTTP client connect over the SAME address
 * family the throwaway server actually bound, so the full server suite stops
 * flaking.
 *
 * Root cause — a flaky, ~1-in-4 failure of the full suite that never reproduced
 * on a single file in isolation:
 *
 * `request(app)` makes supertest spin up an ephemeral server with `app.listen(0)`
 * (see node_modules/supertest/lib/test.js). With no host given, Node binds it to
 * the dual-stack IPv6 wildcard `::`. supertest then hard-codes the CLIENT URL to
 * `http://127.0.0.1:<port>` (test.js `serverAddress`), i.e. an IPv4 literal. So
 * every request crosses from an IPv4 client to an IPv6 dual-stack server via an
 * IPv4-mapped address. On macOS that translation is not perfectly reliable under
 * the load of the full parallel suite (hundreds of requests across ~14 forks): a
 * small fraction of connections are reset or deliver a torn response. That
 * surfaced non-deterministically as `ECONNRESET` / `socket hang up`, `Parse
 * Error: Expected HTTP/`, or — the connection never reaching the intended
 * app — a stray `404`/`403`/`200`. It was diagnosed by instrumenting the
 * transport: every failing request had `host=127.0.0.1` while every server
 * listened on `IPv6 ::`, and pinning the client onto the matching loopback drove
 * the failure rate from ~1-in-4 runs to 0 across 25 back-to-back full runs
 * (~15k requests). The production endpoints were never at fault (the same tests
 * pass in isolation, where the load is too low to trip the race).
 *
 * The fix aligns the two ends: when a server bound an IPv6 loopback, the client's
 * `127.0.0.1` target is rewritten to `::1` so the whole exchange stays on the
 * pure IPv6 loopback (no IPv4-mapped translation); when it bound IPv4, nothing
 * changes. This adapts to the host rather than assuming IPv6 exists — on an
 * IPv6-disabled runner `listen(0)` binds `0.0.0.0`/IPv4, the family map records
 * IPv4, and `127.0.0.1` is left untouched, so the exchange stays pure IPv4.
 *
 * Implementation notes:
 * - Vitest externalises node_modules, so neither `vi.mock` nor a Vite alias can
 *   intercept `import request from 'supertest'`. The Node builtins, however, are
 *   one shared instance reached through `createRequire`, so patching `http`
 *   there covers the servers and client requests supertest makes in every test
 *   file. (A plain `import http from 'node:http'` would yield Vitest's
 *   transformed module, NOT the builtin externalised supertest uses.)
 * - The port -> family map is filled synchronously in the `listen` patch —
 *   `listen(0)` assigns the address synchronously, the same read supertest
 *   itself relies on — and consulted in the `request` patch, which runs later
 *   (supertest builds the URL, then superagent connects). It lives on
 *   `globalThis` to survive Vitest's per-file module isolation.
 *
 * This neither retries, skips nor slows anything, and it touches no production
 * code and no individual test file; it only makes the test transport
 * deterministic.
 */
import { createRequire } from 'node:module';
import type { Server } from 'node:http';

// The native builtin — the same instance externalised supertest uses — not
// Vitest's transformed `node:http` module.
const nativeRequire = createRequire(import.meta.url);
const http = nativeRequire('http') as typeof import('node:http');

const globalWithState = globalThis as typeof globalThis & {
  __supertestLoopbackPatched__?: boolean;
  __supertestPortFamily__?: Map<number, 4 | 6>;
};

if (!globalWithState.__supertestLoopbackPatched__) {
  globalWithState.__supertestLoopbackPatched__ = true;
  const portFamily = (globalWithState.__supertestPortFamily__ ??= new Map<number, 4 | 6>());

  // Record the address family each ephemeral server binds. listen(0) assigns the
  // address synchronously, so it is readable right after the original call.
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function patchedListen(this: Server, ...args: unknown[]) {
    const result = originalListen.apply(this, args as never);
    const address = this.address();
    if (address && typeof address === 'object') {
      portFamily.set(address.port, address.family === 'IPv6' ? 6 : 4);
    }
    return result;
  } as typeof http.Server.prototype.listen;

  // Steer the client onto the loopback matching the server it is dialling.
  const originalRequest = http.request;
  http.request = function patchedRequest(this: unknown, ...args: unknown[]) {
    const options = args[0];
    if (options && typeof options === 'object') {
      const opts = options as { host?: string; hostname?: string; port?: number | string };
      const port = opts.port === undefined ? NaN : Number(opts.port);
      if (portFamily.get(port) === 6) {
        if (opts.host === '127.0.0.1') opts.host = '::1';
        if (opts.hostname === '127.0.0.1') opts.hostname = '::1';
      }
    }
    return originalRequest.apply(this, args as never);
  };
}
