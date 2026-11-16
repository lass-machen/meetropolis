/**
 * Safety checks for the operator tenant export specs.
 *
 * Exported fields whose name looks like secret material are only allowed when
 * they are listed in `ALLOWED_SENSITIVE_FIELDS` (content hashes and encoding
 * names, never secrets). `findSpecProblems` additionally reports every drift
 * between the specs and the Prisma data model.
 */
import type { ExcludedModel, ModelExportSpec } from './types.js';

export const SENSITIVE_FIELD_PATTERN = /hash|token|password|secret|code/i;

export const ALLOWED_SENSITIVE_FIELDS: readonly string[] = [
  'MapTileset.hash',
  'MapAutotile.hash',
  'CustomAvatar.configHash',
  'MapChunk.encoding',
];

function isScalarKind(kind: string): boolean {
  return kind === 'scalar' || kind === 'enum';
}

function isForbiddenExport(model: string, field: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(field) && !ALLOWED_SENSITIVE_FIELDS.includes(`${model}.${field}`);
}

export function findSpecProblems(
  specs: readonly ModelExportSpec[],
  excluded: readonly ExcludedModel[],
  models: readonly { name: string; fields: readonly { name: string; kind: string }[] }[],
): string[] {
  const problems: string[] = [];
  const specByModel = new Map(specs.map((spec) => [spec.model, spec]));
  const excludedNames = new Set(excluded.map((entry) => entry.model));

  for (const model of models) {
    const spec = specByModel.get(model.name);
    if (!spec) {
      if (!excludedNames.has(model.name)) {
        problems.push(`model ${model.name} is neither exported nor excluded`);
      }
      continue;
    }
    const exportedNames = new Set(spec.fields);
    const omittedNames = new Set(Object.keys(spec.omitted));
    for (const field of model.fields) {
      if (!isScalarKind(field.kind)) {
        continue;
      }
      const exported = exportedNames.has(field.name);
      const omitted = omittedNames.has(field.name);
      if (!exported && !omitted) {
        problems.push(`model ${model.name}: scalar field ${field.name} is neither exported nor omitted`);
      }
      if (exported && omitted) {
        problems.push(`model ${model.name}: field ${field.name} is both exported and omitted`);
      }
      if (exported && isForbiddenExport(model.name, field.name)) {
        problems.push(`model ${model.name}: field ${field.name} looks like secret material`);
      }
    }
    const knownNames = new Set(model.fields.map((field) => field.name));
    for (const declared of [...exportedNames, ...omittedNames]) {
      if (!knownNames.has(declared)) {
        problems.push(`model ${model.name}: spec lists unknown field ${declared}`);
      }
    }
  }

  const modelNames = new Set(models.map((model) => model.name));
  for (const spec of specs) {
    if (!modelNames.has(spec.model)) {
      problems.push(`spec model ${spec.model} is missing from the data model`);
    }
  }

  return problems;
}

export function assertSpecsSafe(specs: readonly ModelExportSpec[]): void {
  const violations: string[] = [];
  for (const spec of specs) {
    for (const field of spec.fields) {
      if (isForbiddenExport(spec.model, field)) {
        violations.push(`${spec.model}.${field}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`unsafe tenant export spec, forbidden fields exported: ${violations.join(', ')}`);
  }
}
