// Dockerfile parser for the deterministic local metadata check.
//
// Holds the fail-closed dockerfile scan used by checkMetadata. The
// syntax error class is shared with the main module so the catch keeps
// matching the same class identity; nothing else is exported.

// A dockerfile parse failure is either unsupported syntax (heredoc,
// foreign escape directive) or an invalid file.
class DockerfileSyntaxError extends Error {}
class DockerfileInvalidError extends Error {}

// Shell-like words of label arguments with escape support inside and
// outside quotes. Returns null on defective quotes.
function tokenizeLabelArgs(text) {
  const words = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && (text[index] === ' ' || text[index] === '\t')) index += 1;
    if (index >= text.length) break;
    let word = '';
    let closed = true;
    while (index < text.length && text[index] !== ' ' && text[index] !== '\t') {
      const char = text[index];
      if (char === '"' || char === "'") {
        closed = false;
        index += 1;
        while (index < text.length && text[index] !== char) {
          if (text[index] === '\\' && index + 1 < text.length) {
            word += text[index + 1];
            index += 2;
          } else {
            word += text[index];
            index += 1;
          }
        }
        if (index >= text.length) return null;
        closed = true;
        index += 1;
      } else if (char === '\\' && index + 1 < text.length) {
        word += text[index + 1];
        index += 2;
      } else {
        word += char;
        index += 1;
      }
    }
    if (!closed) return null;
    words.push(word);
  }
  return words;
}

// Assignments of one LABEL instruction: pairs of key=value words or the
// legacy single key value form. Returns null on defective pair syntax.
function parseLabelAssignments(args) {
  const words = tokenizeLabelArgs(args);
  if (words === null || words.length === 0) return null;
  if (!words.some((word) => word.includes('='))) {
    if (words.length !== 2) return null;
    return [{ key: words[0], value: words[1] }];
  }
  const pairs = [];
  for (const word of words) {
    const cut = word.indexOf('=');
    if (cut <= 0) return null;
    pairs.push({ key: word.slice(0, cut), value: word.slice(cut + 1) });
  }
  return pairs;
}

// Minimal fail-closed dockerfile scan: stages, label assignments per
// stage and heredoc or escape markers that need a real builder.
function parseDockerfile(text) {
  const lines = text.split(/\r\n|[\n\r]/);
  const logical = [];
  let pending = '';
  let seenContent = false;
  for (const line of lines) {
    // Comment lines are removed before joining continuations: a comment
    // neither ends nor extends a pending instruction.
    if (/^\s*#/.test(line)) {
      if (!seenContent) {
        const escape = line.match(/^\s*#\s*escape\s*=\s*(\S+)\s*$/i);
        if (escape !== null) {
          const marker = escape[1].replace(/^['"]|['"]$/g, '');
          if (marker !== '\\') throw new DockerfileSyntaxError('escape');
        }
      }
      continue;
    }
    if (pending !== '') {
      // An empty continuation line is deprecated docker syntax and is
      // not evaluated: fail closed instead of guessing the instruction.
      if (/^\s*$/.test(line)) throw new DockerfileSyntaxError('empty-continuation');
      pending += line;
      if (/\\[ \t]*$/.test(line)) {
        pending = pending.replace(/\\[ \t]*$/, '');
        continue;
      }
      logical.push(pending);
      pending = '';
      continue;
    }
    if (/\\[ \t]*$/.test(line)) {
      pending = line.replace(/\\[ \t]*$/, '');
      seenContent = true;
      continue;
    }
    if (/^\s*$/.test(line)) continue;
    seenContent = true;
    logical.push(line);
  }
  if (pending !== '') logical.push(pending);
  const stages = [];
  for (const entry of logical) {
    const instruction = entry.match(/^\s*([a-zA-Z]+)(?:\s+(.*))?$/);
    if (instruction === null) throw new DockerfileInvalidError('instruction');
    if (/<<-?\s*['"]?[A-Za-z0-9_]/.test(entry)) throw new DockerfileSyntaxError('heredoc');
    const name = instruction[1].toUpperCase();
    const args = (instruction[2] ?? '').trim();
    if (name === 'FROM') {
      if (args.length === 0) throw new DockerfileInvalidError('from');
      stages.push([]);
    } else if (name === 'LABEL') {
      if (stages.length === 0) throw new DockerfileInvalidError('label');
      const pairs = parseLabelAssignments(args);
      if (pairs === null) throw new DockerfileInvalidError('label');
      stages[stages.length - 1].push(...pairs);
    }
  }
  if (stages.length === 0) throw new DockerfileInvalidError('from');
  return stages;
}

export { DockerfileSyntaxError, parseDockerfile };
