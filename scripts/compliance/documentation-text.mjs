// Masked-text readers for the deterministic offline documentation check.
//
// Holds the HTML-comment/fence stripper, the inline-code model and the
// masked-license scanner used by checkDocumentation. Hashing stays here
// with the masked contexts; policy schema lives in the policy module.

import { createHash } from 'node:crypto';

import { compareStrings } from './documentation-policy.mjs';

// Whole HTML comments and fenced code blocks are dropped in one bounded
// line pass before any claim is evaluated, so commented or fenced
// examples can never replace a real statement. Comments are only
// recognized outside fences, fences only outside comments, and an
// unclosed comment hides everything until the end of the file. Comment
// content is raw: only the opening marker respects code spans, while
// the end never does. An unclosed comment, backticks inside comment
// content, an unclosed fence and an incomplete code span are reported
// as unsupported instead of silently passing.
function stripIgnored(raw) {
  const lines = raw.split('\n');
  const kept = [];
  let fenceChar = null;
  let fenceLength = 0;
  let inComment = false;
  let commentTick = false;
  const contentTick = (content) => {
    if (content.includes('`')) commentTick = true;
  };
  for (let line of lines) {
    if (inComment) {
      // Comment content is raw: backticks inside never hide the end.
      const end = line.indexOf('-->');
      if (end === -1) {
        contentTick(line);
        continue;
      }
      contentTick(line.slice(0, end));
      inComment = false;
      line = line.slice(end + 3);
    }
    if (fenceChar !== null) {
      const close = line.match(/^\s{0,3}(`+|~+)\s*$/);
      if (close !== null && close[1][0] === fenceChar && close[1].length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (open !== null) {
      fenceChar = open[1][0];
      fenceLength = open[1].length;
      continue;
    }
    let rest = line;
    let out = '';
    for (;;) {
      const start = findProseMarker(rest, '<!--');
      if (start === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, start);
      // Comment content is raw here as well: only the opening marker
      // respects code spans, the end never does.
      const end = rest.indexOf('-->', start + 4);
      if (end === -1) {
        contentTick(rest.slice(start));
        inComment = true;
        break;
      }
      contentTick(rest.slice(start, end));
      rest = rest.slice(end + 3);
    }
    kept.push(out);
  }
  return { lines: kept, fenceOpen: fenceChar !== null, commentOpen: inComment, commentTick };
}

function strippedDoc(bytes) {
  const stripped = stripIgnored(bytes.toString('utf8'));
  const text = stripped.lines.join('\n');
  return {
    text,
    unsupported: stripped.fenceOpen || stripped.commentOpen || stripped.commentTick || hasUnclosedSpan(text),
  };
}

// Inline code spans of the documented subset, one line at a time:
// outside code an odd number of directly preceding backslashes escapes
// the run into literal text, while inside a span backslashes are
// literal characters, so a matching run still closes after one. An
// unclosed run stays literal text.
function spansInLine(line) {
  const spans = [];
  const unclosed = [];
  let index = 0;
  const backslashesBefore = (pos) => {
    let count = 0;
    while (pos - 1 - count >= 0 && line[pos - 1 - count] === '\\') count += 1;
    return count;
  };
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    let length = 0;
    while (line[index + length] === '`') length += 1;
    if (backslashesBefore(index) % 2 === 1) {
      index += 1;
      continue;
    }
    let cursor = index + length;
    let closedAt = -1;
    while (cursor < line.length) {
      if (line[cursor] !== '`') {
        cursor += 1;
        continue;
      }
      let run = 0;
      while (line[cursor + run] === '`') run += 1;
      if (run === length) {
        closedAt = cursor;
        break;
      }
      cursor += run;
    }
    if (closedAt === -1) {
      unclosed.push(length);
      index += length;
      continue;
    }
    spans.push({ open: index, close: closedAt, length });
    index = closedAt + length;
  }
  return { spans, unclosed };
}

// True when any line carries an incomplete code span: a run without a
// matching closer on its own line. Cleanly escaped ticks never appear
// here, so they stay the one unambiguous literal case. A closer only
// on a later line and a closer nowhere at all both block the document.
function hasUnclosedSpan(text) {
  for (const line of text.split('\n')) {
    if (spansInLine(line).unclosed.length > 0) return true;
  }
  return false;
}

// Prose pieces of one line with their code spans cut out.
function prosePiecesOfLine(line) {
  const { spans } = spansInLine(line);
  const pieces = [];
  let cursor = 0;
  for (const span of spans) {
    pieces.push(line.slice(cursor, span.open));
    cursor = span.close + span.length;
  }
  pieces.push(line.slice(cursor));
  return pieces.filter((piece) => piece !== '');
}

// Code spans keep a whitespace boundary in the prose, so fragments
// around code can never join into a seemingly real link, image or id.
// Links and images are therefore never built across prose pieces.
function proseOf(text) {
  return text
    .split('\n')
    .map((line) => prosePiecesOfLine(line).join(' '))
    .join('\n');
}

function codesOf(text) {
  const codes = [];
  for (const line of text.split('\n')) {
    const { spans } = spansInLine(line);
    for (const span of spans) {
      codes.push(line.slice(span.open + span.length, span.close).trim());
    }
  }
  return codes;
}

// A marker occurrence outside inline code, or -1. Comment markers
// inside code spans are examples, never structure.
function findProseMarker(line, marker) {
  const { spans } = spansInLine(line);
  let found = line.indexOf(marker);
  while (found !== -1) {
    const inside = spans.some((span) => found < span.close + span.length && found + marker.length > span.open);
    if (!inside) return found;
    found = line.indexOf(marker, found + 1);
  }
  return -1;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Raw masked contexts of one document, preserved instead of discarded:
// every physical line with a closed code span becomes one code-span
// context holding the complete original line, every complete fenced block
// and every complete HTML comment becomes one context holding all of its
// original lines including delimiters. Open blocks and unclosed spans
// yield no context and stay separately unsupported. The walk mirrors
// stripIgnored exactly; identical contexts on the same line are stored
// once, identical lines at different positions stay separate occurrences.
function collectMaskedContexts(raw) {
  const lines = raw.split('\n');
  const contexts = [];
  const seen = new Set();
  const push = (kind, start, end) => {
    const context = lines.slice(start, end + 1).join('\n');
    const contextSha256 = createHash('sha256').update(context, 'utf8').digest('hex');
    const key = `${kind}|${start}|${contextSha256}`;
    if (seen.has(key)) return;
    seen.add(key);
    contexts.push({ kind, context, contextSha256, line: start + 1 });
  };
  let fenceChar = null;
  let fenceLength = 0;
  let fenceStart = -1;
  let inComment = false;
  let commentStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index];
    let line = original;
    if (inComment) {
      const end = line.indexOf('-->');
      if (end === -1) continue;
      inComment = false;
      push('comment', commentStart, index);
      line = line.slice(end + 3);
    }
    if (fenceChar !== null) {
      const close = line.match(/^\s{0,3}(`+|~+)\s*$/);
      if (close !== null && close[1][0] === fenceChar && close[1].length >= fenceLength) {
        push('fence', fenceStart, index);
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }
    const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (open !== null) {
      fenceChar = open[1][0];
      fenceLength = open[1].length;
      fenceStart = index;
      continue;
    }
    let rest = line;
    let out = '';
    for (;;) {
      const start = findProseMarker(rest, '<!--');
      if (start === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, start);
      const end = rest.indexOf('-->', start + 4);
      if (end === -1) {
        commentStart = index;
        inComment = true;
        break;
      }
      push('comment', index, index);
      rest = rest.slice(end + 3);
    }
    if (spansInLine(out).spans.length > 0) {
      push('code-span', index, index);
    }
  }
  return contexts;
}

// The masked raw payload of a context: span inners for code, the fenced
// lines without delimiters, the comment text without markers. The full
// source context always contains this payload; both are scanned.
function maskedInners(kind, context) {
  if (kind === 'code-span') return codesOf(context);
  if (kind === 'fence') {
    return [context.split('\n').slice(1, -1).join('\n')];
  }
  const start = context.indexOf('<!--');
  const end = context.lastIndexOf('-->');
  if (start === -1 || end === -1 || end < start) return [''];
  return [context.slice(start + 4, end)];
}

// Conservative literal patterns: license ids match case-sensitively,
// keywords case-insensitively with flexible whitespace, both with
// Unicode word boundaries so 'example' never matches MPL and a German
// lowercase 'mit' never matches the canonical MIT id.
function buildMaskedPatterns(licenseIds, keywords) {
  const boundaryStart = '(?<![\\p{L}\\p{N}_])';
  const boundaryEnd = '(?![\\p{L}\\p{N}_])';
  const longestFirst = (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
  const idSource = [...licenseIds].sort(longestFirst).map(escapeRegExp).join('|');
  const keywordSource = [...keywords]
    .sort(longestFirst)
    .map((keyword) => escapeRegExp(keyword).replace(/\s+/g, '\\s+'))
    .join('|');
  return {
    // No global flag: test() stays stateless across all contexts.
    licensePattern: new RegExp(`(?:${boundaryStart}(?:${idSource})${boundaryEnd})`, 'u'),
    keywordPattern: new RegExp(`(?:${boundaryStart}(?:${keywordSource})${boundaryEnd})`, 'iu'),
  };
}

// Scans the masked contexts of one present document. A hit without an
// exactly scoped exception blocks the document; the exception key carries
// no line, so inserting lines above stays valid while a second identical
// context needs its own exception. Hits are recorded with their
// allowlisted flag and never carry raw content.
function checkMaskedLicenses({ raw, docPath, masked, patterns, usedAllowlist, issues, records }) {
  const contexts = collectMaskedContexts(raw);
  const ordered = [...contexts].sort((a, b) => a.line - b.line || compareStrings(a.kind, b.kind));
  const counters = new Map();
  for (const context of ordered) {
    const groupKey = `${context.kind}|${context.contextSha256}`;
    const occurrence = (counters.get(groupKey) ?? 0) + 1;
    counters.set(groupKey, occurrence);
    const inners = maskedInners(context.kind, context.context);
    const hit =
      patterns.licensePattern.test(context.context) ||
      patterns.keywordPattern.test(context.context) ||
      inners.some((inner) => patterns.licensePattern.test(inner) || patterns.keywordPattern.test(inner));
    if (!hit) continue;
    const allowlisted = masked.allowlist.some(
      (entry) =>
        entry.path === docPath &&
        entry.kind === context.kind &&
        entry.contextSha256 === context.contextSha256 &&
        entry.occurrence === occurrence,
    );
    if (allowlisted) {
      usedAllowlist.add(`${docPath}|${context.kind}|${context.contextSha256}|${occurrence}`);
    } else {
      issues.push({
        severity: 'error',
        code: 'DOCUMENTATION_MARKDOWN_UNSUPPORTED',
        path: docPath,
        line: context.line,
      });
    }
    records.push({
      kind: 'masked-license-hit',
      path: docPath,
      maskedKind: context.kind,
      contextSha256: context.contextSha256,
      occurrence,
      line: context.line,
      allowlisted,
    });
  }
}

export { buildMaskedPatterns, checkMaskedLicenses, codesOf, proseOf, strippedDoc };
