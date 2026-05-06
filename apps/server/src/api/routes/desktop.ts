import type express from 'express';
import { logger } from '../../logger.js';
import { pathParam } from '../utils/requestHelpers.js';

const GITHUB_REPO = 'lass-machen/meetropolis-desktop';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

let releasesCache: CacheEntry<any> | null = null;

async function fetchGitHubApi(path: string): Promise<any> {
  const token = process.env.GITHUB_DESKTOP_PAT;
  if (!token) {
    throw new Error('GITHUB_DESKTOP_PAT not configured');
  }

  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/${path}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'meetropolis-server',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getLatestRelease(): Promise<any> {
  if (releasesCache && Date.now() < releasesCache.expiresAt) {
    return releasesCache.data;
  }

  const release = await fetchGitHubApi('releases/latest');
  releasesCache = { data: release, expiresAt: Date.now() + CACHE_TTL_MS };
  return release;
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function getPlatformAssetPattern(target: string, arch: string): RegExp {
  if (target === 'darwin') {
    const archPart = arch === 'aarch64' ? 'aarch64' : 'x64';
    return new RegExp(`${archPart}.*\\.app\\.tar\\.gz$`);
  }
  return new RegExp(`x64.*\\.(msi\\.zip|nsis\\.zip)$`);
}

/** Sanitize filename for Content-Disposition header (prevent header injection) */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]/g, '_');
}

/** Resolve external-facing protocol (respects X-Forwarded-Proto behind reverse proxy) */
function getExternalProtocol(req: express.Request): string {
  const forwarded = req.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.protocol;
}

async function fetchSignature(sigAssetUrl: string): Promise<string> {
  try {
    const sigResponse = await fetch(sigAssetUrl, {
      headers: {
        Authorization: `token ${process.env.GITHUB_DESKTOP_PAT}`,
        Accept: 'application/octet-stream',
        'User-Agent': 'meetropolis-server',
      },
    });
    return await sigResponse.text();
  } catch (e) {
    logger.warn({ event: 'desktop.update.sig_fetch_failed', error: String(e) });
    return '';
  }
}

async function handleDesktopUpdate(req: express.Request, res: express.Response): Promise<void> {
  if (!process.env.GITHUB_DESKTOP_PAT) {
    res.status(503).json({ error: 'Update service not configured' });
    return;
  }

  try {
    const target = pathParam(req, 'target');
    const arch = pathParam(req, 'arch');
    const version = pathParam(req, 'version');
    const release = await getLatestRelease();
    const latestVersion = (release.tag_name || '').replace(/^v/, '');

    if (compareVersions(latestVersion, version) <= 0) {
      res.status(204).end();
      return;
    }

    const updatePattern = getPlatformAssetPattern(target, arch);
    const updateAsset = release.assets?.find((a: any) => updatePattern.test(a.name));

    if (!updateAsset) {
      logger.warn({ event: 'desktop.update.no_asset', target, arch, version });
      res.status(204).end();
      return;
    }

    const sigAsset = release.assets?.find((a: any) => a.name === `${updateAsset.name}.sig`);
    const signature = sigAsset ? await fetchSignature(sigAsset.url) : '';

    const proto = getExternalProtocol(req);
    const manifest = {
      version: latestVersion,
      pub_date: release.published_at || release.created_at,
      url: `${proto}://${req.get('host')}/desktop/download/${updateAsset.id}/${sanitizeFilename(updateAsset.name)}`,
      signature,
      notes: release.body || '',
    };

    res.json(manifest);
  } catch (error) {
    logger.error({ event: 'desktop.update.error', error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to check for updates' });
  }
}

async function streamAssetToResponse(reader: ReadableStreamDefaultReader<Uint8Array>, res: express.Response): Promise<void> {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (streamError) {
    logger.error({ event: 'desktop.download.stream_error', error: String(streamError) });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream interrupted' });
    } else {
      res.end();
    }
  }
}

async function handleDesktopDownload(req: express.Request, res: express.Response): Promise<void> {
  const token = process.env.GITHUB_DESKTOP_PAT;
  if (!token) {
    res.status(503).json({ error: 'Download service not configured' });
    return;
  }

  const asset_id = pathParam(req, 'asset_id');
  const filename = pathParam(req, 'filename');
  if (!/^\d+$/.test(asset_id)) {
    res.status(400).json({ error: 'Invalid asset ID' });
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${asset_id}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/octet-stream',
          'User-Agent': 'meetropolis-server',
        },
      }
    );

    if (!response.ok) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);

    if (response.headers.get('content-length')) {
      res.setHeader('Content-Length', response.headers.get('content-length')!);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      res.status(500).json({ error: 'Failed to stream asset' });
      return;
    }

    await streamAssetToResponse(reader, res);
  } catch (error) {
    logger.error({ event: 'desktop.download.error', error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Download failed' });
  }
}

function buildLatestAssets(assets: any[]): any[] {
  return assets
    .filter((a: any) => /\.(dmg|msi)$/i.test(a.name))
    .map((a: any) => {
      let platform = 'unknown';
      let arch = 'x64';
      if (/\.dmg$/i.test(a.name)) {
        platform = 'macos';
        arch = /aarch64/.test(a.name) ? 'aarch64' : 'x64';
      } else if (/\.msi$/i.test(a.name)) {
        platform = 'windows';
      }
      return {
        platform,
        arch,
        filename: a.name,
        url: `/desktop/download/${a.id}/${sanitizeFilename(a.name)}`,
        size: a.size,
      };
    });
}

async function handleDesktopLatest(_req: express.Request, res: express.Response): Promise<void> {
  if (!process.env.GITHUB_DESKTOP_PAT) {
    res.status(503).json({ error: 'Download service not configured' });
    return;
  }

  try {
    const release = await getLatestRelease();
    const assets = buildLatestAssets(release.assets || []);

    res.json({
      version: (release.tag_name || '').replace(/^v/, ''),
      date: release.published_at || release.created_at,
      notes: release.body || '',
      assets,
    });
  } catch (error) {
    logger.error({ event: 'desktop.latest.error', error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch latest release info' });
  }
}

export function registerDesktopRoutes(app: express.Application) {
  app.get('/desktop/update/:target/:arch/:version', handleDesktopUpdate);
  app.get('/desktop/download/:asset_id/:filename', handleDesktopDownload);
  app.get('/desktop/latest', handleDesktopLatest);
}
