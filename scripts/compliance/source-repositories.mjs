// Pure helpers for GitHub repository coordinates in dependency values.
//
// githubRepositoryOf extracts a lowercased { owner, repo } pair from the
// dependency specifier forms that point at github.com and returns null
// for anything else. isForbiddenOrganizationRepository reports whether
// such a coordinate belongs to a configured organization without being
// allowlisted as public.

const URL_SCHEMES = ['git+ssh', 'ssh', 'git', 'https', 'http', 'git+https'];
const GITHUB_PATTERN = /^(?:[^/@\s]+@)?github\.com[/:](.+)$/i;
const SCP_PATTERN = /^(?:[^/@\s]+@)?github\.com:(.+)$/i;
const CODELOAD_PATTERN = /^(?:[^/@\s]+@)?codeload\.github\.com\/(.+)$/i;
const GITHUB_PREFIX = 'github:';

function stripSuffix(path) {
  const hash = path.indexOf('#');
  const withoutHash = hash === -1 ? path : path.slice(0, hash);
  const query = withoutHash.indexOf('?');
  return query === -1 ? withoutHash : withoutHash.slice(0, query);
}

function stripDotGit(repo) {
  return repo.length > 4 && repo.toLowerCase().endsWith('.git') ? repo.slice(0, -4) : repo;
}

function coordinateOf(owner, repo) {
  if (owner.length === 0 || repo.length === 0) return null;
  return { owner: owner.toLowerCase(), repo: stripDotGit(repo).toLowerCase() };
}

function coordinateFromPath(path, allowExtraSegments) {
  const parts = stripSuffix(path).split('/');
  if (allowExtraSegments) {
    if (parts.length < 2) return null;
    return coordinateOf(parts[0], parts[1]);
  }
  if (parts.length !== 2) return null;
  return coordinateOf(parts[0], parts[1]);
}

function coordinateFromSchemeUrl(value) {
  const schemeIndex = value.indexOf('://');
  if (schemeIndex === -1) return undefined;
  if (!URL_SCHEMES.includes(value.slice(0, schemeIndex).toLowerCase())) return null;
  const rest = value.slice(schemeIndex + 3);
  const github = GITHUB_PATTERN.exec(rest);
  // Archive and tarball URLs carry further path segments after owner/repo.
  if (github !== null) return coordinateFromPath(github[1], true);
  const codeload = CODELOAD_PATTERN.exec(rest);
  if (codeload !== null) return coordinateFromPath(codeload[1], true);
  return null;
}

// Extracts the GitHub { owner, repo } coordinate of a dependency value
// in lowercase, with a trailing .git as well as any #ref or ?query
// removed, or null when the value is no recognized GitHub form.
export function githubRepositoryOf(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.toLowerCase().startsWith(GITHUB_PREFIX)) {
    return coordinateFromPath(value.slice(GITHUB_PREFIX.length), false);
  }
  const fromUrl = coordinateFromSchemeUrl(value);
  if (fromUrl !== undefined) return fromUrl;
  const scp = SCP_PATTERN.exec(value);
  if (scp !== null) return coordinateFromPath(scp[1], false);
  if (value.includes(':')) return null;
  const head = value[0];
  if (head === '.' || head === '/' || head === '@' || head === '~') return null;
  return coordinateFromPath(value, false);
}

// Reports whether a dependency value points at a repository of one of
// the configured organizations without being allowlisted as public.
export function isForbiddenOrganizationRepository(value, organizationRepositories) {
  const coordinate = githubRepositoryOf(value);
  if (coordinate === null) return false;
  if (
    organizationRepositories === null ||
    typeof organizationRepositories !== 'object' ||
    !Array.isArray(organizationRepositories.owners) ||
    !Array.isArray(organizationRepositories.allowedPublic)
  ) {
    return false;
  }
  if (!organizationRepositories.owners.includes(coordinate.owner)) return false;
  return !organizationRepositories.allowedPublic.includes(`${coordinate.owner}/${coordinate.repo}`);
}
