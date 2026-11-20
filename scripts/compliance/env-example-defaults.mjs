// Closed automatic defaults for versioned env example templates (numeric, boolean, literal and URL rules).
//
// Pure policy validation and value-form matching. No file system, no network,
// no process env and no side effects. An invalid policy is reported through
// the caller-provided failData callback; foreign errors are never inspected.
const RULE_IDS = ['ENV-DEFAULT-NUMERIC', 'ENV-DEFAULT-BOOLEAN', 'ENV-DEFAULT-LITERAL', 'ENV-DEFAULT-URL'];
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/;
const PORT_MIN = 1;
const PORT_MAX = 65535;
const INTEGER_MAX = 2147483647;
const VALUE_REVIEW = 'ENV_EXAMPLE_VALUE_REVIEW_REQUIRED';
const ADDRESS_REVIEW = 'ENV_EXAMPLE_ADDRESS_REVIEW_REQUIRED';
const PORT_KEYS = ['PORT', 'POSTGRES_PORT', 'LK_RTC_TCP_PORT', 'LK_RTC_UDP_PORT', 'SMTP_PORT'];
const INTEGER_KEYS = [
  'AUDIO_ZONE_HYSTERESIS_SAMPLES',
  'AUDIO_ZONE_HYSTERESIS_MS',
  'AUDIO_ZONE_RECONCILE_INTERVAL_MS',
  'AUDIO_ZONE_PUSH_BATCH_MS',
  'AUDIO_ZONE_HYSTERESIS_SWEEP_MS',
  'VITE_LIVEKIT_TOKEN_TIMEOUT_MS',
  'VITE_LIVEKIT_CONNECT_TIMEOUT_MS',
  'VITE_LIVEKIT_URL_TIMEOUT_MS',
  'VITE_COLYSEUS_JOIN_TIMEOUT_MS',
  'VITE_COLYSEUS_STATE_TIMEOUT_MS',
  'VITE_MIC_PUBLISH_TIMEOUT_MS',
  'TRUST_PROXY',
  'RATE_LIMIT_LOGIN_WINDOW_MS',
  'RATE_LIMIT_LOGIN_MAX',
  'RATE_LIMIT_REGISTER_WINDOW_MS',
  'RATE_LIMIT_REGISTER_MAX',
  'RATE_LIMIT_PASSWORD_RESET_WINDOW_MS',
  'RATE_LIMIT_PASSWORD_RESET_MAX',
  'RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_MS',
  'RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX',
  'RATE_LIMIT_EMAIL_VERIFICATION_WINDOW_MS',
  'RATE_LIMIT_EMAIL_VERIFICATION_MAX',
  'RATE_LIMIT_GUEST_LOGIN_WINDOW_MS',
  'RATE_LIMIT_GUEST_LOGIN_MAX',
  'RATE_LIMIT_TENANT_SIGNUP_WINDOW_MS',
  'RATE_LIMIT_TENANT_SIGNUP_MAX',
  'RATE_LIMIT_AVATAR_COMPOSE_WINDOW_MS',
  'RATE_LIMIT_AVATAR_COMPOSE_MAX',
  'RATE_LIMIT_AVATAR_RESOLVE_WINDOW_MS',
  'RATE_LIMIT_AVATAR_RESOLVE_MAX',
  'RATE_LIMIT_MATCHMAKE_WINDOW_MS',
  'RATE_LIMIT_MATCHMAKE_MAX',
];
const BOOLEAN_KEYS = [
  'LK_RTC_USE_EXTERNAL_IP',
  'VITE_FEATURE_AV_SETTINGS',
  'VITE_FEATURE_VOICE_ONLY',
  'VITE_DEBUG_LOGS',
  'VITE_DEBUG_AUTOLOGIN',
  'COOKIE_SECURE',
  'PUBLIC_REGISTRATION_ENABLED',
  'RATE_LIMIT_ENABLED',
  'AVATAR_EDITOR_ENABLED',
  'MOBILE_GATEWAY_ENABLED',
  'SMTP_POOL',
  'SMTP_TLS_REJECT_UNAUTHORIZED',
  'SMTP_VERIFY_ON_BOOT',
];
const LITERALS = {
  NODE_ENV: ['development', 'test', 'production'],
  LOG_LEVEL: ['debug', 'info', 'warn', 'error', 'silent'],
  SMTP_SECURE: ['auto'],
};
const URL_RULES = {
  LIVEKIT_EXTERNAL_URL: { schemes: ['http', 'https', 'ws', 'wss'], paths: ['', '/'] },
  VITE_API_BASE: { schemes: ['http', 'https'], paths: ['', '/', '/api', '/api/'] },
  VITE_LIVEKIT_URL: { schemes: ['http', 'https', 'ws', 'wss'], paths: ['', '/'] },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Closed objects carry exactly the expected fields, nothing more.
// Compares against a sorted copy, so callers may list the expected keys in any order.
function exactKeys(value, expected, failData) {
  if (!isPlainObject(value)) failData();
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length) failData();
  for (let index = 0; index < wanted.length; index += 1) {
    if (keys[index] !== wanted[index]) failData();
  }
}

// Key lists stay within one closed table, without duplicates, role overlap
// or a second home in another rule list. Empty lists are allowed.
function readClosedKeys(value, allowed, seen, roles, failData) {
  if (!Array.isArray(value)) failData();
  for (const key of value) {
    if (typeof key !== 'string' || !allowed.includes(key)) failData();
    if (seen.has(key)) failData();
    if (roles.credentialKeys.has(key) || roles.addressKeys.has(key)) failData();
    seen.add(key);
  }
  return [...value];
}

// Closed string lists are non-empty, duplicate-free and table-bound.
function readClosedList(value, allowed, failData) {
  if (!Array.isArray(value) || value.length === 0) failData();
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.includes(entry)) failData();
    if (seen.has(entry)) failData();
    seen.add(entry);
  }
  return [...value];
}

function readLiteralMap(value, seen, failData) {
  if (!isPlainObject(value)) failData();
  const result = new Map();
  for (const key of Object.keys(value)) {
    const allowed = Object.hasOwn(LITERALS, key) ? LITERALS[key] : undefined;
    if (allowed === undefined) failData();
    if (seen.has(key)) failData();
    seen.add(key);
    result.set(key, readClosedList(value[key], allowed, failData));
  }
  return result;
}

function readUrlMap(value, seen, failData) {
  if (!isPlainObject(value)) failData();
  const result = new Map();
  for (const key of Object.keys(value)) {
    const spec = Object.hasOwn(URL_RULES, key) ? URL_RULES[key] : undefined;
    if (spec === undefined) failData();
    if (seen.has(key)) failData();
    seen.add(key);
    const entry = value[key];
    if (!isPlainObject(entry)) failData();
    exactKeys(entry, ['paths', 'schemes'], failData);
    result.set(key, {
      schemes: readClosedList(entry.schemes, spec.schemes, failData),
      paths: readClosedList(entry.paths, spec.paths, failData),
    });
  }
  return result;
}

// The versioned policy is optional: absent means strict behavior without
// automatic matches. A present policy must be fully closed.
export function readSafeDefaults(value, options) {
  if (value === undefined) return null;
  const failData = options.failData;
  const roles = { credentialKeys: options.credentialKeys, addressKeys: options.addressKeys };
  exactKeys(value, ['rules', 'version'], failData);
  if (value.version !== 1) failData();
  exactKeys(value.rules, RULE_IDS, failData);
  const seen = new Set();
  const rule1 = value.rules['ENV-DEFAULT-NUMERIC'];
  exactKeys(rule1, ['integerKeys', 'portKeys'], failData);
  const portKeys = new Set(readClosedKeys(rule1.portKeys, PORT_KEYS, seen, roles, failData));
  const integerKeys = new Set(readClosedKeys(rule1.integerKeys, INTEGER_KEYS, seen, roles, failData));
  const rule2 = value.rules['ENV-DEFAULT-BOOLEAN'];
  exactKeys(rule2, ['keys'], failData);
  const booleanKeys = new Set(readClosedKeys(rule2.keys, BOOLEAN_KEYS, seen, roles, failData));
  const rule3 = value.rules['ENV-DEFAULT-LITERAL'];
  exactKeys(rule3, ['literals'], failData);
  const literals = readLiteralMap(rule3.literals, seen, failData);
  const rule4 = value.rules['ENV-DEFAULT-URL'];
  exactKeys(rule4, ['urls'], failData);
  const urls = readUrlMap(rule4.urls, seen, failData);
  for (const key of seen) {
    if (roles.credentialKeys.has(key) || roles.addressKeys.has(key)) failData();
  }
  return { portKeys, integerKeys, booleanKeys, literals, urls };
}

function matchDecimal(value, min, max) {
  if (!CANONICAL_DECIMAL.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max;
}

// Raw syntax first, parser second: no normalization may widen the match.
function matchRawUrl(value, spec) {
  const schemeEnd = value.indexOf('://');
  if (schemeEnd < 0) return false;
  const scheme = value.slice(0, schemeEnd);
  if (!spec.schemes.includes(scheme)) return false;
  const rest = value.slice(schemeEnd + 3);
  if (rest.includes('?') || rest.includes('#')) return false;
  const slashAt = rest.indexOf('/');
  const authority = slashAt < 0 ? rest : rest.slice(0, slashAt);
  const rawPath = slashAt < 0 ? '' : rest.slice(slashAt);
  if (!spec.paths.includes(rawPath)) return false;
  if (authority.includes('@')) return false;
  let host = authority;
  let portText = null;
  const colonAt = authority.indexOf(':');
  if (colonAt >= 0) {
    host = authority.slice(0, colonAt);
    portText = authority.slice(colonAt + 1);
  }
  if (host !== 'localhost' && host !== '127.0.0.1') return false;
  if (portText !== null && !matchDecimal(portText, PORT_MIN, PORT_MAX)) return false;
  let url = null;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== `${scheme}:`) return false;
  if (url.hostname !== host) return false;
  return true;
}

// Closed match for one key and value, or null without any finding.
export function matchSafeDefault(key, value, safeDefaults) {
  if (safeDefaults === null || safeDefaults === undefined) return null;
  if (typeof key !== 'string' || typeof value !== 'string' || value === '') return null;
  if (safeDefaults.portKeys.has(key)) {
    if (!matchDecimal(value, PORT_MIN, PORT_MAX)) return null;
    return { ruleId: 'ENV-DEFAULT-NUMERIC', reviewCode: VALUE_REVIEW };
  }
  if (safeDefaults.integerKeys.has(key)) {
    if (!matchDecimal(value, 0, INTEGER_MAX)) return null;
    return { ruleId: 'ENV-DEFAULT-NUMERIC', reviewCode: VALUE_REVIEW };
  }
  if (safeDefaults.booleanKeys.has(key)) {
    if (value !== 'true' && value !== 'false') return null;
    return { ruleId: 'ENV-DEFAULT-BOOLEAN', reviewCode: VALUE_REVIEW };
  }
  const literals = safeDefaults.literals.get(key);
  if (literals !== undefined) {
    if (!literals.includes(value)) return null;
    return { ruleId: 'ENV-DEFAULT-LITERAL', reviewCode: VALUE_REVIEW };
  }
  const urls = safeDefaults.urls.get(key);
  if (urls !== undefined) {
    if (!matchRawUrl(value, urls)) return null;
    return { ruleId: 'ENV-DEFAULT-URL', reviewCode: ADDRESS_REVIEW };
  }
  return null;
}
