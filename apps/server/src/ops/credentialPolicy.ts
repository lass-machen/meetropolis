/**
 * Production credential policy for the main server start path.
 *
 * Pure helper: inspects only the given environment mapping and returns the
 * names of keys that violate the production rules. It never prints values,
 * never touches the database or the network, and never imports the
 * application graph, so the boot adapter and later seed tooling can share
 * the same mode detection and rules without side effects.
 */

const PRODUCTION_MODE = 'production';

// Known public template placeholders. Derived once from the versioned
// template state (.env.example: key entries for the LiveKit pair, the
// database url, the database password, and the tools password) and kept in
// this single place instead of spreading a second list across readers.
const TEMPLATE_LIVEKIT_API_KEY = 'devkey';
const TEMPLATE_LIVEKIT_API_SECRET = 'secret';
const TEMPLATE_TOOLS_PASSWORD = 'changeme';
// Password part shared by the versioned template entries for DATABASE_URL
// and POSTGRES_PASSWORD.
const TEMPLATE_DATABASE_PASSWORD = 'postgres';

export function isProductionEnvironment(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === PRODUCTION_MODE;
}

function isUsableSecret(value: string | undefined, blocked: readonly string[]): boolean {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !blocked.includes(trimmed);
}

// Resolves the effective database password the driver would use: a password
// carried by the url query takes precedence over the userinfo password, and
// percent-encoding never bypasses the comparison. Returns null when no
// usable password can be determined.
function extractDatabasePassword(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    return null;
  }
  const queryPassword = url.searchParams.get('password');
  if (queryPassword !== null) {
    return queryPassword;
  }
  try {
    return decodeURIComponent(url.password);
  } catch {
    return null;
  }
}

function isUsableDatabaseUrl(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }
  const password = extractDatabasePassword(value);
  return password !== null && isUsableSecret(password, [TEMPLATE_DATABASE_PASSWORD]);
}

export function findInvalidCredentialKeys(env: Record<string, string | undefined>): string[] {
  if (!isProductionEnvironment(env)) {
    return [];
  }
  const invalid: string[] = [];
  if (!isUsableSecret(env.LIVEKIT_API_KEY, [TEMPLATE_LIVEKIT_API_KEY])) {
    invalid.push('LIVEKIT_API_KEY');
  }
  if (!isUsableSecret(env.LIVEKIT_API_SECRET, [TEMPLATE_LIVEKIT_API_SECRET])) {
    invalid.push('LIVEKIT_API_SECRET');
  }
  if (!isUsableDatabaseUrl(env.DATABASE_URL)) {
    invalid.push('DATABASE_URL');
  }
  const postgresPassword = env.POSTGRES_PASSWORD;
  if (postgresPassword !== undefined && !isUsableSecret(postgresPassword, [TEMPLATE_DATABASE_PASSWORD])) {
    invalid.push('POSTGRES_PASSWORD');
  }
  const toolsPassword = env.TOOLS_PASSWORD;
  if (
    toolsPassword !== undefined &&
    toolsPassword !== '' &&
    !isUsableSecret(toolsPassword, [TEMPLATE_TOOLS_PASSWORD])
  ) {
    invalid.push('TOOLS_PASSWORD');
  }
  return invalid;
}
