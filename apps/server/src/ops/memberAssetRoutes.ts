/**
 * Protected delivery route for member files (`/member-assets/v1`).
 *
 * Legacy public paths stay reachable only while MEMBER_ASSETS_ENFORCE is
 * off; once enforced, `createLegacyAssetGuard` answers 404 and files are
 * served here after a fresh session, membership and owner check.
 */
import express from 'express';
import { npcMediaDir } from '../api/routes/npcMedia.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { customAvatarPacksDir } from '../services/avatarComposer.js';
import { readAuthCookie, readBearerToken } from '../types/authShapes.js';
import { isMemberAssetsEnforced } from './clientCompatibility.js';
import { authorizeMemberAsset, type MemberAssetDecision } from './memberAssetAuthorization.js';
import { parseMemberAssetPath, resolveFileInRoot, type MemberAssetNamespace } from './memberAssetPath.js';

/** Mount point of the protected member-asset delivery route. */
export const MEMBER_ASSETS_PREFIX = '/member-assets/v1';

export interface MemberAssetRouterDeps {
  prisma: PrismaClient;
  packsRoot?: () => string;
  npcMediaRoot?: () => string;
}

function sendNotFound(res: express.Response): void {
  res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
}

// Raw path rest below the route prefix, taken from the undecoded original
// URL (never from req.params, which Express already decoded).
function rawRest(req: express.Request, routePrefix: '/packs/' | '/npc-media/'): string | null {
  const queryIndex = req.originalUrl.indexOf('?');
  const pathOnly = queryIndex === -1 ? req.originalUrl : req.originalUrl.slice(0, queryIndex);
  const prefix = `${req.baseUrl}${routePrefix}`;
  if (!pathOnly.startsWith(prefix)) return null;
  return pathOnly.slice(prefix.length);
}

export function createMemberAssetRouter(deps: MemberAssetRouterDeps): express.Router {
  const packsRoot = deps.packsRoot ?? (() => customAvatarPacksDir());
  const npcMediaRoot = deps.npcMediaRoot ?? (() => npcMediaDir());
  const router = express.Router();

  const serve =
    (namespace: MemberAssetNamespace, rootOf: () => string): express.RequestHandler =>
    async (req, res) => {
      const rest = rawRest(req, namespace === 'packs' ? '/packs/' : '/npc-media/');
      if (rest === null) {
        sendNotFound(res);
        return;
      }
      const target = parseMemberAssetPath(namespace, rest);
      if (target === null) {
        sendNotFound(res);
        return;
      }
      const rawToken = readAuthCookie(req) ?? readBearerToken(req) ?? null;
      const tenantId = req.tenant?.id ?? null;
      let decision: MemberAssetDecision;
      try {
        decision = await authorizeMemberAsset(deps.prisma, { rawToken, tenantId, target });
      } catch {
        res.status(503).set('Cache-Control', 'no-store').json({ error: 'unavailable' });
        return;
      }
      if (decision === 'unauthenticated') {
        res.status(401).set('Cache-Control', 'no-store').json({ error: 'unauthenticated' });
        return;
      }
      if (decision === 'forbidden') {
        res.status(403).set('Cache-Control', 'no-store').json({ error: 'forbidden' });
        return;
      }
      if (decision === 'not_found') {
        sendNotFound(res);
        return;
      }
      let file: string | null;
      try {
        file = await resolveFileInRoot(rootOf(), target.relativePath);
      } catch {
        res.status(503).set('Cache-Control', 'no-store').json({ error: 'unavailable' });
        return;
      }
      if (file === null) {
        sendNotFound(res);
        return;
      }
      res.sendFile(
        file,
        {
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
          etag: false,
          lastModified: false,
          cacheControl: false,
          // parseMemberAssetPath already rejects dot segments; checking dotfiles here
          // would test the whole absolute path, including the storage root itself.
          dotfiles: 'allow',
          acceptRanges: true,
        },
        (error) => {
          if (error && !res.headersSent) sendNotFound(res);
        },
      );
    };

  router.get('/packs/*rest', serve('packs', packsRoot));
  router.get('/npc-media/*rest', serve('npc-media', npcMediaRoot));
  return router;
}

/**
 * Legacy static-asset guard: while enforcement is off the request passes
 * through to the unchanged static handler; once enforced it answers 404.
 */
export function createLegacyAssetGuard(
  isEnforced: () => boolean = () => isMemberAssetsEnforced(),
): express.RequestHandler {
  return (_req, res, next) => {
    if (!isEnforced()) {
      next();
      return;
    }
    sendNotFound(res);
  };
}
