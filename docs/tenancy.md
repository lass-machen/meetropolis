# Mandanten-Erweiterung (proprietäres Modul)

Die Open-Source-Distribution enthält keine Mandanten-Funktionen. Stattdessen
kann eine proprietäre Erweiterung als optionales Modul eingebunden werden.

## Architektur
- Schnittstelle: `packages/shared/src/tenancy.ts` exportiert `TenancyModule`.
- Loader: `apps/server/src/tenancyLoader.ts` lädt zur Laufzeit optional ein
  Paket `@meetropolis/tenancy`. Ist es nicht installiert, läuft das System
  strikt Single-Tenant.

## Eigenes Modul erstellen (privat)
Erstelle ein privates NPM-Paket (z. B. GitHub Packages) `@meetropolis/tenancy`
mit folgendem Export:

```ts
// index.ts in @meetropolis/tenancy
import type { TenancyModule } from '@meetropolis/shared';

const mod: TenancyModule = {
  version: 1,
  isMultiTenantEnabled: () => true,
};

export default mod;
```

Installation in der App (nur Enterprise-Deployment):
```bash
npm install @meetropolis/tenancy
```

Der OSS-Build funktioniert ohne dieses Paket unverändert.

