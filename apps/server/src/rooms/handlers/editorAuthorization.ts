import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { hasTenantAccess } from '../../api/utils/tenantMembership.js';
import { editorZoneSchema, MAX_EDITOR_ZONES } from '../../api/routes/editorStateSchema.js';
import { logger } from '../../logger.js';

/** Prisma surface the editor gate needs: the membership row for the role
 * check, the map row for the tenant check, and whatever the shared tenant
 * access rule reads. Callers pass the room's own client instance. */
export type EditorAuthPrisma = Pick<PrismaClient, 'map' | 'membership' | 'tenant'>;

/**
 * Live `editor_update` payloads the world room accepts. The `reload_all`
 * variant carries nothing but the optional sender-declared `mapId`; the
 * `zone` variant carries the zone list, validated zone by zone against the
 * same schema the editor-state route uses. Unknown keys on the `zone`
 * variant are dropped by the parse, so only typed data reaches the
 * broadcast. An unknown `type` fails the parse and the message is dropped.
 */
const mapIdSchema = z.string().min(1).max(256).optional();

export const editorUpdateSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reload_all'), mapId: mapIdSchema }).strict(),
  z.object({
    type: z.literal('zone'),
    mapId: mapIdSchema,
    polys: z.array(editorZoneSchema).max(MAX_EDITOR_ZONES),
  }),
]);

export type EditorUpdateInput = z.infer<typeof editorUpdateSchema>;

/**
 * Fresh, database-backed editor proof for one live update: the sender holds an
 * active membership with role `owner` or `admin` in the proven tenant (plus
 * the shared tenant access rule), and the map belongs to that same tenant.
 * Fails closed (false) on any mismatch or lookup error.
 */
export async function authorizeEditorUpdate(
  prisma: EditorAuthPrisma,
  userId: string,
  tenantId: string,
  mapId: string,
): Promise<boolean> {
  try {
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { role: true },
    });
    if (membership?.role !== 'owner' && membership?.role !== 'admin') return false;
    if (!(await hasTenantAccess(prisma, userId, tenantId))) return false;
    const map = await prisma.map.findUnique({ where: { id: mapId }, select: { tenantId: true } });
    return map?.tenantId === tenantId;
  } catch (e: unknown) {
    logger.debug('[WorldRoom] Editor authorization lookup failed', e);
    return false;
  }
}
