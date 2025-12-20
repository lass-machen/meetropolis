# Test-Strategie für Meetropolis

Diese Datei definiert die Test-Strategie für das Meetropolis-Monorepo. Sie richtet sich an Entwickler:innen und automatisierte Agents.

## Übersicht

| Kategorie | Framework | Standort | Status |
|-----------|-----------|----------|--------|
| Unit Tests (Web) | Vitest + Testing Library | `apps/web/src/**/*.test.ts(x)` | Aktiv |
| Unit Tests (Server) | Vitest + Supertest | `apps/server/src/**/*.test.ts` | Aktiv |
| Unit Tests (Shared) | Vitest | `packages/shared/src/**/*.test.ts` | Neu |
| E2E Tests | Playwright | `apps/web/e2e/*.spec.ts` | In Entwicklung |
| Integration Tests | Vitest | `apps/server/src/**/*.integration.test.ts` | Neu |

---

## 1. Test-Pyramide

```
                    ┌─────────────┐
                    │    E2E      │  ← Wenige, langsame, kritische Pfade
                    │  (Playwright)│
                   ┌┴─────────────┴┐
                   │  Integration   │  ← API + DB + Colyseus zusammen
                   │    Tests       │
                  ┌┴───────────────┴┐
                  │   Unit Tests     │  ← Viele, schnelle, isolierte Tests
                  │ (Vitest)         │
                 └───────────────────┘
```

### Ziel-Coverage
- **Unit Tests**: 70% Mindest-Coverage für neue Module
- **Integration Tests**: Alle kritischen API-Endpunkte
- **E2E Tests**: Happy-Path für Kernfunktionen

---

## 2. Kritische Pfade (Pflicht-Tests)

### 2.1 Authentifizierung & Autorisierung (Blocker)

| Pfad | Beschreibung | Testtyp |
|------|--------------|---------|
| JWT-Erstellung | Token-Signierung mit korrektem Secret | Unit |
| JWT-Validierung | Token-Verifikation, Ablauf-Check | Unit |
| API-Token-Hashing | SHA256 mit Pepper | Unit |
| Cookie-Handling | httpOnly, sameSite in Prod | Integration |
| Tenant-Isolation | Queries immer nach tenantId filtern | Integration |
| Rollen-Prüfung | owner > admin > member | Unit + Integration |

**Bestehende Tests:**
- `apps/server/src/api.tokens.test.ts` - API-Token CRUD

**Fehlende Tests:**
- JWT-Lifecycle
- Session-Management
- Invite-Code-Validierung

### 2.2 Echtzeit-Kommunikation (Blocker)

| Pfad | Beschreibung | Testtyp |
|------|--------------|---------|
| Room-Verbindung | Colyseus Join/Leave | Integration |
| Spieler-Bewegung | Position-Sync über Room | Integration |
| Bubble-Gruppen | Audio-Gruppen-Formation | Unit + Integration |
| Presence-Persistenz | DB-Speicherung bei Disconnect | Integration |
| Reconnect | Automatische Wiederverbindung | E2E |

**Bestehende Tests:**
- Keine direkten Colyseus-Tests

**Benötigt:**
- Room-Message-Handler Tests
- State-Sync Tests
- Client-Limit Tests (25 OSS)

### 2.3 Audio/Video - LiveKit (Hoch)

| Pfad | Beschreibung | Testtyp |
|------|--------------|---------|
| Token-Generierung | LiveKit JWT erstellen | Unit |
| Track-Publishing | Audio/Video/Screenshare | Unit |
| Participant-Subscription | Remote Tracks abonnieren | Unit |
| Geräte-Enumeration | Mikrofone/Kameras auflisten | Unit |
| DND-Modus | Mute Mic + Kamera | Unit |
| Voice-Isolation | Rauschunterdrückung | Unit |

**Bestehende Tests (gut abgedeckt):**
- `apps/web/src/av/**/*.test.ts` (~700 Zeilen)
- AVManager, TrackManager, Audio-Pipeline

### 2.4 Datenbank-Operationen (Hoch)

| Pfad | Beschreibung | Testtyp |
|------|--------------|---------|
| Tenant-Isolation | Alle Queries mit tenantId | Integration |
| Unique Constraints | Email, Invite-Code, Map-Name | Unit |
| Kaskaden-Löschen | Foreign Key Cleanup | Integration |
| Migrationen | Schema-Änderungen | CI/CD |
| Seeding | Test-Daten erstellen | CI/CD |

**Bestehende Tests:**
- `apps/server/src/api.v2.test.ts` - Map/Layer/Chunk API

### 2.5 Billing & Enterprise (Hoch)

| Pfad | Beschreibung | Testtyp |
|------|--------------|---------|
| Stripe Webhook | Signatur-Validierung | Unit |
| Trial → Paid | Konvertierung | Integration |
| Payment Failure | Dunning-Workflow | Integration |
| Subscription Pause | Limits-Enforcement | Integration |
| Audit-Logging | Event-Protokollierung | Unit |

**Bestehende Tests:**
- Keine

---

## 3. Test-Befehle

### Entwicklung

```bash
# Alle Unit-Tests (Web)
npm run test -w @meetropolis/web

# Alle Unit-Tests (Server)
npm run test -w @meetropolis/server

# Alle Unit-Tests (Shared)
npm run test -w @meetropolis/shared

# Watch-Modus (Web)
npm run test:watch -w @meetropolis/web

# Coverage-Report (Web)
npm run test:coverage -w @meetropolis/web

# E2E-Tests (Playwright)
npm run e2e -w @meetropolis/web
```

### CI/CD

```bash
# Alle Tests mit Coverage
npm run test:ci

# Nur schnelle Tests (keine E2E)
npm run test:fast
```

---

## 4. Mocking-Strategien

### 4.1 Externe Services

```typescript
// LiveKit
vi.mock('livekit-client', () => ({
  Room: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    localParticipant: { publishTrack: vi.fn() }
  })),
  createLocalTracks: vi.fn().mockResolvedValue([mockAudioTrack]),
}));

// Prisma (In-Memory)
vi.mock('./prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    tenant: { findUnique: vi.fn(), findMany: vi.fn() },
    // ... weitere Modelle
  }
}));

// Stripe
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: vi.fn() },
    customers: { create: vi.fn() },
    subscriptions: { create: vi.fn() }
  }))
}));
```

### 4.2 Browser-APIs

```typescript
// matchMedia
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
});

// Canvas für Phaser
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  // ... weitere Canvas-Methoden
});
```

### 4.3 Test-Factories

```typescript
// Standort: apps/web/src/test/factories/
export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides
  };
}

export function createMockTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
    concurrentLimit: 25,
    ...overrides
  };
}

export function createMockRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room-123',
    name: 'Test Room',
    mapId: 'map-123',
    ...overrides
  };
}
```

---

## 5. Test-Struktur und Namenskonventionen

### Datei-Benennung

| Typ | Muster | Beispiel |
|-----|--------|----------|
| Unit Test | `*.test.ts(x)` | `avManager.test.ts` |
| Integration Test | `*.integration.test.ts` | `auth.integration.test.ts` |
| E2E Test | `*.spec.ts` | `login.spec.ts` |

### Test-Struktur

```typescript
describe('ModuleName', () => {
  // Setup für alle Tests
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('functionName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = createMockInput();

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toEqual(expected);
    });

    it('should handle edge case', () => {
      // ...
    });

    it('should throw on invalid input', () => {
      expect(() => functionName(null)).toThrow('Invalid input');
    });
  });
});
```

### Assertion-Richtlinien

- **Spezifisch testen**: Nicht `toBeTruthy()`, sondern `toBe(true)` oder `toEqual(expected)`
- **Fehlermeldungen**: Bei komplexen Assertions Beschreibung hinzufügen
- **Async korrekt**: `await expect(promise).resolves.toEqual()` oder `.rejects.toThrow()`

---

## 6. Coverage-Konfiguration

### Vitest Coverage (apps/web)

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'e2e/',
        '**/*.d.ts',
        'src/test/**',
        '**/*.config.*'
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60
      }
    }
  }
});
```

### Mindest-Coverage nach Modul

| Modul | Lines | Functions | Branches |
|-------|-------|-----------|----------|
| `apps/web/src/av/` | 70% | 70% | 60% |
| `apps/web/src/lib/` | 80% | 80% | 70% |
| `apps/web/src/services/` | 70% | 70% | 60% |
| `apps/server/src/api/` | 70% | 70% | 60% |
| `packages/shared/` | 90% | 90% | 80% |

---

## 7. E2E-Test-Strategie

### Szenarien (Priorität)

1. **Login/Logout-Flow** (Kritisch)
   - Erfolgreicher Login
   - Falsche Credentials
   - Session-Ablauf

2. **Room-Beitritt** (Kritisch)
   - Welt laden
   - Andere Spieler sehen
   - Bewegung funktioniert

3. **Audio/Video** (Hoch)
   - Mikrofon aktivieren
   - Kamera aktivieren
   - DND-Toggle

4. **Map-Editor** (Mittel)
   - Map öffnen
   - Tile platzieren
   - Speichern

### Playwright-Konfiguration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  use: {
    baseURL: 'http://localhost:5173',
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
});
```

### Multi-User-Tests

```typescript
// e2e/multiuser.spec.ts
test('two users can see each other', async ({ browser }) => {
  const userA = await browser.newContext();
  const userB = await browser.newContext();

  const pageA = await userA.newPage();
  const pageB = await userB.newPage();

  // Login beide User
  await loginAs(pageA, 'user-a@test.com');
  await loginAs(pageB, 'user-b@test.com');

  // Beide betreten den gleichen Room
  await pageA.goto('/room/test-room');
  await pageB.goto('/room/test-room');

  // User A sieht User B
  await expect(pageA.locator('[data-player="user-b"]')).toBeVisible();

  // User B sieht User A
  await expect(pageB.locator('[data-player="user-a"]')).toBeVisible();
});
```

---

## 8. Lokale Test-Ausführung

### Pre-Commit Checkliste

Vor jedem Commit sollten diese Tests lokal ausgeführt werden:

```bash
# 1. Server Tests
npm run test -w @meetropolis/server

# 2. Web Tests mit Coverage
npm run test:coverage -w @meetropolis/web

# 3. Shared Package Tests
npm run test -w @meetropolis/shared

# 4. TypeScript-Check (Build)
npm run build
```

### Schneller Test-Workflow

```bash
# Nur geänderte Dateien testen (Watch-Modus)
npm run test:watch -w @meetropolis/web

# Spezifischen Test ausführen
npx vitest run src/av/avManager.test.ts -w @meetropolis/web
```

### Pre-Commit Hook (Optional)

```bash
# package.json scripts hinzufügen:
"test:pre-commit": "npm run test -w @meetropolis/server && npm run test -w @meetropolis/web"
```

---

## 9. Test-Daten-Management

### Fixtures

```typescript
// apps/server/src/test/fixtures/users.ts
export const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin123!',
    role: 'admin'
  },
  member: {
    email: 'member@test.com',
    password: 'Member123!',
    role: 'member'
  }
};
```

### Database Seeding für Tests

```typescript
// apps/server/prisma/seed.test.ts
async function seedTestData() {
  await prisma.tenant.create({
    data: {
      slug: 'test-tenant',
      name: 'Test Tenant',
      concurrentLimit: 25,
      users: {
        create: [testUsers.admin, testUsers.member]
      }
    }
  });
}
```

### Test-Isolation

```typescript
// Vor jedem Test: Datenbank zurücksetzen
beforeEach(async () => {
  await prisma.$transaction([
    prisma.presence.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
});
```

---

## 10. Performance-Tests (Optional)

### Benchmark-Konfiguration

```typescript
// apps/web/src/benchmarks/av.bench.ts
import { bench, describe } from 'vitest';

describe('AVManager Performance', () => {
  bench('track publishing latency', async () => {
    const manager = createAVManager();
    await manager.publishAudioTrack();
  });

  bench('participant subscription', async () => {
    const manager = createAVManager();
    await manager.subscribeToParticipant('remote-123');
  });
});
```

---

## 11. Accessibility-Tests

### Component-Level

```typescript
// Mit @axe-core/react
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('Button has no accessibility violations', async () => {
  const { container } = render(<Button>Click me</Button>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### E2E-Level

```typescript
// e2e/accessibility.spec.ts
import AxeBuilder from '@axe-core/playwright';

test('login page should be accessible', async ({ page }) => {
  await page.goto('/login');
  const accessibilityScanResults = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScanResults.violations).toEqual([]);
});
```

---

## 12. Debugging-Tipps

### Vitest Debug-Modus

```bash
# Einzelnen Test debuggen
npx vitest run src/av/avManager.test.ts --reporter=verbose

# Mit Browser UI
npx vitest --ui

# Mit Coverage im Browser
npx vitest --coverage --ui
```

### Playwright Debug-Modus

```bash
# Mit UI
npx playwright test --ui

# Headed Browser
npx playwright test --headed

# Schritt-für-Schritt
npx playwright test --debug
```

---

## 13. Wartung und Review

### Wöchentliche Tasks

- [ ] Coverage-Trends prüfen
- [ ] Flaky Tests identifizieren und fixen
- [ ] Neue Module auf Test-Coverage prüfen

### Bei Code-Reviews

- [ ] Neue Logik hat Unit-Tests
- [ ] Edge Cases abgedeckt
- [ ] Keine `any`-Typen in Tests
- [ ] Mocks aufgeräumt (afterEach cleanup)
- [ ] Tests sind deterministisch (keine Zeitabhängigkeiten)

---

## Zusammenfassung

Diese Test-Strategie bietet:

1. **Klare Prioritäten**: Kritische Pfade zuerst testen
2. **Modulare Struktur**: Tests nahe am Code
3. **Automatisierung**: CI/CD für jeden PR
4. **Coverage-Ziele**: Messbare Qualität
5. **E2E für UX**: Kernfunktionen end-to-end testen

Fragen oder Ergänzungen? Issues erstellen oder AGENTS.md konsultieren.
