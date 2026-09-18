export type ExpectedPackVisibility = 'accessible' | 'base-only' | 'error';

export interface EnterprisePackResolverState {
  name: string;
  hook: 'absent' | 'resolve' | 'reject';
  result?: (catalogPackUuids: readonly string[]) => unknown;
  expected: ExpectedPackVisibility;
}

/** Shared contract matrix for every security-sensitive pack consumer. */
export const ENTERPRISE_PACK_RESOLVER_STATES: readonly EnterprisePackResolverState[] = [
  { name: 'hook absent', hook: 'absent', expected: 'accessible' },
  {
    name: 'empty accessible set',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids, accessiblePackUuids: [] }),
    expected: 'base-only',
  },
  {
    name: 'accessible UUIDs',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids, accessiblePackUuids: catalogPackUuids }),
    expected: 'accessible',
  },
  { name: 'undefined result', hook: 'resolve', result: () => undefined, expected: 'error' },
  { name: 'rejected promise', hook: 'reject', expected: 'error' },
  {
    name: 'non-array catalogue',
    hook: 'resolve',
    result: () => ({ catalogPackUuids: 'catalogued-pack', accessiblePackUuids: [] }),
    expected: 'error',
  },
  {
    name: 'mixed catalogue array',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids: [...catalogPackUuids, 7], accessiblePackUuids: [] }),
    expected: 'error',
  },
  {
    name: 'missing accessible set',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids }),
    expected: 'base-only',
  },
  {
    name: 'non-array accessible set',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids, accessiblePackUuids: 'catalogued-pack' }),
    expected: 'base-only',
  },
  {
    name: 'mixed accessible array',
    hook: 'resolve',
    result: (catalogPackUuids) => ({ catalogPackUuids, accessiblePackUuids: [catalogPackUuids[0], 7] }),
    expected: 'base-only',
  },
];
