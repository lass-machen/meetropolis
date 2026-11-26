// Deterministic SPDX license expression evaluator.
// Grammar: OR binds loosest, AND binds tighter, WITH attaches to one id.
// Operators are exact uppercase AND/OR/WITH. No alias normalization:
// every id is matched verbatim against the allowed list.

function tokenize(expression) {
  return expression
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function parse(expression) {
  if (typeof expression !== 'string') throw new Error('expression must be a string');
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('empty expression');
  let pos = 0;
  const peek = () => tokens[pos];
  const isOperator = (t) => t === 'AND' || t === 'OR' || t === 'WITH';
  // SPDX ids use ASCII letters, digits, dot, and minus; a single trailing
  // plus is the only other syntactically correct suffix (SPDX v2.3).
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/;
  const LICENSE_REF_PATTERN = /^(DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;
  const EXCEPTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

  const parsePrimary = () => {
    const token = tokens[pos++];
    if (token === '(') {
      const node = parseOr();
      if (tokens[pos++] !== ')') throw new Error('unbalanced parenthesis');
      return node;
    }
    if (token === undefined || isOperator(token) || token === ')') {
      throw new Error(`unexpected token ${token}`);
    }
    if (LICENSE_REF_PATTERN.test(token)) {
      return { type: 'ref', id: token };
    }
    if (!ID_PATTERN.test(token)) {
      throw new Error(`invalid token ${token}`);
    }
    if (peek() === 'WITH') {
      pos++;
      const exception = tokens[pos++];
      if (exception === undefined || isOperator(exception) || !EXCEPTION_PATTERN.test(exception)) {
        throw new Error('WITH without valid exception id');
      }
      return { type: 'with', id: token, exception };
    }
    return { type: 'id', id: token };
  };

  const parseAnd = () => {
    const items = [parsePrimary()];
    while (peek() === 'AND') {
      pos++;
      items.push(parsePrimary());
    }
    return items.length === 1 ? items[0] : { type: 'and', items };
  };

  const parseOr = () => {
    const items = [parseAnd()];
    while (peek() === 'OR') {
      pos++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { type: 'or', items };
  };

  const tree = parseOr();
  if (pos !== tokens.length) throw new Error('trailing tokens');
  return tree;
}

function sortedUnique(ids) {
  return [...new Set(ids)].sort();
}

function evaluateNode(node, allowed) {
  // LicenseRef/DocumentRef entries are captured separately but matched
  // verbatim like ids, so they stay red without a policy allowance.
  if (node.type === 'id' || node.type === 'ref') {
    if (allowed.has(node.id)) return { ok: true, selected: [node.id], code: null };
    return { ok: false, selected: [], code: 'LICENSE_NOT_ALLOWED' };
  }
  if (node.type === 'with') {
    // Parsed correctly, but no exception is approved, so always red.
    return { ok: false, selected: [], code: 'LICENSE_NOT_ALLOWED' };
  }
  if (node.type === 'and') {
    const results = node.items.map((item) => evaluateNode(item, allowed));
    if (results.every((r) => r.ok)) {
      return { ok: true, selected: sortedUnique(results.flatMap((r) => r.selected)), code: null };
    }
    return { ok: false, selected: [], code: 'LICENSE_NOT_ALLOWED' };
  }
  // node.type === 'or': first fully allowed branch wins, in source order.
  for (const item of node.items) {
    const result = evaluateNode(item, allowed);
    if (result.ok) return { ok: true, selected: sortedUnique(result.selected), code: null };
  }
  return { ok: false, selected: [], code: 'LICENSE_NOT_ALLOWED' };
}

// Evaluates an SPDX license expression against an allow-list of exact ids.
// Returns { ok, selected, code }: selected is sorted and deduplicated,
// code is null on success, LICENSE_EXPRESSION_INVALID for unparseable
// input, or LICENSE_NOT_ALLOWED when an id is unknown, not allowed,
// or carries a WITH exception.
export function evaluateLicenseExpression(expression, allowedLicenses) {
  let tree;
  try {
    tree = parse(expression);
  } catch {
    return { ok: false, selected: [], code: 'LICENSE_EXPRESSION_INVALID' };
  }
  return evaluateNode(tree, new Set(allowedLicenses));
}
