# Tenancy boundary

The OSS distribution is single-tenant. A multi-tenancy adapter can be
plugged in at runtime via an optional, closed-source module — see
[`enterprise.md`](./enterprise.md) for details.

## Interface

`packages/shared/src/tenancy.ts` exports the `TenancyModule` contract.

## Loader

`apps/server/src/tenancyLoader.ts` resolves a tenancy module at runtime.
When nothing is resolvable, the system stays strictly single-tenant.

## Minimal module shape

```ts
// index.ts in your tenancy package
import type { TenancyModule } from '@meetropolis/shared';

const mod: TenancyModule = {
  version: 1,
  isMultiTenantEnabled: () => true,
};

export default mod;
```

Point the loader at your package using `MEETROPOLIS_ENTERPRISE_PATH` or a
sibling clone at `../meetropolis-enterprise`. The OSS build runs unchanged
without any tenancy package installed.
