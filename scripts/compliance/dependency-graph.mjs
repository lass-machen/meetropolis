// Transitive production dependency closure from an npm lockfile v3 table.
//
// Only already-parsed input is used; no further files are opened and no
// network or node_modules access happens. Reachability follows exclusively
// dependencies, optionalDependencies, peerDependencies, declared bundled
// lists, and explicit extraDependencies. devDependencies are never followed
// and the global lock dev flag never decides reachability.

const EDGE_DEPENDENCY = 'dependency';
const EDGE_OPTIONAL = 'optional';
const EDGE_PEER = 'peer';
const EDGE_PEER_OPTIONAL = 'peer-optional';
const EDGE_BUNDLED = 'bundled';
const EDGE_EXTRA = 'extra';

const MANDATORY_KINDS = new Set([EDGE_DEPENDENCY, EDGE_PEER, EDGE_BUNDLED, EDGE_EXTRA]);

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/^[a-zA-Z]:($|\/)/.test(value)) return false;
  return value.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// Plain npm package name segment: no traversal, URLs, or whitespace.
function isNameSegment(seg) {
  return (
    typeof seg === 'string' &&
    seg.length > 0 &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.startsWith('.') &&
    !/[\s\\]/.test(seg)
  );
}

// Only one unscoped segment or @scope/name; nothing else passes.
function isValidPackageName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 214) return false;
  if (/[\s\\\x00-\x1f\x7f]/.test(name)) return false;
  if (name.includes(':')) return false;
  if (name.startsWith('@')) {
    const parts = name.slice(1).split('/');
    return parts.length === 2 && parts.every(isNameSegment);
  }
  return !name.includes('/') && isNameSegment(name);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Nearest node_modules slot above `from` that provides `name`, walking from
// the package base towards the lockfile root. Levels that would yield a
// node_modules/node_modules candidate are skipped.
function nearestSlot(packages, from, name) {
  let dir = from;
  for (;;) {
    if (dir !== 'node_modules' && !dir.endsWith('/node_modules')) {
      const candidate = dir === '' ? `node_modules/${name}` : `${dir}/node_modules/${name}`;
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    if (dir === '') return null;
    const slash = dir.lastIndexOf('/');
    dir = slash === -1 ? '' : dir.slice(0, slash);
  }
}

// Follows workspace link slots (link:true with a relative resolved target)
// to the real packages key. Broken, cyclic, or out-of-scope targets fail.
function followWorkspaceLink(packages, slot) {
  const seen = new Set();
  let current = slot;
  for (;;) {
    const node = packages[current];
    if (!isObject(node)) return { ok: false };
    if (node.link !== true) return { ok: true, lockPath: current };
    if (seen.has(current)) return { ok: false };
    seen.add(current);
    const target = node.resolved;
    if (typeof target !== 'string') return { ok: false };
    if (target !== '' && !isSafeRelativePath(target)) return { ok: false };
    if (!Object.hasOwn(packages, target)) return { ok: false };
    current = target;
  }
}

// Real package name behind an npm: alias edge spec, or null when the edge
// carries no alias.
function aliasTargetName(spec) {
  if (typeof spec !== 'string' || !spec.startsWith('npm:')) return null;
  const body = spec.slice(4);
  if (body.length === 0) return null;
  const at = body.lastIndexOf('@');
  if (at <= 0) return body;
  return body.slice(0, at);
}

function slotName(lockPath) {
  const marker = 'node_modules/';
  const idx = lockPath.lastIndexOf(marker);
  if (idx === -1) return null;
  return lockPath.slice(idx + marker.length);
}

function displayName(node, lockPath, edgeName, edgeSpec) {
  if (node.name !== undefined) {
    if (!isValidPackageName(node.name)) {
      fail('LOCKFILE_INVALID', 'invalid lockfile: package entry has an unsafe name');
    }
    return node.name;
  }
  if (typeof edgeSpec === 'string' && edgeSpec.startsWith('npm:')) {
    const alias = aliasTargetName(edgeSpec);
    if (alias === null || !isValidPackageName(alias)) {
      fail('LOCKFILE_INVALID', 'invalid lockfile: npm alias target is unsafe or empty');
    }
    return alias;
  }
  return slotName(lockPath) ?? edgeName;
}

// Present dependency maps must be objects of package name to spec string.
// Anything else fails closed instead of dropping edges silently.
function readDepMap(node, field) {
  const value = node[field];
  if (value === undefined) return {};
  if (!isObject(value)) {
    fail('LOCKFILE_INVALID', `invalid lockfile: field ${field} is not an object`);
  }
  for (const [name, spec] of Object.entries(value)) {
    if (!isValidPackageName(name)) {
      fail('LOCKFILE_INVALID', `invalid lockfile: field ${field} has an unsafe package name`);
    }
    if (typeof spec !== 'string') {
      fail('LOCKFILE_INVALID', `invalid lockfile: field ${field} has a non-string spec`);
    }
  }
  return value;
}

function readPeerMeta(node) {
  const value = node.peerDependenciesMeta;
  if (value === undefined) return {};
  if (!isObject(value)) {
    fail('LOCKFILE_INVALID', 'invalid lockfile: field peerDependenciesMeta is not an object');
  }
  for (const entry of Object.values(value)) {
    if (isObject(entry) && entry.optional !== undefined && typeof entry.optional !== 'boolean') {
      fail('LOCKFILE_INVALID', 'invalid lockfile: field peerDependenciesMeta has a non-boolean optional flag');
    }
  }
  return value;
}

// Bundled declarations: an array of package names, true, or false.
// Missing means absent; any other form fails closed.
function readBundled(node) {
  let bundled;
  if (node.bundleDependencies !== undefined) {
    bundled = node.bundleDependencies;
  } else if (node.bundledDependencies !== undefined) {
    bundled = node.bundledDependencies;
  } else {
    return undefined;
  }
  if (bundled === true || bundled === false) return bundled;
  if (Array.isArray(bundled)) {
    for (const name of bundled) {
      if (!isValidPackageName(name)) {
        fail('LOCKFILE_INVALID', 'invalid lockfile: bundled list has an unsafe package name');
      }
    }
    return bundled;
  }
  fail('LOCKFILE_INVALID', 'invalid lockfile: bundled declaration is not a list or boolean');
  return undefined;
}

// Production edges of one packages node: dependencies, optionalDependencies
// (winning over same-named dependencies), peerDependencies (peer-optional
// when the meta flag says so), declared bundled lists, and extra names.
// extraSpecs maps explicitly listed extra names to their alias hint spec.
// Returns names sorted for deterministic traversal.
function collectEdges(node, extraSpecs) {
  const edges = new Map();
  const add = (name, kind, spec) => {
    let edge = edges.get(name);
    if (edge === undefined) {
      edge = { kinds: new Set(), spec };
      edges.set(name, edge);
    }
    edge.kinds.add(kind);
  };
  const deps = readDepMap(node, 'dependencies');
  const optional = readDepMap(node, 'optionalDependencies');
  const peer = readDepMap(node, 'peerDependencies');
  const peerMeta = readPeerMeta(node);
  for (const name of Object.keys(deps).sort()) {
    if (Object.hasOwn(optional, name)) continue;
    add(name, EDGE_DEPENDENCY, deps[name]);
  }
  for (const name of Object.keys(optional).sort()) {
    add(name, EDGE_OPTIONAL, optional[name]);
  }
  for (const name of Object.keys(peer).sort()) {
    const meta = peerMeta[name];
    const peerOptional = isObject(meta) && meta.optional === true;
    add(name, peerOptional ? EDGE_PEER_OPTIONAL : EDGE_PEER, peer[name]);
  }
  const bundled = readBundled(node);
  if (Array.isArray(bundled)) {
    for (const name of bundled) add(name, EDGE_BUNDLED, undefined);
  } else if (bundled === true) {
    // true covers the regular dependencies keys only, matching npm's
    // bundling normalization; optional overrides and peers keep their type.
    for (const name of [...edges.keys()].sort(compareStrings)) {
      if (edges.get(name).kinds.has(EDGE_DEPENDENCY)) add(name, EDGE_BUNDLED, undefined);
    }
  }
  // false or missing bundled forms add no edge.
  for (const name of Object.keys(extraSpecs).sort()) {
    add(name, EDGE_EXTRA, extraSpecs[name]);
  }
  return [...edges.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([name, edge]) => ({ name, kinds: edge.kinds, spec: edge.spec }));
}

function isMissingMandatory(kinds) {
  for (const kind of kinds) {
    if (MANDATORY_KINDS.has(kind)) return true;
  }
  return false;
}

// Resolves one npm production dependency graph per root entry.
// lock: parsed lockfile v3 JSON with a packages table.
// lockfile: relative label path used on every record.
// roots: [{ path, extraDependencies }] with path as a packages key.
export function collectProductionDependencies({ lockfile, lock, roots } = {}) {
  if (typeof lockfile !== 'string' || !isSafeRelativePath(lockfile)) {
    fail('LOCKFILE_INVALID', 'invalid lockfile: expected a safe relative lockfile label');
  }
  if (!isObject(lock) || lock.lockfileVersion !== 3 || !isObject(lock.packages)) {
    fail('LOCKFILE_INVALID', 'invalid lockfile: expected npm lockfile v3 with a packages table');
  }
  if (!Array.isArray(roots) || roots.length === 0) {
    fail('LOCKFILE_INVALID', 'invalid lockfile: expected at least one root entry');
  }
  const packages = lock.packages;
  for (const key of Object.keys(packages)) {
    if (key !== '' && !isSafeRelativePath(key)) {
      fail('LOCKFILE_INVALID', 'invalid lockfile: packages table has an unsafe key');
    }
  }
  const parsedRoots = roots.map((root, index) => {
    const path = isObject(root) ? root.path : undefined;
    if (path !== '' && !isSafeRelativePath(path)) {
      fail('LOCKFILE_INVALID', `invalid lockfile: root #${index} has an unsafe path`);
    }
    if (!Object.hasOwn(packages, path) || !isObject(packages[path])) {
      fail('LOCKFILE_INVALID', 'invalid lockfile: a root entry is missing from packages');
    }
    const extra = isObject(root) && root.extraDependencies !== undefined ? root.extraDependencies : [];
    if (!Array.isArray(extra) || extra.some((name) => !isValidPackageName(name))) {
      fail('LOCKFILE_INVALID', 'invalid lockfile: extraDependencies must list package names');
    }
    return { path, extraDependencies: [...extra] };
  });

  const records = [];
  const issues = [];
  for (const root of parsedRoots) {
    const entry = followWorkspaceLink(packages, root.path);
    if (!entry.ok) {
      issues.push({
        severity: 'error',
        code: 'WORKSPACE_LINK_INVALID',
        root: root.path,
        from: root.path,
        name: slotName(root.path) ?? root.path,
      });
      continue;
    }
    const entryBase = entry.lockPath;
    const entryNode = packages[entryBase];
    // Explicitly named extras reuse the root devDependencies spec as an
    // npm: alias naming hint; no other dev edge is ever followed.
    const devDeps = isObject(entryNode.devDependencies) ? entryNode.devDependencies : {};
    const extraSpecs = {};
    for (const name of root.extraDependencies) {
      const spec = devDeps[name];
      if (spec !== undefined && typeof spec !== 'string') {
        fail('LOCKFILE_INVALID', 'invalid lockfile: devDependencies spec is not a string');
      }
      extraSpecs[name] = spec;
    }
    const visited = new Set([entryBase]);
    const byLockPath = new Map();
    const queue = [{ base: entryBase, edges: collectEdges(entryNode, extraSpecs) }];
    while (queue.length > 0) {
      const { base, edges } = queue.shift();
      for (const edge of edges) {
        const slot = nearestSlot(packages, base, edge.name);
        if (slot === null || !isObject(packages[slot])) {
          const mandatory = isMissingMandatory(edge.kinds);
          issues.push({
            severity: mandatory ? 'error' : 'info',
            code: mandatory ? 'DEPENDENCY_UNRESOLVED' : 'OPTIONAL_DEPENDENCY_ABSENT',
            root: root.path,
            from: base,
            name: edge.name,
          });
          continue;
        }
        const followed = followWorkspaceLink(packages, slot);
        if (!followed.ok) {
          issues.push({
            severity: 'error',
            code: 'WORKSPACE_LINK_INVALID',
            root: root.path,
            from: base,
            name: edge.name,
          });
          continue;
        }
        const target = followed.lockPath;
        const existing = byLockPath.get(target);
        if (existing !== undefined) {
          for (const kind of edge.kinds) existing.edgeKinds.add(kind);
          continue;
        }
        // The entry itself is never recorded; back-cycles stop here.
        if (visited.has(target)) continue;
        visited.add(target);
        const node = packages[target];
        byLockPath.set(target, {
          root: root.path,
          lockfile,
          lockPath: target,
          name: displayName(node, target, edge.name, edge.spec),
          version: typeof node.version === 'string' ? node.version : null,
          integrity: typeof node.integrity === 'string' ? node.integrity : null,
          rawLicense: typeof node.license === 'string' ? node.license : null,
          workspace: !/(^|\/)node_modules(\/|$)/.test(target),
          edgeKinds: new Set(edge.kinds),
        });
        queue.push({ base: target, edges: collectEdges(node, {}) });
      }
    }
    for (const record of byLockPath.values()) {
      record.edgeKinds = [...record.edgeKinds].sort();
      records.push(record);
    }
  }
  records.sort((a, b) => compareStrings(a.root, b.root) || compareStrings(a.lockPath, b.lockPath));
  issues.sort(
    (a, b) =>
      compareStrings(a.root, b.root) ||
      compareStrings(a.from, b.from) ||
      compareStrings(a.name, b.name) ||
      compareStrings(a.code, b.code),
  );
  return { records, issues };
}
