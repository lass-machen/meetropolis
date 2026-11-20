// Syntactic collection of the module imports of one source file.
//
// The module receives the content of one file and returns the import like
// constructs of that file. The real Babel parser does the parsing through
// the existing runtime loader. The module itself reads no file, uses no
// network and writes nothing.
//
// The result is a syntax view and not a module graph:
//   - A specifier is the decoded text of the module string. It is never
//     resolved, evaluated or checked against a file system.
//   - No scope analysis happens. A local function named require is recorded
//     like a module import, because the call shape is what is visible.
//   - Only the module reference is recorded, never the imported names.

import { loadSourceParser } from './parser-runtime.mjs';

const DATA_INVALID_CODE = 'COMPLIANCE_DATA_INVALID';
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';
const PARSER_FAILED_CODE = 'COMPLIANCE_PARSER_FAILED';
const PARSER_FAILED_MESSAGE = 'parser error: the source parser failed unexpectedly';
const PARSER_FAILED_EXIT_CODE = 2;
const PARSE_FAILED_CODE = 'SOURCE_PARSE_FAILED';
const SUPPORTED_EXTENSIONS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts']);
const TYPESCRIPT_EXTENSIONS = new Set(['ts', 'tsx', 'mts', 'cts']);
const JSX_EXTENSIONS = new Set(['jsx', 'tsx']);
const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];
// Node properties that hold positions, raw text or comments instead of
// child nodes.
const NON_NODE_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'errors',
]);

function failData() {
  const error = new Error(DATA_INVALID_MESSAGE);
  error.code = DATA_INVALID_CODE;
  throw error;
}

function failParser() {
  const error = new Error(PARSER_FAILED_MESSAGE);
  error.code = PARSER_FAILED_CODE;
  error.exitCode = PARSER_FAILED_EXIT_CODE;
  throw error;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

// Canonical repository relative path: no backslash, no leading slash, no
// empty, dot or dot dot segment and no control character.
function isCanonicalRepoPath(value) {
  if (value.length === 0) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  if (/^[a-zA-Z]:($|\/)/.test(value)) return false;
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
  }
  return true;
}

// Extension of a repository relative path without the dot.
function extensionOf(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1);
}

function isDeclarationPath(path) {
  return DECLARATION_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

// Parser options of one file. The TypeScript plugin is limited to the
// TypeScript extensions, JSX is limited to the two extensions that carry
// it, and the legacy decorators match the repository TypeScript setting.
// A declaration file may export an ambient name, so only there the export
// binding check is switched off.
function buildParserOptions(path) {
  const extension = extensionOf(path);
  const plugins = [];
  if (TYPESCRIPT_EXTENSIONS.has(extension)) {
    plugins.push('typescript');
    plugins.push('decorators-legacy');
  }
  if (JSX_EXTENSIONS.has(extension)) plugins.push('jsx');
  const options = {
    sourceType: 'unambiguous',
    errorRecovery: false,
    createImportExpressions: true,
    attachComment: false,
    plugins,
  };
  if (isDeclarationPath(path)) options.allowUndeclaredExports = true;
  return options;
}

function isNode(value) {
  return typeof value === 'object' && value !== null && typeof value.type === 'string';
}

// Iterative walk over every node of the tree, including the nodes inside
// call arguments. Positions, raw text and comments are no child nodes.
function walkNodes(root) {
  const stack = [root];
  const nodes = [];
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);
    for (const key of Object.keys(node)) {
      if (NON_NODE_KEYS.has(key)) continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) stack.push(item);
        }
      } else if (isNode(value)) {
        stack.push(value);
      }
    }
  }
  return nodes;
}

// One based position of a node.
function positionOf(node) {
  const start = node?.loc?.start;
  const line = start?.line;
  const column = start?.column;
  return {
    line: Number.isSafeInteger(line) && line > 0 ? line : 1,
    column: Number.isSafeInteger(column) && column >= 0 ? column + 1 : 1,
  };
}

function makeRecord(path, kind, specifier, typeOnly, node, argumentKind) {
  const position = positionOf(node);
  return {
    path,
    kind,
    specifier,
    typeOnly,
    line: position.line,
    column: position.column,
    argumentKind,
  };
}

// Decoded text of a string literal.
function literalValue(node) {
  if (node?.type !== 'StringLiteral') return null;
  return typeof node.value === 'string' ? node.value : null;
}

// Decoded text of a template literal without any expression.
function templateValue(node) {
  if (node?.type !== 'TemplateLiteral') return null;
  if (node.expressions.length !== 0) return null;
  const cooked = node.quasis[0]?.value?.cooked;
  return typeof cooked === 'string' ? cooked : null;
}

// Specifier of an argument that may be a string or a template literal.
function specifierOf(node) {
  if (node?.type === 'StringLiteral') return literalValue(node);
  if (node?.type === 'TemplateLiteral') return templateValue(node);
  return null;
}

// Shape of an argument, without any evaluation of the expression.
function argumentKindOf(node) {
  if (node === undefined || node === null) return 'missing';
  if (node.type === 'StringLiteral') return 'literal';
  if (node.type === 'TemplateLiteral') return 'template';
  if (node.type === 'Identifier') return 'identifier';
  return 'expression';
}

// A pure type import is a type declaration or a list of type only
// specifiers. A mixed list stays a runtime import.
function isPureTypeList(specifiers, kindKey) {
  if (!Array.isArray(specifiers) || specifiers.length === 0) return false;
  return specifiers.every((specifier) => specifier[kindKey] === 'type');
}

function isTypeOnlyImport(node) {
  if (node.importKind === 'type') return true;
  return isPureTypeList(node.specifiers, 'importKind');
}

function isTypeOnlyExport(node) {
  if (node.exportKind === 'type') return true;
  return isPureTypeList(node.specifiers, 'exportKind');
}

// Static property name of a member expression. A computed property counts
// only when it is a string literal.
function staticPropertyName(member) {
  const property = member.property;
  if (member.computed === true) {
    return property?.type === 'StringLiteral' ? property.value : null;
  }
  return property?.type === 'Identifier' ? property.name : null;
}

// True for the import.meta meta property.
function isImportMeta(node) {
  return node?.type === 'MetaProperty' && node.meta?.name === 'import' && node.property?.name === 'meta';
}

// Module reference kind of a call. Only the known shapes count, a local
// function with the same name is recorded like a module reference because
// the call shape is all that the syntax shows.
function callKind(node) {
  const callee = node.callee;
  if (callee?.type === 'Identifier') {
    return callee.name === 'require' ? 'require' : null;
  }
  if (callee?.type !== 'MemberExpression' && callee?.type !== 'OptionalMemberExpression') {
    return null;
  }
  const property = staticPropertyName(callee);
  if (property === null) return null;
  const object = callee.object;
  if (property === 'resolve') {
    if (object?.type === 'Identifier' && object.name === 'require') return 'require-resolve';
    if (isImportMeta(object)) return 'import-meta-resolve';
    return null;
  }
  if (property === 'require' && object?.type === 'Identifier' && object.name === 'module') {
    return 'module-require';
  }
  return null;
}

function importRecord(path, node) {
  const specifier = literalValue(node.source);
  return makeRecord(path, 'import', specifier, isTypeOnlyImport(node), node, 'literal');
}

function exportRecord(path, node) {
  if (node.source === undefined || node.source === null) return null;
  const specifier = literalValue(node.source);
  return makeRecord(path, 'export', specifier, isTypeOnlyExport(node), node, 'literal');
}

function dynamicImportRecord(path, node) {
  const argument = node.source;
  return makeRecord(path, 'dynamic-import', specifierOf(argument), false, node, argumentKindOf(argument));
}

function callRecord(path, node) {
  const kind = callKind(node);
  if (kind === null) return null;
  const argument = node.arguments?.[0];
  return makeRecord(path, kind, specifierOf(argument), false, node, argumentKindOf(argument));
}

function importEqualsRecord(path, node) {
  const moduleReference = node.moduleReference;
  if (moduleReference?.type !== 'TSExternalModuleReference') return null;
  const expression = moduleReference.expression;
  return makeRecord(
    path,
    'ts-import-equals',
    specifierOf(expression),
    node.importKind === 'type',
    node,
    argumentKindOf(expression),
  );
}

function importTypeRecord(path, node) {
  const argument = node.argument;
  return makeRecord(path, 'ts-import-type', specifierOf(argument), true, node, argumentKindOf(argument));
}

// Record of one node, or null when the node is no module reference.
function recordForNode(path, node) {
  switch (node.type) {
    case 'ImportDeclaration':
      return importRecord(path, node);
    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration':
      return exportRecord(path, node);
    case 'ImportExpression':
      return dynamicImportRecord(path, node);
    case 'CallExpression':
    case 'OptionalCallExpression':
      return callRecord(path, node);
    case 'TSImportEqualsDeclaration':
      return importEqualsRecord(path, node);
    case 'TSImportType':
      return importTypeRecord(path, node);
    default:
      return null;
  }
}

function collectRecords(path, ast) {
  const records = [];
  for (const node of walkNodes(ast)) {
    const record = recordForNode(path, node);
    if (record !== null) records.push(record);
  }
  records.sort(
    (left, right) => left.line - right.line || left.column - right.column || compareStrings(left.kind, right.kind),
  );
  return records;
}

// Finding of a syntax error. The message of the parser never reaches the
// caller, only the position of the error does.
function parseFailureIssue(path, error) {
  const issue = { severity: 'error', code: PARSE_FAILED_CODE, path };
  const loc = error?.loc;
  if (Number.isSafeInteger(loc?.line) && loc.line > 0) issue.line = loc.line;
  if (Number.isSafeInteger(loc?.column) && loc.column >= 0) issue.column = loc.column + 1;
  return issue;
}

function isSyntaxError(error) {
  return error instanceof SyntaxError;
}

function validateInput(input) {
  if (!isPlainObject(input)) failData();
  const path = input.path;
  const source = input.source;
  if (typeof path !== 'string' || !isCanonicalRepoPath(path)) failData();
  if (!SUPPORTED_EXTENSIONS.has(extensionOf(path))) failData();
  if (typeof source !== 'string') failData();
  return { path, source };
}

// Collects the module references of one source file.
// path: canonical repository relative path with a supported extension.
// source: the file content as string.
// Returns { records, issues } and has no output side effect.
export function collectSourceImports(input = {}) {
  const { path, source } = validateInput(input);
  // The loader is called outside the syntax handling: a missing parser
  // stays the infrastructure error of the loader and never becomes a
  // syntax finding.
  const parser = loadSourceParser();
  let ast;
  try {
    ast = parser.parse(source, buildParserOptions(path));
  } catch (error) {
    if (isSyntaxError(error)) {
      return { records: [], issues: [parseFailureIssue(path, error)] };
    }
    failParser();
  }
  let records;
  try {
    records = collectRecords(path, ast);
  } catch {
    failParser();
  }
  return { records, issues: [] };
}
