type CredentialEnvironment = Readonly<Record<string, string | undefined>>;

function readCredential(env: CredentialEnvironment, name: string, developmentDefault: string): string {
  const value = env[name];
  const development = env.NODE_ENV === 'development';
  if (value === undefined || value.trim().length === 0) {
    if (development) return developmentDefault;
    throw new Error(`${name} is required; configure LiveKit credentials before starting NPC integration.`);
  }
  if (!development && value.trim() === developmentDefault) {
    throw new Error(`${name} must not use the public development placeholder.`);
  }
  return value;
}

/** Public demo credentials are available only in explicit local development mode. */
export function readLivekitCredentials(env: CredentialEnvironment): { apiKey: string; apiSecret: string } {
  return {
    apiKey: readCredential(env, 'LIVEKIT_API_KEY', 'devkey'),
    apiSecret: readCredential(env, 'LIVEKIT_API_SECRET', 'secret'),
  };
}
