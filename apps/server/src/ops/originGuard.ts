/**
 * Origin guard: refuses a request whose Origin is not allowed before any
 * request listener sees it.
 *
 * Colyseus answers its matchmaking route from a request listener it prepends
 * to the HTTP server, before Express runs. A CORS middleware inside Express
 * therefore cannot protect that route, and the preflight it answers never
 * reaches the Express app at all. This guard sits in front of every bound
 * request listener: a foreign origin never reaches the matchmaking processing,
 * and a preflight is answered here with the exact allowed origin.
 *
 * Requests without an Origin header are not a browser request and pass
 * through: native clients, webhooks and health checks keep working, and the
 * route's own auth still decides.
 */
import type { RequestListener, Server, ServerResponse } from 'node:http';
import { logger } from '../logger.js';
import { ALLOWED_MAX_AGE, corsHeadersFor, keepsOwnCorsContract, type OriginPolicy } from './originPolicy.js';

export interface OriginGuardOptions {
  /** The policy every request is checked against. */
  policy: OriginPolicy;
}

function requestPath(url: string | undefined): string {
  if (url === undefined) return '';
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

function refuseForeignOrigin(res: ServerResponse, origin: string): void {
  logger.warn({ event: 'cors.origin_not_allowed', origin });
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Vary', 'Origin');
  res.end(JSON.stringify({ error: 'cors_origin_not_allowed' }));
}

function answerPreflight(res: ServerResponse, origin: string | undefined, policy: OriginPolicy): void {
  res.statusCode = 204;
  for (const [name, value] of Object.entries(corsHeadersFor(origin, policy))) res.setHeader(name, value);
  res.setHeader('Access-Control-Max-Age', ALLOWED_MAX_AGE);
  res.setHeader('Vary', 'Origin');
  res.end();
}

/**
 * Put the guard in front of every `request` listener the HTTP server has.
 *
 * Call this after the matchmaking guard has been installed, so that the
 * origin check runs before any listener - the matchmaking route included -
 * can act on the request.
 */
export function installOriginGuard(server: Server, options: OriginGuardOptions): void {
  const downstream = server.listeners('request') as RequestListener[];
  if (downstream.length === 0) {
    throw new Error('Origin guard: the HTTP server has no request listener to protect');
  }
  server.removeAllListeners('request');
  const forward: RequestListener = (req, res) => {
    for (const listener of downstream) listener.call(server, req, res);
  };
  server.on('request', (req, res) => {
    if (keepsOwnCorsContract(requestPath(req.url))) {
      forward(req, res);
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !options.policy.isAllowed(origin)) {
      refuseForeignOrigin(res, origin);
      return;
    }
    if (req.method === 'OPTIONS') {
      answerPreflight(res, origin, options.policy);
      return;
    }
    forward(req, res);
  });
}
