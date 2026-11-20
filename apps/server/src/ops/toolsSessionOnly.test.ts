import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Platform administration (super admin, internal owner pack management,
// /admin, /debug) never accepts a personal API token. The operator tools that
// call these routes therefore authenticate with the browser session only and
// offer no token input. Tools that only touch tenant content keep theirs.

const toolsDir = fileURLToPath(new URL('../../../../tools/', import.meta.url));

const PLATFORM_TOOLS = ['super-admin.html', 'avatar-pack-manager.html'] as const;
const CONTENT_TOOLS = ['map-editor.html', 'npc-admin.html'] as const;

/** Path fragments of routes that only accept a session. */
const PLATFORM_ROUTE_MARKERS = [
  "'/admin/",
  '`/admin/',
  "'/debug/",
  '`/debug/',
  '/asset-packs/upload',
  '/archive`',
  '/avatar-packs/upload-sprite',
] as const;

function readTool(file: string): string {
  return readFileSync(`${toolsDir}${file}`, 'utf8');
}

function apiFetchBody(html: string, file: string): string {
  const start = html.indexOf('async function apiFetch(');
  if (start < 0) throw new Error(`Missing apiFetch in ${file}`);
  const end = html.indexOf('\n}', start);
  if (end < 0) throw new Error(`Unterminated apiFetch in ${file}`);
  return html.slice(start, end);
}

describe('operator tools for platform routes use the session only', () => {
  it.each(PLATFORM_TOOLS)('%s offers no token input', (file) => {
    const html = readTool(file);
    expect(html).not.toMatch(/id="authToken"/);
    expect(html).not.toMatch(/placeholder="[^"]*token[^"]*"/i);
  });

  it.each(PLATFORM_TOOLS)('%s never sends an Authorization header', (file) => {
    const html = readTool(file);
    expect(html).not.toContain('Authorization');
    expect(html).not.toContain('Bearer');
  });

  it.each(PLATFORM_TOOLS)('%s always sends the session cookie', (file) => {
    const body = apiFetchBody(readTool(file), file);
    expect(body).toContain("credentials: 'include'");
    expect(body).not.toMatch(/token/i);
  });

  it.each(PLATFORM_TOOLS)('%s tells the operator that a sign-in is required', (file) => {
    expect(readTool(file)).toMatch(/id="sessionHint"/);
  });

  it('super-admin.html keeps no token in local storage', () => {
    const html = readTool('super-admin.html');
    expect(html).not.toContain("getItem('sa_authToken')");
    expect(html).not.toContain("setItem('sa_authToken'");
  });

  it('every root tool that calls a platform route is a session-only tool', () => {
    const rootTools = readdirSync(toolsDir).filter((name) => name.endsWith('.html'));
    const callers = rootTools.filter((file) => {
      const html = readTool(file);
      return PLATFORM_ROUTE_MARKERS.some((marker) => html.includes(marker));
    });
    expect(callers.sort()).toEqual([...PLATFORM_TOOLS].sort());
  });

  it.each(CONTENT_TOOLS)('%s keeps its token input for tenant content', (file) => {
    expect(readTool(file)).toMatch(/id="authToken"/);
  });
});
