import { describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/index.js';
import type { ExcludedModel, ModelExportSpec } from './types.js';
import { OSS_EXCLUDED_MODELS, OSS_EXPORT_SPECS } from './spec.js';
import { assertSpecsSafe, findSpecProblems } from './specCheck.js';

type ProbeModel = { name: string; fields: { name: string; kind: string }[] };

function specFor(model: string, fields: readonly string[], omitted: Record<string, string> = {}): ModelExportSpec {
  return {
    model,
    delegate: model,
    file: `db/${model}.json`,
    fields,
    omitted,
    orderBy: ['id'],
    where: () => ({}),
  };
}

describe('tenant export spec against the Prisma data model', () => {
  it('covers every model and scalar field without secret leaks', () => {
    expect(findSpecProblems(OSS_EXPORT_SPECS, OSS_EXCLUDED_MODELS, Prisma.dmmf.datamodel.models)).toEqual([]);
  });

  it('reports a model that is neither exported nor excluded', () => {
    const models: ProbeModel[] = [{ name: 'Widget', fields: [] }];
    expect(findSpecProblems([], [], models)).toHaveLength(1);
  });

  it('reports a scalar field that is neither exported nor omitted', () => {
    const models: ProbeModel[] = [{ name: 'Widget', fields: [{ name: 'id', kind: 'scalar' }] }];
    expect(findSpecProblems([specFor('Widget', [])], [], models)).toHaveLength(1);
  });

  it('reports an exported password hash', () => {
    const models: ProbeModel[] = [
      {
        name: 'Widget',
        fields: [
          { name: 'id', kind: 'scalar' },
          { name: 'passwordHash', kind: 'scalar' },
        ],
      },
    ];
    expect(findSpecProblems([specFor('Widget', ['id', 'passwordHash'])], [], models)).toHaveLength(1);
  });

  it('reports a field listed as both exported and omitted', () => {
    const models: ProbeModel[] = [{ name: 'Widget', fields: [{ name: 'id', kind: 'scalar' }] }];
    expect(findSpecProblems([specFor('Widget', ['id'], { id: 'kept back' })], [], models)).toHaveLength(1);
  });

  it('reports a spec field unknown to the data model', () => {
    const models: ProbeModel[] = [{ name: 'Widget', fields: [{ name: 'id', kind: 'scalar' }] }];
    expect(findSpecProblems([specFor('Widget', ['id', 'ghost'])], [], models)).toHaveLength(1);
  });

  it('reports a spec model missing from the data model', () => {
    const specs: ModelExportSpec[] = [specFor('Ghost', ['id'])];
    const excluded: ExcludedModel[] = [];
    expect(findSpecProblems(specs, excluded, [])).toHaveLength(1);
  });
});

describe('tenant export spec safety', () => {
  it('accepts the OSS specs without throwing', () => {
    expect(() => assertSpecsSafe(OSS_EXPORT_SPECS)).not.toThrow();
  });

  it('rejects an exported password hash', () => {
    expect(() => assertSpecsSafe([specFor('Widget', ['id', 'passwordHash'])])).toThrow();
  });

  it('exports no User field beyond the allowlisted identity fields', () => {
    const userSpec = OSS_EXPORT_SPECS.find((spec) => spec.model === 'User');
    expect(userSpec).toBeDefined();
    expect([...(userSpec?.fields ?? [])].sort()).toEqual(['createdAt', 'email', 'id', 'imageUrl', 'locale', 'name']);
  });

  it('never exports the invite code', () => {
    const inviteSpec = OSS_EXPORT_SPECS.find((spec) => spec.model === 'Invite');
    expect(inviteSpec).toBeDefined();
    expect(inviteSpec?.fields).not.toContain('code');
    expect(inviteSpec?.omitted['code']).toBeDefined();
  });
});
