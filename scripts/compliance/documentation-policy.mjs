// Policy schema readers for the deterministic offline documentation check.
//
// Holds the schema constants and the snapshot/policy readers used by
// checkDocumentation. No hashing, no text parsing and no issue logic here.

const POLICY_PATH = 'compliance/policy.json';
const SCHEMA_VERSION = 1;
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';

function fail() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = 'COMPLIANCE_DATA_INVALID';
  throw error;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// A single SPDX id: ASCII letter or digit first, then only ASCII
// letters, digits, dots, plus signs or hyphens. Reserved operator
// words are no ids. No registry or network lookup is involved.
function isSpdxId(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value === 'AND' || value === 'OR' || value === 'WITH') return false;
  return /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(value);
}

// Safe relative POSIX path without traversal, backslash or control chars.
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/^[a-zA-Z]:($|\/)/.test(value)) return false;
  return value.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function dirnameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function basenameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// Snapshot of repository relative paths to file bytes.
function readSnapshot(files) {
  if (!(files instanceof Map)) fail();
  const snapshot = new Map();
  for (const [key, value] of files) {
    if (!isSafeRelativePath(key)) fail();
    if (!Buffer.isBuffer(value)) fail();
    snapshot.set(key, value);
  }
  return snapshot;
}

function readJsonDocument(snapshot, path) {
  const bytes = snapshot.get(path);
  if (bytes === undefined) fail();
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail();
  }
  if (!isObject(parsed)) fail();
  return parsed;
}

// Areas with their path assignment; the longest matching path wins.
function readAreas(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const areas = [];
  const ids = new Set();
  const usedPaths = new Set();
  let rootFallbacks = 0;
  for (const area of value) {
    if (!isObject(area) || !isNonEmptyString(area.id)) fail();
    if (ids.has(area.id)) fail();
    ids.add(area.id);
    if (!Array.isArray(area.paths) || area.paths.length === 0) fail();
    const paths = [];
    for (const candidate of area.paths) {
      if (candidate !== '' && !isSafeRelativePath(candidate)) fail();
      if (usedPaths.has(candidate)) fail();
      usedPaths.add(candidate);
      if (candidate === '') rootFallbacks += 1;
      paths.push(candidate);
    }
    const additionalAllowedLicenses =
      area.additionalAllowedLicenses === undefined
        ? []
        : readLicenseIdList(area.additionalAllowedLicenses, { allowEmpty: true });
    areas.push({ id: area.id, paths, additionalAllowedLicenses });
  }
  // Exactly one area owns the root fallback, so every path has an area.
  if (rootFallbacks !== 1) fail();
  return areas;
}

// An SPDX id list of the policy: every entry is a single SPDX id and
// appears exactly once. A missing required list fails instead of
// silently defaulting to an empty list.
function readLicenseIdList(value, { allowEmpty }) {
  if (!Array.isArray(value)) fail();
  if (!allowEmpty && value.length === 0) fail();
  const seen = new Set();
  for (const id of value) {
    if (!isSpdxId(id)) fail();
    if (seen.has(id)) fail();
    seen.add(id);
  }
  return [...value];
}

function readReviewIds(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail();
  const ids = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isObject(entry) || !isSpdxId(entry.id)) fail();
    if (seen.has(entry.id)) fail();
    seen.add(entry.id);
    ids.push(entry.id);
  }
  return ids;
}

function readFontLicenses(assets) {
  if (assets === undefined) return [];
  if (!isObject(assets)) fail();
  if (assets.fontLicenses === undefined) return [];
  return readLicenseIdList(assets.fontLicenses, { allowEmpty: false });
}

// The versioned masked-content rule: literal license ids and keywords to
// scan for inside masked contexts, plus exactly scoped exceptions. Every
// id of the existing policy license fields must be covered; keywords are
// literal strings matched case-insensitively, never policy regex.
function readMaskedContent(value, coverage, docPaths) {
  if (!isObject(value)) fail();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['allowlist', 'keywords', 'licenseIds'])) fail();
  const licenseIds = readLicenseIdList(value.licenseIds, { allowEmpty: false });
  for (const id of coverage) {
    if (!licenseIds.includes(id)) fail();
  }
  if (!Array.isArray(value.keywords) || value.keywords.length === 0) fail();
  const seenKeywords = new Set();
  const keywords = [];
  for (const keyword of value.keywords) {
    if (typeof keyword !== 'string' || keyword.trim().length === 0) fail();
    const collapsed = keyword.trim().replace(/\s+/g, ' ');
    const normalized = collapsed.toLowerCase();
    if (seenKeywords.has(normalized)) fail();
    seenKeywords.add(normalized);
    keywords.push(collapsed);
  }
  if (!Array.isArray(value.allowlist)) fail();
  const seenKeys = new Set();
  const allowlist = [];
  for (const entry of value.allowlist) {
    if (!isObject(entry)) fail();
    if (
      JSON.stringify(Object.keys(entry).sort()) !==
      JSON.stringify(['contextSha256', 'kind', 'occurrence', 'path', 'reason'])
    ) {
      fail();
    }
    if (!docPaths.includes(entry.path)) fail();
    if (entry.kind !== 'code-span' && entry.kind !== 'fence' && entry.kind !== 'comment') fail();
    if (typeof entry.contextSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.contextSha256)) fail();
    if (!Number.isInteger(entry.occurrence) || entry.occurrence < 1) fail();
    if (typeof entry.reason !== 'string' || entry.reason.trim().length === 0) fail();
    const key = `${entry.path}|${entry.kind}|${entry.contextSha256}|${entry.occurrence}`;
    if (seenKeys.has(key)) fail();
    seenKeys.add(key);
    allowlist.push({
      path: entry.path,
      kind: entry.kind,
      contextSha256: entry.contextSha256,
      occurrence: entry.occurrence,
      reason: entry.reason,
    });
  }
  return { licenseIds, keywords, allowlist };
}

function readLicenseByArea(value, areas) {
  if (!isObject(value)) fail();
  const areaIds = areas.map((area) => area.id);
  for (const [areaId, license] of Object.entries(value)) {
    if (!areaIds.includes(areaId)) fail();
    if (!isSpdxId(license)) fail();
  }
  for (const areaId of areaIds) {
    if (!isSpdxId(value[areaId])) fail();
  }
  return new Map(Object.entries(value));
}

function readManifestList(value) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const paths = [];
  for (const candidate of value) {
    if (!isSafeRelativePath(candidate)) fail();
    if (basenameOf(candidate) !== 'package.json') fail();
    if (paths.includes(candidate)) fail();
    paths.push(candidate);
  }
  return paths;
}

// Area of a component path: the longest matching area path wins, the
// root path is the fallback of every area.
function areaFor(path, areas) {
  let best = null;
  let bestLength = -1;
  for (const area of areas) {
    for (const candidate of area.paths) {
      const matches = candidate === '' || path === candidate || path.startsWith(`${candidate}/`);
      if (matches && candidate.length > bestLength) {
        best = area;
        bestLength = candidate.length;
      }
    }
  }
  if (best === null) fail();
  return best;
}

// Documentation rules of the policy: the component table, the root
// readme groups with their badges, and the asset-lab readme. Groups and
// the asset-lab component cover every manifest component exactly once,
// and the badges name exactly the distinct group licenses.
function readComponentTable(value) {
  if (!isObject(value)) fail();
  if (!isSafeRelativePath(value.path)) fail();
  if (!isNonEmptyString(value.heading)) fail();
  // The root alias is a table label, never a path to open: it may look
  // like an absolute path, but carries no traversal or control chars.
  if (typeof value.rootAlias !== 'string' || value.rootAlias.trim().length === 0) fail();
  if (/[\x00-\x1f\x7f]/.test(value.rootAlias) || value.rootAlias.includes('\\')) fail();
  return { path: value.path, heading: value.heading.trim(), rootAlias: value.rootAlias.trim() };
}

function readReadmeGroups(value, components, expectedFor) {
  if (!Array.isArray(value) || value.length === 0) fail();
  const groups = [];
  const seen = new Set();
  for (const raw of value) {
    if (!isObject(raw)) fail();
    if (!Array.isArray(raw.components) || raw.components.length === 0) fail();
    if (!isSpdxId(raw.license)) fail();
    if (!isSafeRelativePath(raw.licenseTarget)) fail();
    const members = [];
    for (const component of raw.components) {
      if (typeof component !== 'string') fail();
      if (!components.has(component)) fail();
      if (seen.has(component)) fail();
      seen.add(component);
      // The group license is the exact area license of every member.
      if (raw.license !== expectedFor(component)) fail();
      members.push(component);
    }
    if (new Set(members).size !== members.length) fail();
    groups.push({ components: members, license: raw.license, licenseTarget: raw.licenseTarget });
  }
  return { groups, seen };
}

function readReadme(value, components, expectedFor) {
  if (!isObject(value)) fail();
  if (!isSafeRelativePath(value.path)) fail();
  if (!isNonEmptyString(value.heading)) fail();
  if (!isNonEmptyString(value.rootMarker)) fail();
  if (!Array.isArray(value.badges) || value.badges.length === 0) fail();
  const badges = [];
  for (const badge of value.badges) {
    if (!isSpdxId(badge)) fail();
    if (badges.includes(badge)) fail();
    badges.push(badge);
  }
  const { groups, seen } = readReadmeGroups(value.groups, components, expectedFor);
  // The badges name exactly the distinct group licenses.
  const groupLicenses = [...new Set(groups.map((group) => group.license))].sort(compareStrings);
  if (JSON.stringify([...badges].sort(compareStrings)) !== JSON.stringify(groupLicenses)) fail();
  return {
    path: value.path,
    heading: value.heading.trim(),
    rootMarker: value.rootMarker,
    badges,
    groups,
    covered: seen,
  };
}

function readAssetLab(value, components, expectedFor) {
  if (!isObject(value)) fail();
  if (!isSafeRelativePath(value.path)) fail();
  if (!isSpdxId(value.license)) fail();
  if (!isSafeRelativePath(value.licenseTarget)) fail();
  // The scope of the asset-lab component is the directory of its readme
  // and has to exist as a manifest component.
  const scope = dirnameOf(value.path);
  if (!components.has(scope)) fail();
  // The asset-lab license is the exact area license of its scope.
  if (value.license !== expectedFor(scope)) fail();
  return { path: value.path, license: value.license, licenseTarget: value.licenseTarget, scope };
}

function readDocumentation(value, areas, licenseByArea, manifestPaths, coverage) {
  if (!isObject(value)) fail();
  const components = new Set(manifestPaths.map((manifest) => dirnameOf(manifest)));
  const expectedFor = (component) => {
    const license = licenseByArea.get(areaFor(component, areas).id);
    if (!isSpdxId(license)) fail();
    return license;
  };
  const componentTable = readComponentTable(value.componentTable);
  const readme = readReadme(value.readme, components, expectedFor);
  const assetLab = readAssetLab(value.assetLab, components, expectedFor);
  // Groups plus the asset-lab component cover every configured
  // component exactly once.
  const covered = new Set(readme.covered);
  if (covered.has(assetLab.scope)) fail();
  covered.add(assetLab.scope);
  if (covered.size !== components.size) fail();
  for (const component of components) {
    if (!covered.has(component)) fail();
  }
  const maskedContent = readMaskedContent(value.maskedContent, coverage, [
    componentTable.path,
    readme.path,
    assetLab.path,
  ]);
  return { componentTable, readme, assetLab, components, expectedFor, maskedContent };
}

function readPolicy(snapshot) {
  const document = readJsonDocument(snapshot, POLICY_PATH);
  if (document.schemaVersion !== SCHEMA_VERSION) fail();
  const areas = readAreas(document.areas);
  if (!isObject(document.metadata)) fail();
  const licenseByArea = readLicenseByArea(document.metadata.licenseByArea, areas);
  const manifests = readManifestList(document.metadata.manifests);
  const coverage = new Set([
    ...readLicenseIdList(document.commonAllowedLicenses, { allowEmpty: false }),
    ...areas.flatMap((area) => area.additionalAllowedLicenses),
    ...readReviewIds(document.reviewRequired),
    ...readFontLicenses(document.assets),
    ...licenseByArea.values(),
  ]);
  const documentation = readDocumentation(document.documentation, areas, licenseByArea, manifests, coverage);
  return { documentation };
}

export { basenameOf, compareStrings, isSpdxId, readPolicy, readSnapshot };
