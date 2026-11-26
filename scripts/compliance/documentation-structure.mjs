// Markdown structure readers for the deterministic offline documentation check.
//
// Holds the section/table/list/link parsers built on the prose and code
// models of the text module. No policy schema and no issue logic here.

import { codesOf, proseOf } from './documentation-text.mjs';

function normalizeHeading(text) {
  return text.trim().toLowerCase();
}

function parseHeading(line) {
  const match = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*$/);
  if (match === null) return null;
  // An optional closing sequence of hashes carries no meaning.
  const text = match[2].replace(/\s+#+$/, '').trim();
  if (text.length === 0) return null;
  return { level: match[1].length, text };
}

// The configured section: exactly one heading matches after trim and
// case-insensitive comparison, and the section runs until the next
// heading of the same or a higher level.
function extractSection(text, heading) {
  const lines = text.split('\n');
  const found = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseHeading(lines[index]);
    if (parsed !== null && normalizeHeading(parsed.text) === normalizeHeading(heading)) {
      found.push({ index, level: parsed.level });
    }
  }
  if (found.length !== 1) return null;
  const start = found[0].index + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const parsed = parseHeading(lines[index]);
    if (parsed !== null && parsed.level <= found[0].level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

// First two pipe cells of the content rows of a Markdown table.
// Separator rows carry no claim; the header row is skipped by name.
function tableRows(section) {
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.includes('|')) continue;
    let cells = line.trim();
    if (cells.startsWith('|')) cells = cells.slice(1);
    if (cells.endsWith('|')) cells = cells.slice(0, -1);
    const parts = cells.split('|').map((cell) => cell.trim());
    if (parts.length < 2) continue;
    if (parts.every((cell) => /^:?-+:?$/.test(cell))) continue;
    rows.push(parts);
  }
  return rows;
}

function isHeaderRow(scope, license) {
  return normalizeHeading(stripFormat(scope)) === 'scope' && normalizeHeading(stripFormat(license)) === 'license';
}

// Backticks and bold markers carry no license meaning and are removed
// before the exact SPDX comparison.
function stripFormat(text) {
  return text.replace(/[`*_]/g, '').trim();
}

function inlineCodes(text) {
  return codesOf(text);
}

// Markdown links without the image marker: { text, target } in order.
// Only prose links count; links shown inside inline code are examples.
function markdownLinks(text) {
  const prose = proseOf(text);
  const links = [];
  const pattern = /\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  let match = pattern.exec(prose);
  while (match !== null) {
    if (match.index > 0 && prose[match.index - 1] === '!') {
      match = pattern.exec(prose);
      continue;
    }
    links.push({ text: match[1], target: match[2] });
    match = pattern.exec(prose);
  }
  return links;
}

// Markdown images: { alt, url } in order. Only prose images count;
// a badge shown inside inline code is an example, not a badge.
function markdownImages(text) {
  const prose = proseOf(text);
  const images = [];
  const pattern = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;
  let match = pattern.exec(prose);
  while (match !== null) {
    images.push({ alt: match[1], url: match[2] });
    match = pattern.exec(prose);
  }
  return images;
}

// Complete contiguous Markdown list items, including wrapped lines:
// an item starts at a bullet or ordered marker and continues until a
// blank line or the next marker.
function splitListItems(section) {
  const items = [];
  let current = null;
  for (const line of section.split('\n')) {
    if (/^\s{0,8}([-*+]|\d+[.)])\s+\S/.test(line)) {
      if (current !== null) items.push(current.join('\n'));
      current = [line];
      continue;
    }
    if (current === null) continue;
    if (/^\s*$/.test(line)) {
      items.push(current.join('\n'));
      current = null;
      continue;
    }
    current.push(line);
  }
  if (current !== null) items.push(current.join('\n'));
  return items;
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Components named by an item: exact inline-code paths plus the root
// marker in prose, matched after whitespace normalization,
// case-insensitive.
function itemComponents(item, components, rootMarker) {
  const named = new Set();
  for (const code of inlineCodes(item)) {
    if (components.has(code)) named.add(code);
  }
  if (collapseWhitespace(proseOf(item)).includes(collapseWhitespace(rootMarker))) named.add('');
  return named;
}

// True when the prose carries the exact license link, not just an
// example of it inside inline code.
function hasExactLink(text, license, target) {
  return markdownLinks(text).some((link) => link.text === license && link.target === target);
}

// An unsupported Markdown shape is reported explicitly instead of
// silently passing; it carries no raw text.
function noteUnsupported(stripped, path, issues) {
  if (stripped.unsupported) {
    issues.push(issue(path, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED'));
    return true;
  }
  return false;
}

function issue(path, code) {
  return { severity: 'error', code, path };
}

export {
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
};
