export const config = {
  port: Number(process.env.PORT || 3100),
  serverUrl: process.env.SERVER_URL || 'http://server:2567',
  livekitUrl: process.env.LIVEKIT_URL || 'ws://livekit:7880',
  livekitApiKey: process.env.LIVEKIT_API_KEY || 'devkey',
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
  npcServiceSecret: process.env.NPC_SERVICE_SECRET || 'dev-npc-secret',
  npcMediaDir: process.env.NPC_MEDIA_DIR || '/data/npc-media',
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;
