// Comparison constant only: this value never passes validation.
const KNOWN_DEFAULT_SECRET = 'dev-npc-secret';

const MIN_SECRET_LENGTH = 32;

function readNpcServiceSecret(): string {
  const raw = process.env.NPC_SERVICE_SECRET;
  if (raw === undefined || raw.length === 0) {
    throw new Error('NPC_SERVICE_SECRET is missing: set it to a value of at least 32 characters.');
  }
  if (raw.trim().length === 0 || raw === KNOWN_DEFAULT_SECRET || raw.length < MIN_SECRET_LENGTH) {
    throw new Error('NPC_SERVICE_SECRET is invalid: provide at least 32 characters, not the documented placeholder.');
  }
  return raw;
}

export const config = {
  port: Number(process.env.PORT || 3100),
  serverUrl: process.env.SERVER_URL || 'http://server:2567',
  livekitUrl: process.env.LIVEKIT_URL || 'ws://host.docker.internal:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  npcServiceSecret: readNpcServiceSecret(),
  npcMediaDir: process.env.NPC_MEDIA_DIR || '/data/npc-media',
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;
