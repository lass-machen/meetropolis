import { z } from 'zod';

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_NAME_LENGTH = 200;
const MAX_AVATAR_ID_LENGTH = 256;
const MAX_URL_LENGTH = 512;
const MAX_CREDENTIAL_LENGTH = 512;
const MAX_STORAGE_PATH_LENGTH = 512;
const MAX_MIME_TYPE_LENGTH = 128;
const MAX_MOVE_SPEED = 1000;

const MIME_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*\/[a-zA-Z0-9+.-]+$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:/;

const identifier = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
export const tenantSlug = z.string().min(1).max(MAX_IDENTIFIER_LENGTH);
const finiteNumber = z.number().finite();
const strictBoolean = z.boolean();
const npcDirection = z.enum(['up', 'down', 'left', 'right']);

function serviceUrl(protocols: readonly string[]): z.ZodString {
  return z
    .string()
    .min(1)
    .max(MAX_URL_LENGTH)
    .refine((value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    });
}

function isConfinedMediaPath(value: string): boolean {
  if (value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE_PATTERN.test(value)) {
    return false;
  }
  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

const npcDefinition = z.object({
  id: identifier,
  tenantId: identifier,
  identity: identifier,
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  avatarId: z.string().min(1).max(MAX_AVATAR_ID_LENGTH),
  spawnX: finiteNumber,
  spawnY: finiteNumber,
  spawnDirection: npcDirection,
  enabled: strictBoolean,
  showBadge: strictBoolean,
  mapName: z.string().min(1).max(MAX_NAME_LENGTH).nullish(),
  config: z.record(z.string(), z.unknown()).nullish(),
});

export const spawnCommand = z.object({
  npc: npcDefinition,
  tenantSlug,
  serverUrl: serviceUrl(['http:', 'https:']),
  livekitUrl: serviceUrl(['ws:', 'wss:']),
  livekitApiKey: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
  livekitApiSecret: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
});

export const despawnCommand = z.object({
  identity: identifier,
  tenantSlug,
});

export const tenantField = z.object({
  tenantSlug: tenantSlug.optional(),
});

const movePayload = z.object({
  x: finiteNumber,
  y: finiteNumber,
  speed: z.number().finite().positive().max(MAX_MOVE_SPEED).optional(),
});

const mediaPayload = z.object({
  mediaFileId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  loop: strictBoolean.optional(),
  storagePath: z.string().min(1).max(MAX_STORAGE_PATH_LENGTH).refine(isConfinedMediaPath).optional(),
  mimeType: z.string().min(1).max(MAX_MIME_TYPE_LENGTH).regex(MIME_TYPE_PATTERN).optional(),
});

const dndPayload = z.object({
  dnd: strictBoolean,
});

const avatarPayload = z.object({
  avatarId: z.string().min(1).max(MAX_AVATAR_ID_LENGTH),
});

export const roomCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), payload: movePayload }),
  z.object({ action: z.literal('stop_movement') }),
  z.object({ action: z.literal('play_audio'), payload: mediaPayload }),
  z.object({ action: z.literal('play_video'), payload: mediaPayload }),
  z.object({ action: z.literal('play_screenshare'), payload: mediaPayload }),
  z.object({ action: z.literal('stop_media') }),
  z.object({ action: z.literal('set_dnd'), payload: dndPayload }),
  z.object({ action: z.literal('set_avatar'), payload: avatarPayload }),
]);

export type ValidatedSpawnCommand = z.infer<typeof spawnCommand>;
export type ValidatedRoomCommand = z.infer<typeof roomCommand>;
