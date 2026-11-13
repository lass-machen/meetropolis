/**
 * Operator tools route.
 *
 * Serves the six allowed operator tools under /tools. Every response of that
 * mount carries a Content-Security-Policy: a strict fallback for everything
 * that is not an allowed file - including the 401 of the Basic Auth in front
 * of the mount - and, for an allowed file, a policy computed from that
 * file's own bytes: the SHA-256 hashes of its inline script and style blocks
 * plus the exact URLs of its external script and stylesheet references.
 *
 * A file is read once, on the first request that asks for it, and then
 * cached for the lifetime of the process. The delivered bytes and the
 * allowed hashes therefore always belong to the same file version.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import express from 'express';
import { logger } from '../logger.js';

/**
 * The only files served under /tools. Every other path answers 404, in
 * development and in production alike.
 */
const ALLOWED_TOOL_FILES = [
  'super-admin.html',
  'map-editor.html',
  'avatar-pack-manager.html',
  'npc-admin.html',
  'sprite-asset-cutter.html',
  'ui-prototype.html',
] as const;

type AllowedToolFile = (typeof ALLOWED_TOOL_FILES)[number];

/**
 * Fallback policy for every response that is not an allowed tool file. It
 * allows nothing and only states the directives that keep a response from
 * being framed, based or plugin driven.
 */
const BASE_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";

/**
 * Font sources per file. Five tools load the font files of their Google
 * Fonts stylesheet from fonts.gstatic.com, the UI prototype loads the
 * font-awesome webfonts from the cdnjs webfont directory.
 */
const FONT_SOURCES: Record<AllowedToolFile, readonly string[]> = {
  'super-admin.html': ['https://fonts.gstatic.com'],
  'map-editor.html': ['https://fonts.gstatic.com'],
  'avatar-pack-manager.html': ['https://fonts.gstatic.com'],
  'npc-admin.html': ['https://fonts.gstatic.com'],
  'sprite-asset-cutter.html': ['https://fonts.gstatic.com'],
  'ui-prototype.html': ['https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/'],
};

/**
 * Additional connect sources, proven by the tool sources.
 *
 * avatar-pack-manager.html reads the selected spritesheet as a data: URL
 * (tools/avatar-pack-manager.html:659) and fetches that URL back to turn it
 * into the upload blob (tools/avatar-pack-manager.html:1071).
 */
const EXTRA_CONNECT_SOURCES: Partial<Record<AllowedToolFile, readonly string[]>> = {
  'avatar-pack-manager.html': ['data:'],
};

export interface ToolsRouteOptions {
  /** Directory that holds the tool files. */
  readonly toolsDir: string;
  /** Exact https origins the tools may talk to, see parseToolsApiOrigins. */
  readonly apiOrigins: readonly string[];
}

interface ScannedToolHtml {
  /** Hash source expressions of the inline script and style blocks. */
  readonly inlineHashes: readonly string[];
  /** Exact URLs of the external script references. */
  readonly externalScripts: readonly string[];
  /** Exact URLs of the external stylesheet references. */
  readonly externalStyles: readonly string[];
}

interface LoadedToolFile {
  readonly body: Buffer;
  readonly contentSecurityPolicy: string;
}

interface OpenTag {
  readonly name: string;
  readonly attributes: Map<string, string>;
  /** Index right behind the closing '>' of the tag. */
  readonly end: number;
}

/**
 * Parses TOOLS_API_ORIGINS.
 *
 * The value is a comma separated list of exact https origins
 * (https://host[:port]) without a path and without a wildcard. An empty or
 * missing value means that the tools may only talk to their own origin. An
 * invalid value aborts the start of the server and names the key, never the
 * value.
 */
export function parseToolsApiOrigins(raw: string | undefined): string[] {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return [];
  const origins: string[] = [];
  for (const entry of trimmed.split(',')) {
    const candidate = entry.trim();
    if (!isExactHttpsOrigin(candidate)) {
      throw new Error('TOOLS_API_ORIGINS must contain exact https origins (https://host[:port])');
    }
    origins.push(candidate);
  }
  return origins;
}

function isExactHttpsOrigin(value: string): boolean {
  if (value === '' || value.includes('*')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
  return url.origin === value;
}

/**
 * Sets the fallback policy. It runs in front of the Basic Auth so that the
 * 401 of the authentication also carries a policy.
 */
export function toolsBaseCsp(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('Content-Security-Policy', BASE_CONTENT_SECURITY_POLICY);
  next();
}

/**
 * Builds the route that serves the allowed tool files. Files are read and
 * hashed on the first request that asks for them and then cached.
 */
export function createToolsRoute(options: ToolsRouteOptions): express.RequestHandler {
  const cache = new Map<AllowedToolFile, LoadedToolFile>();
  return (req: express.Request, res: express.Response): void => {
    const file = resolveAllowedToolFile(req.path);
    if (file === null || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.status(404).send('Not found');
      return;
    }
    let loaded: LoadedToolFile;
    try {
      loaded = getToolFile(cache, options, file);
    } catch (error) {
      logger.error({ event: 'tools.load_failed', file, err: error });
      if (isMissingFileError(error)) {
        res.status(404).send('Not found');
        return;
      }
      res.status(500).send('Tool unavailable');
      return;
    }
    res.setHeader('Content-Security-Policy', loaded.contentSecurityPolicy);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type('text/html').send(loaded.body);
  };
}

function getToolFile(
  cache: Map<AllowedToolFile, LoadedToolFile>,
  options: ToolsRouteOptions,
  file: AllowedToolFile,
): LoadedToolFile {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const loaded = loadToolFile(options.toolsDir, file, options.apiOrigins);
  cache.set(file, loaded);
  logger.info({ event: 'tools.file_loaded', file });
  return loaded;
}

function resolveAllowedToolFile(requestPath: string): AllowedToolFile | null {
  const name = requestPath.startsWith('/') ? requestPath.slice(1) : requestPath;
  if (name === '' || name.includes('/') || name.includes('\\')) return null;
  return isAllowedToolFile(name) ? name : null;
}

function isAllowedToolFile(name: string): name is AllowedToolFile {
  return ALLOWED_TOOL_FILES.some((file) => file === name);
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function loadToolFile(toolsDir: string, file: AllowedToolFile, apiOrigins: readonly string[]): LoadedToolFile {
  const body = fs.readFileSync(path.join(toolsDir, file));
  const scanned = scanToolHtml(body.toString('utf8'), file);
  for (const url of [...scanned.externalScripts, ...scanned.externalStyles]) {
    if (!url.startsWith('https://')) {
      throw new Error(`Operator tool ${file} references ${url}, which is not served over https`);
    }
  }
  return { body, contentSecurityPolicy: buildContentSecurityPolicy(file, scanned, apiOrigins) };
}

function buildContentSecurityPolicy(
  file: AllowedToolFile,
  scanned: ScannedToolHtml,
  apiOrigins: readonly string[],
): string {
  const connectSources = ["'self'", ...apiOrigins, ...(EXTRA_CONNECT_SOURCES[file] ?? [])];
  return [
    "default-src 'none'",
    sourceList('script-src', [...scanned.inlineHashes, ...scanned.externalScripts]),
    "script-src-attr 'none'",
    sourceList('style-src', [...scanned.inlineHashes, ...scanned.externalStyles]),
    sourceList('font-src', FONT_SOURCES[file]),
    "img-src 'self' data: blob:",
    sourceList('connect-src', connectSources),
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

function sourceList(directive: string, sources: readonly string[]): string {
  return `${directive} ${sources.length > 0 ? sources.join(' ') : "'none'"}`;
}

/**
 * Collects the policy relevant parts of a tool file: the hashes of its inline
 * script and style blocks and the exact URLs of its external script and
 * stylesheet references.
 */
function scanToolHtml(html: string, file: AllowedToolFile): ScannedToolHtml {
  const inlineHashes: string[] = [];
  const externalScripts: string[] = [];
  const externalStyles: string[] = [];
  const openTagPattern = /<(script|style|link)(?=[\s/>])/gi;
  let match = openTagPattern.exec(html);
  while (match !== null) {
    const tag = readOpenTag(html, match.index);
    if (tag === null) {
      openTagPattern.lastIndex = match.index + 1;
    } else if (tag.name === 'script') {
      const source = tag.attributes.get('src');
      if (source === undefined) {
        const end = findClosingTag(html, tag.end, 'script', file);
        inlineHashes.push(hashInlineContent(html.slice(tag.end, end)));
        openTagPattern.lastIndex = end;
      } else {
        externalScripts.push(source);
      }
    } else if (tag.name === 'style') {
      const end = findClosingTag(html, tag.end, 'style', file);
      inlineHashes.push(hashInlineContent(html.slice(tag.end, end)));
      openTagPattern.lastIndex = end;
    } else {
      const relation = tag.attributes.get('rel');
      const href = tag.attributes.get('href');
      if (href !== undefined && relation !== undefined && isStylesheetRelation(relation)) {
        externalStyles.push(href);
      }
    }
    // The scan must always move forward, also when a block ends before the
    // tag that opened it.
    if (openTagPattern.lastIndex <= match.index) {
      openTagPattern.lastIndex = match.index + 1;
    }
    match = openTagPattern.exec(html);
  }
  return { inlineHashes, externalScripts, externalStyles };
}

function isStylesheetRelation(relation: string): boolean {
  const tokens = relation.toLowerCase().split(/\s+/);
  return tokens.includes('stylesheet');
}

/**
 * Hashes the content of an inline script or style block. The hash covers the
 * text exactly as the browser reads it: the characters between the tags, with
 * the line endings normalized the way the HTML parser normalizes them.
 */
function hashInlineContent(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('base64');
  return `'sha256-${digest}'`;
}

/**
 * Finds the closing tag of a script or style block. The search starts behind
 * the opening tag; a block without a closing tag is a broken tool file and
 * fails the load.
 */
function findClosingTag(html: string, from: number, name: string, file: AllowedToolFile): number {
  const pattern = new RegExp(`</${name}`, 'gi');
  pattern.lastIndex = from;
  const match = pattern.exec(html);
  if (match === null) {
    throw new Error(`Operator tool ${file} has no closing ${name} tag`);
  }
  return match.index;
}

/**
 * Reads an open tag: its name, its attributes and the index behind its
 * closing '>'. Quoted attribute values may contain a '>'.
 */
function readOpenTag(html: string, start: number): OpenTag | null {
  let index = start + 1;
  const nameStart = index;
  while (index < html.length && /[a-zA-Z]/.test(html[index])) index += 1;
  const name = html.slice(nameStart, index).toLowerCase();
  if (name === '') return null;
  const attributes = new Map<string, string>();
  while (index < html.length) {
    while (index < html.length && /\s/.test(html[index])) index += 1;
    if (index >= html.length) break;
    if (html[index] === '>') {
      index += 1;
      break;
    }
    if (html[index] === '/') {
      index += 1;
      continue;
    }
    const attributeStart = index;
    while (index < html.length && !/[\s=>/]/.test(html[index])) index += 1;
    const attribute = html.slice(attributeStart, index).toLowerCase();
    while (index < html.length && /\s/.test(html[index])) index += 1;
    const value = readAttributeValue(html, index);
    index = value.nextIndex;
    if (attribute !== '' && !attributes.has(attribute)) attributes.set(attribute, value.text);
  }
  return { name, attributes, end: index };
}

function readAttributeValue(html: string, index: number): { text: string; nextIndex: number } {
  if (html[index] !== '=') return { text: '', nextIndex: index };
  let cursor = index + 1;
  while (cursor < html.length && /\s/.test(html[cursor])) cursor += 1;
  const quote = html[cursor];
  if (quote === '"' || quote === "'") {
    cursor += 1;
    const textStart = cursor;
    while (cursor < html.length && html[cursor] !== quote) cursor += 1;
    return { text: html.slice(textStart, cursor), nextIndex: cursor + 1 };
  }
  const textStart = cursor;
  while (cursor < html.length && !/[\s>]/.test(html[cursor])) cursor += 1;
  return { text: html.slice(textStart, cursor), nextIndex: cursor };
}
