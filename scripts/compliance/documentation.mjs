// Deterministic offline documentation check.
//
// Compares the structured license statements of the configured documents
// against the pinned documentation rules of the policy:
//   - the LICENSING.md component table lists every manifest component
//     exactly once with the exact license of its area,
//   - the root README license section assigns every grouped component to
//     exactly one list item with the exact license link of its group,
//   - the root README carries exactly one shields.io badge per group
//     license outside code and comments,
//   - the asset-lab README links its license in the same plain paragraph
//     as the word Atelier.
//
// Only this documented Markdown subset is evaluated: whole HTML comments
// and fenced code blocks are dropped before any claim is read, headings
// delimit sections, and inline code, list items, links and images carry
// the structured claims. General legal prose is never interpreted.
//
// Masked content is never silently discarded: every code-span line, fenced
// block and HTML comment is scanned for license ids and keywords. A hit
// without an exactly scoped exception blocks the document as
// DOCUMENTATION_MARKDOWN_UNSUPPORTED; an unused exception is reported as
// DOCUMENTATION_MASKED_ALLOWLIST_STALE. Open blocks and unclosed spans
// stay separately unsupported even when a text exception exists.
//
// The check is pure: it reads only from the given snapshot map, never
// opens a file, never uses the network or node_modules, and neither
// writes nor prints anything.

import { basenameOf, compareStrings, isSpdxId, readPolicy, readSnapshot } from './documentation-policy.mjs';
import {
  extractSection,
  hasExactLink,
  inlineCodes,
  isHeaderRow,
  issue,
  itemComponents,
  markdownImages,
  markdownLinks,
  noteUnsupported,
  splitListItems,
  stripFormat,
  tableRows,
} from './documentation-structure.mjs';
import { buildMaskedPatterns, checkMaskedLicenses, proseOf, strippedDoc } from './documentation-text.mjs';

const LICENSE_BASENAME = /^(?:LICENSE|LICENCE)(?:\..+)?$/i;

// The component table of the configured section: the first inline-code
// path of the scope cell names the component, the root alias names the
// root. Every manifest component appears exactly once with the exact
// SPDX value of its area. Spacing, row order and a third notes column
// may vary without a finding.
function checkComponentTable(doc, policy, issues) {
  const bytes = doc.snapshot.get(policy.componentTable.path);
  if (bytes === undefined) {
    issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_FILE_MISSING'));
    return false;
  }
  const stripped = strippedDoc(bytes);
  noteUnsupported(stripped, policy.componentTable.path, issues);
  const section = extractSection(stripped.text, policy.componentTable.heading);
  if (section === null) {
    issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_SECTION_INVALID'));
    return false;
  }
  const seen = new Set();
  for (const [scope, license] of tableRows(section)) {
    if (isHeaderRow(scope, license)) continue;
    const codes = inlineCodes(scope);
    let component = null;
    if (codes.length > 0) {
      if (codes[0] === policy.componentTable.rootAlias) {
        component = '';
      } else if (policy.components.has(codes[0])) {
        component = codes[0];
      } else {
        issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_TABLE_COMPONENT_UNCONFIGURED'));
        continue;
      }
    } else if (proseOf(scope).includes(policy.componentTable.rootAlias)) {
      component = '';
    } else {
      continue;
    }
    if (seen.has(component)) {
      issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_TABLE_COMPONENT_DUPLICATE'));
      continue;
    }
    seen.add(component);
    if (stripFormat(license) !== policy.expectedFor(component)) {
      issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_LICENSE_MISMATCH'));
    }
  }
  for (const component of policy.components) {
    if (!seen.has(component)) {
      issues.push(issue(policy.componentTable.path, 'DOCUMENTATION_TABLE_COMPONENT_MISSING'));
    }
  }
  return true;
}

// A license link counts as a claim for its item only when its text is
// an SPDX-like id; a neutral LICENSE/LICENCE link text is no claim.
function isNeutralLinkText(text) {
  const normalized = stripFormat(text).toLowerCase();
  return normalized === 'license' || normalized === 'licence';
}

// The readme license section: every group owns one list item holding
// all of its components, every component belongs to exactly one item,
// and the item carries the exact license link of its group. License
// links to license files must not claim another license or target.
function checkReadmeList(doc, policy, issues) {
  const bytes = doc.snapshot.get(policy.readme.path);
  if (bytes === undefined) {
    issues.push(issue(policy.readme.path, 'DOCUMENTATION_FILE_MISSING'));
    return false;
  }
  const stripped = strippedDoc(bytes);
  noteUnsupported(stripped, policy.readme.path, issues);
  const section = extractSection(stripped.text, policy.readme.heading);
  if (section === null) {
    issues.push(issue(policy.readme.path, 'DOCUMENTATION_SECTION_INVALID'));
    return false;
  }
  const items = splitListItems(section);
  const itemMembers = items.map((item) => itemComponents(item, policy.components, policy.readme.rootMarker));
  const mentionsOf = (component) => {
    const owners = [];
    for (let index = 0; index < itemMembers.length; index += 1) {
      if (itemMembers[index].has(component)) owners.push(index);
    }
    return owners;
  };
  const groupOf = (component) => {
    for (const group of policy.readme.groups) {
      if (group.components.includes(component)) return group;
    }
    return null;
  };
  for (const component of policy.components) {
    if (component === policy.assetLab.scope) continue;
    const owners = mentionsOf(component);
    if (owners.length === 0) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_README_CLAIM_MISSING'));
    } else if (owners.length > 1) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_README_CLAIM_DUPLICATE'));
    }
  }
  for (const group of policy.readme.groups) {
    const full = [];
    for (let index = 0; index < itemMembers.length; index += 1) {
      if (group.components.every((component) => itemMembers[index].has(component))) full.push(index);
    }
    if (full.length === 0) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_README_CLAIM_MISSING'));
      continue;
    }
    for (const index of full) {
      if (!hasExactLink(items[index], group.license, group.licenseTarget)) {
        issues.push(issue(policy.readme.path, 'DOCUMENTATION_README_CLAIM_MISSING'));
      }
    }
  }
  for (let index = 0; index < items.length; index += 1) {
    const members = [...itemMembers[index]].filter((component) => component !== policy.assetLab.scope);
    if (members.length === 0) continue;
    const groups = new Set(members.map((component) => groupOf(component)));
    if (groups.size > 1 || groups.has(null)) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_LICENSE_MISMATCH'));
      continue;
    }
    const [group] = groups;
    for (const link of markdownLinks(items[index])) {
      if (!LICENSE_BASENAME.test(basenameOf(link.target))) continue;
      if (isNeutralLinkText(link.text)) continue;
      if (stripFormat(link.text) !== group.license || link.target !== group.licenseTarget) {
        issues.push(issue(policy.readme.path, 'DOCUMENTATION_LICENSE_MISMATCH'));
      }
    }
  }
  return true;
}

// A badge URL mirrors its shields.io claim with a free color:
// https://img.shields.io/badge/License-<id with -- for ->-<color>.svg
// and carries no credentials.
function badgeUrlMatches(url, id) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username.length > 0 || parsed.password.length > 0) return false;
  if (parsed.hostname !== 'img.shields.io') return false;
  const encoded = id.replace(/-/g, '--');
  const prefix = `/badge/License-${encoded}-`;
  if (!parsed.pathname.startsWith(prefix)) return false;
  let color = parsed.pathname.slice(prefix.length);
  if (!color.endsWith('.svg')) return false;
  color = color.slice(0, -'.svg'.length);
  return color.length > 0 && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(color);
}

// Exactly one license badge per configured badge id outside code and
// comments; other badges are ignored.
function checkReadmeBadges(doc, policy, issues) {
  const bytes = doc.snapshot.get(policy.readme.path);
  if (bytes === undefined) {
    issues.push(issue(policy.readme.path, 'DOCUMENTATION_FILE_MISSING'));
    return false;
  }
  const stripped = strippedDoc(bytes);
  noteUnsupported(stripped, policy.readme.path, issues);
  const found = new Map();
  let valid = true;
  for (const image of markdownImages(stripped.text)) {
    const badge = image.alt.match(/^License:\s*([\s\S]*?)\s*$/);
    if (badge === null) continue;
    const id = badge[1];
    if (!policy.readme.badges.includes(id) || !badgeUrlMatches(image.url, id)) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_LICENSE_BADGE_MISMATCH'));
      valid = false;
      continue;
    }
    found.set(id, (found.get(id) ?? 0) + 1);
  }
  for (const id of policy.readme.badges) {
    if ((found.get(id) ?? 0) === 0) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_LICENSE_BADGE_MISSING'));
      valid = false;
    } else if (found.get(id) > 1) {
      issues.push(issue(policy.readme.path, 'DOCUMENTATION_LICENSE_BADGE_MISMATCH'));
      valid = false;
    }
  }
  return valid;
}

// The asset-lab readme: at least one real license link in the same
// plain paragraph as the word Atelier, and no deviating SPDX claim at
// the same license target. No other paragraph is interpreted.
function checkAssetLab(doc, policy, issues) {
  const bytes = doc.snapshot.get(policy.assetLab.path);
  if (bytes === undefined) {
    issues.push(issue(policy.assetLab.path, 'DOCUMENTATION_FILE_MISSING'));
    return false;
  }
  const stripped = strippedDoc(bytes);
  noteUnsupported(stripped, policy.assetLab.path, issues);
  const text = stripped.text;
  let linked = false;
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;
    if (/^\s{0,3}#+(\s|$)/.test(trimmed)) continue;
    if (!/\bAtelier\b/.test(proseOf(paragraph))) continue;
    if (hasExactLink(paragraph, policy.assetLab.license, policy.assetLab.licenseTarget)) linked = true;
  }
  let mismatch = false;
  for (const link of markdownLinks(text)) {
    if (isNeutralLinkText(link.text)) continue;
    const claim = stripFormat(link.text);
    if (link.target === policy.assetLab.licenseTarget && isSpdxId(claim) && claim !== policy.assetLab.license) {
      mismatch = true;
    }
    if (
      claim === policy.assetLab.license &&
      link.target !== policy.assetLab.licenseTarget &&
      LICENSE_BASENAME.test(basenameOf(link.target))
    ) {
      mismatch = true;
    }
  }
  if (mismatch) {
    issues.push(issue(policy.assetLab.path, 'DOCUMENTATION_LICENSE_MISMATCH'));
  } else if (!linked) {
    issues.push(issue(policy.assetLab.path, 'DOCUMENTATION_README_CLAIM_MISSING'));
  }
  return !mismatch && linked;
}

// Checks the configured license documents of a repository snapshot.
// files: Map of repository relative path to file bytes, including the
// policy. Returns { records, issues } and has no other side effects.
export function checkDocumentation({ files } = {}) {
  const snapshot = readSnapshot(files);
  const policy = readPolicy(snapshot);
  const doc = { snapshot };
  const issues = [];
  const records = [];
  const table = policy.documentation.componentTable;
  const readme = policy.documentation.readme;
  const assetLab = policy.documentation.assetLab;
  const masked = policy.documentation.maskedContent;
  const patterns = buildMaskedPatterns(masked.licenseIds, masked.keywords);
  const usedAllowlist = new Set();
  const maskedArgs = { masked, patterns, usedAllowlist, issues, records };

  if (snapshot.has(table.path)) {
    checkComponentTable(doc, policy.documentation, issues);
    checkMaskedLicenses({ raw: snapshot.get(table.path).toString('utf8'), docPath: table.path, ...maskedArgs });
    records.push({
      kind: 'component-table',
      path: table.path,
      components: [...policy.documentation.components].sort(compareStrings),
    });
  } else {
    issues.push(issue(table.path, 'DOCUMENTATION_FILE_MISSING'));
  }

  if (snapshot.has(readme.path)) {
    checkReadmeList(doc, policy.documentation, issues);
    checkReadmeBadges(doc, policy.documentation, issues);
    checkMaskedLicenses({ raw: snapshot.get(readme.path).toString('utf8'), docPath: readme.path, ...maskedArgs });
    records.push({
      kind: 'readme',
      path: readme.path,
      components: [...readme.covered].sort(compareStrings),
    });
  } else {
    issues.push(issue(readme.path, 'DOCUMENTATION_FILE_MISSING'));
  }

  if (snapshot.has(assetLab.path)) {
    checkAssetLab(doc, policy.documentation, issues);
    checkMaskedLicenses({ raw: snapshot.get(assetLab.path).toString('utf8'), docPath: assetLab.path, ...maskedArgs });
    records.push({
      kind: 'asset-readme',
      path: assetLab.path,
      components: [assetLab.scope],
      expectedLicense: assetLab.license,
    });
  } else {
    issues.push(issue(assetLab.path, 'DOCUMENTATION_FILE_MISSING'));
  }

  // Every unused exception is reported once; identical issues are reported
  // once per file, code and diagnostic line so findings on different lines
  // are never lost to file-only deduplication.
  for (const entry of masked.allowlist) {
    const key = `${entry.path}|${entry.kind}|${entry.contextSha256}|${entry.occurrence}`;
    if (!usedAllowlist.has(key)) {
      issues.push({ severity: 'error', code: 'DOCUMENTATION_MASKED_ALLOWLIST_STALE', path: entry.path });
    }
  }
  const unique = new Map();
  for (let index = 0; index < issues.length; index += 1) {
    const entry = issues[index];
    // Stale entries keep one issue per unused exception even when they
    // share path and code; the loop index only separates them internally
    // and never leaks into the output.
    const linePart = entry.code === 'DOCUMENTATION_MASKED_ALLOWLIST_STALE' ? `stale-${index}` : `${entry.line ?? ''}`;
    unique.set(`${entry.severity}|${entry.code}|${entry.path}|${linePart}`, entry);
  }
  const sortedIssues = [...unique.values()].sort(
    (a, b) =>
      compareStrings(a.path, b.path) ||
      compareStrings(a.code, b.code) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compareStrings(a.severity, b.severity),
  );
  const sortedRecords = records.sort(
    (a, b) =>
      compareStrings(a.path, b.path) ||
      compareStrings(a.kind, b.kind) ||
      compareStrings(a.maskedKind ?? '', b.maskedKind ?? '') ||
      (a.occurrence ?? 0) - (b.occurrence ?? 0) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compareStrings(a.contextSha256 ?? '', b.contextSha256 ?? ''),
  );
  return { records: sortedRecords, issues: sortedIssues };
}
