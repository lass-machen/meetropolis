export type LoginOptions = {
  apiBase: string;
  tenant: string;
  email: string;
  password: string;
};

export type BotSession = {
  token: string;
  userId: string;
};

export type LoadtestAccount = {
  email: string;
  password: string;
};

export function apiHttpBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, '').replace(/^ws(s?):\/\//, 'http$1://');
}

export function apiWsBase(apiBase: string): string {
  return apiHttpBase(apiBase).replace(/^http(s?):\/\//, 'ws$1://');
}

export function authHeaders(tenant: string, token: string): Record<string, string> {
  return {
    'X-Tenant': tenant,
    Authorization: `Bearer ${token}`,
  };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

export async function readResponseJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return body;
}

export function parseAccounts(raw: string): LoadtestAccount[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('LOADTEST_ACCOUNTS_FILE must contain a JSON array');
  }
  return parsed.map(readAccount);
}

export async function loginBot(opts: LoginOptions): Promise<BotSession> {
  const response = await postLogin(opts);
  const body = await readJsonBody(response);
  if (!response.ok) throw loginError(response.status, body);
  const token = readAuthToken(response.headers);
  const userId = readUserId(body);
  if (!token || !userId) throw new Error(`login failed with status ${response.status}`);
  return { token, userId };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('LOADTEST_ACCOUNTS_FILE is not valid JSON');
  }
}

function readAccount(value: unknown): LoadtestAccount {
  if (typeof value !== 'object' || value === null) {
    throw new Error('LOADTEST_ACCOUNTS_FILE entries need email and password');
  }
  if (!('email' in value) || !('password' in value)) {
    throw new Error('LOADTEST_ACCOUNTS_FILE entries need email and password');
  }
  const email = value.email;
  const password = value.password;
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error('LOADTEST_ACCOUNTS_FILE entries need email and password');
  }
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('LOADTEST_ACCOUNTS_FILE entries need email and password');
  }
  return { email, password };
}

async function postLogin(opts: LoginOptions): Promise<Response> {
  try {
    return await fetch(`${apiHttpBase(opts.apiBase)}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': opts.tenant,
      },
      body: JSON.stringify({ email: opts.email, password: opts.password }),
    });
  } catch {
    throw new Error('login failed: network error');
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function loginError(status: number, body: unknown): Error {
  const code = readErrorCode(body);
  if (!code) return new Error(`login failed with status ${status}`);
  return new Error(`login failed with status ${status}: ${code}`);
}

function readErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error = body.error;
  if (typeof error !== 'string' || !/^[a-z0-9_ .:-]{1,80}$/i.test(error)) return null;
  if (error.split('.').length === 3) return null;
  return error;
}

function readUserId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('id' in body)) return null;
  const id = body.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readAuthToken(headers: Headers): string | null {
  for (const line of cookieHeaderLines(headers)) {
    const token = tokenFromCookieLine(line);
    if (token) return token;
  }
  return null;
}

function cookieHeaderLines(headers: Headers): string[] {
  const listed = headers.getSetCookie();
  if (listed.length > 0) return listed;
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function tokenFromCookieLine(line: string): string | null {
  const first = line.split(';')[0] ?? '';
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  if (first.slice(0, eq).trim() !== 'auth_token') return null;
  const raw = first.slice(eq + 1).trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
