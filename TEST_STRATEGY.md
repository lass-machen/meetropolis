# Test Strategy for Meetropolis

This file defines the test strategy for the Meetropolis monorepo. It is intended for developers and automated agents.

## Overview

| Category            | Framework                | Location                                   | Status         |
| ------------------- | ------------------------ | ------------------------------------------ | -------------- |
| Unit Tests (Web)    | Vitest + Testing Library | `apps/web/src/**/*.test.ts(x)`             | Active         |
| Unit Tests (Server) | Vitest + Supertest       | `apps/server/src/**/*.test.ts`             | Active         |
| Unit Tests (Shared) | Vitest                   | `packages/shared/src/**/*.test.ts`         | New            |
| E2E Tests           | Playwright               | `apps/web/e2e/*.spec.ts`                   | In Development |
| Integration Tests   | Vitest                   | `apps/server/src/**/*.integration.test.ts` | Planned (none) |

---

## 1. Test Pyramid

```
                    ┌─────────────┐
                    │    E2E      │  ← Few, slow, critical paths
                    │  (Playwright)│
                   ┌┴─────────────┴┐
                   │  Integration   │  ← API + DB + Colyseus together
                   │    Tests       │
                  ┌┴───────────────┴┐
                  │   Unit Tests     │  ← Many, fast, isolated tests
                  │ (Vitest)         │
                 └───────────────────┘
```

### Target Coverage

- **Unit Tests**: 70% minimum coverage for new modules
- **Integration Tests**: All critical API endpoints
- **E2E Tests**: Happy path for core features

---

## 2. Critical Paths (Mandatory Tests)

### 2.1 Authentication & Authorization (Blocker)

| Path              | Description                         | Test Type          |
| ----------------- | ----------------------------------- | ------------------ |
| JWT creation      | Token signing with correct secret   | Unit               |
| JWT validation    | Token verification, expiry check    | Unit               |
| API token hashing | SHA256 with Pepper                  | Unit               |
| Cookie handling   | httpOnly, sameSite in prod          | Integration        |
| Tenant isolation  | Queries always filtered by tenantId | Integration        |
| Role check        | owner > admin > member              | Unit + Integration |

**Existing tests:**

- `apps/server/src/api.tokens.test.ts` - API token CRUD

**Missing tests:**

- JWT lifecycle
- Session management
- Invite code validation

### 2.2 Real-Time Communication (Blocker)

| Path                 | Description              | Test Type          |
| -------------------- | ------------------------ | ------------------ |
| Room connection      | Colyseus join/leave      | Integration        |
| Player movement      | Position sync via room   | Integration        |
| Bubble groups        | Audio group formation    | Unit + Integration |
| Presence persistence | DB storage on disconnect | Integration        |
| Reconnect            | Automatic reconnection   | E2E                |

**Existing tests:**

- No direct Colyseus tests

**Required:**

- Room message handler tests
- State sync tests
- Client limit tests (25 OSS)

### 2.3 Audio/Video - LiveKit (High)

| Path                     | Description                | Test Type |
| ------------------------ | -------------------------- | --------- |
| Token generation         | Create LiveKit JWT         | Unit      |
| Track publishing         | Audio/video/screenshare    | Unit      |
| Participant subscription | Subscribe to remote tracks | Unit      |
| Device enumeration       | List microphones/cameras   | Unit      |
| DND mode                 | Mute mic + camera          | Unit      |
| Voice isolation          | Noise suppression          | Unit      |

**Existing tests (well covered):**

- `apps/web/src/av/**/*.test.ts` (~700 lines)
- AVManager, TrackManager, audio pipeline

### 2.4 Database Operations (High)

| Path               | Description                  | Test Type   |
| ------------------ | ---------------------------- | ----------- |
| Tenant isolation   | All queries with tenantId    | Integration |
| Unique constraints | Email, invite code, map name | Unit        |
| Cascade deletion   | Foreign key cleanup          | Integration |
| Migrations         | Schema changes               | CI/CD       |
| Seeding            | Create test data             | CI/CD       |

**Existing tests:**

- `apps/server/src/api.v2.test.ts` - Map/layer/chunk API

### 2.5 Billing & Enterprise (High)

| Path               | Description          | Test Type   |
| ------------------ | -------------------- | ----------- |
| Stripe webhook     | Signature validation | Unit        |
| Trial → paid       | Conversion           | Integration |
| Payment failure    | Dunning workflow     | Integration |
| Subscription pause | Limits enforcement   | Integration |
| Audit logging      | Event recording      | Unit        |

**Existing tests:**

- None

---

## 3. Test Commands

### Development

```bash
# All unit tests (web)
npm run test -w @meetropolis/web

# All unit tests (server)
npm run test -w @meetropolis/server

# All unit tests (shared)
npm run test -w @meetropolis/shared

# Watch mode (web)
npm run test:watch -w @meetropolis/web

# Coverage report (web)
npm run test:coverage -w @meetropolis/web

# E2E tests (Playwright)
npm run e2e -w @meetropolis/web
```

### CI/CD

```bash
# Full local check (lint, typecheck, build, all unit tests)
npm run ci:local

# Unit tests per workspace (no E2E)
npm run test -w @meetropolis/server
npm run test -w @meetropolis/web
npm run test -w @meetropolis/shared
```

---

## 4. Mocking Strategies

### 4.1 External Services

```typescript
// LiveKit
vi.mock('livekit-client', () => ({
  Room: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    localParticipant: { publishTrack: vi.fn() },
  })),
  createLocalTracks: vi.fn().mockResolvedValue([mockAudioTrack]),
}));

// Prisma (In-Memory)
vi.mock('./prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    tenant: { findUnique: vi.fn(), findMany: vi.fn() },
    // ... additional models
  },
}));

// Stripe
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    webhooks: { constructEvent: vi.fn() },
    customers: { create: vi.fn() },
    subscriptions: { create: vi.fn() },
  })),
}));
```

### 4.2 Browser APIs

```typescript
// matchMedia
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// Canvas for Phaser
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  // ... additional canvas methods
});
```

### 4.3 Test Factories

```typescript
// Location: apps/web/src/test/factories/
export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides,
  };
}

export function createMockTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
    concurrentLimit: 25,
    ...overrides,
  };
}

export function createMockRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room-123',
    name: 'Test Room',
    mapId: 'map-123',
    ...overrides,
  };
}
```

---

## 5. Test Structure and Naming Conventions

### File Naming

| Type             | Pattern                 | Example                    |
| ---------------- | ----------------------- | -------------------------- |
| Unit test        | `*.test.ts(x)`          | `avManager.test.ts`        |
| Integration test | `*.integration.test.ts` | `auth.integration.test.ts` |
| E2E test         | `*.spec.ts`             | `login.spec.ts`            |

### Test Structure

```typescript
describe('ModuleName', () => {
  // Setup for all tests
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

### Assertion Guidelines

- **Test specifically**: Not `toBeTruthy()`, but `toBe(true)` or `toEqual(expected)`
- **Error messages**: Add a description for complex assertions
- **Async correctly**: `await expect(promise).resolves.toEqual()` or `.rejects.toThrow()`

---

## 6. Coverage Configuration

### Vitest Coverage (apps/web)

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'dist/', 'e2e/', '**/*.d.ts', 'src/test/**', '**/*.config.*'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
```

### Minimum Coverage by Module

| Module                   | Lines | Functions | Branches |
| ------------------------ | ----- | --------- | -------- |
| `apps/web/src/av/`       | 70%   | 70%       | 60%      |
| `apps/web/src/lib/`      | 80%   | 80%       | 70%      |
| `apps/web/src/services/` | 70%   | 70%       | 60%      |
| `apps/server/src/api/`   | 70%   | 70%       | 60%      |
| `packages/shared/`       | 90%   | 90%       | 80%      |

---

## 7. E2E Test Strategy

### Scenarios (Priority)

1. **Login/logout flow** (Critical)
   - Successful login
   - Wrong credentials
   - Session expiry

2. **Room join** (Critical)
   - Load world
   - See other players
   - Movement works

3. **Audio/video** (High)
   - Activate microphone
   - Activate camera
   - DND toggle

4. **Map editor** (Medium)
   - Open map
   - Place tile
   - Save

### Playwright Configuration

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

> Note: this is an illustrative example. The real `apps/web/playwright.config.ts`
> has no `webServer` block; E2E is launched via `node ./e2e-run.js`, which
> brings up the stack.

### Multi-User Tests

```typescript
// e2e/multiuser.spec.ts
test('two users can see each other', async ({ browser }) => {
  const userA = await browser.newContext();
  const userB = await browser.newContext();

  const pageA = await userA.newPage();
  const pageB = await userB.newPage();

  // Login both users
  await loginAs(pageA, 'user-a@test.com');
  await loginAs(pageB, 'user-b@test.com');

  // Both enter the same room
  await pageA.goto('/room/test-room');
  await pageB.goto('/room/test-room');

  // User A sees user B
  await expect(pageA.locator('[data-player="user-b"]')).toBeVisible();

  // User B sees user A
  await expect(pageB.locator('[data-player="user-a"]')).toBeVisible();
});
```

---

## 8. Local Test Execution

### Pre-Commit Checklist

Before each commit, these tests should be run locally:

```bash
# 1. Server tests
npm run test -w @meetropolis/server

# 2. Web tests with coverage
npm run test:coverage -w @meetropolis/web

# 3. Shared package tests
npm run test -w @meetropolis/shared

# 4. TypeScript check (build)
npm run build
```

### Fast Test Workflow

```bash
# Test only changed files (watch mode)
npm run test:watch -w @meetropolis/web

# Run a specific test
npx vitest run src/av/avManager.test.ts -w @meetropolis/web
```

### Pre-Commit Hook (Optional)

```bash
# Add to package.json scripts:
"test:pre-commit": "npm run test -w @meetropolis/server && npm run test -w @meetropolis/web"
```

> Note: a Husky pre-commit hook (lint-staged, via the `prepare` script)
> already runs on commit. The snippet above is an optional extra check
> that is not currently wired up.

---

## 9. Test Data Management

### Fixtures

```typescript
// apps/server/src/test/fixtures/users.ts
export const testUsers = {
  admin: {
    email: 'admin@test.com',
    password: 'Admin123!',
    role: 'admin',
  },
  member: {
    email: 'member@test.com',
    password: 'Member123!',
    role: 'member',
  },
};
```

### Database Seeding for Tests

```typescript
// apps/server/prisma/seed.test.ts
async function seedTestData() {
  await prisma.tenant.create({
    data: {
      slug: 'test-tenant',
      name: 'Test Tenant',
      concurrentLimit: 25,
      users: {
        create: [testUsers.admin, testUsers.member],
      },
    },
  });
}
```

### Test Isolation

```typescript
// Before each test: reset database
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

## 10. Performance Tests (Optional)

### Benchmark Configuration

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

## 11. Accessibility Tests

### Component Level

```typescript
// With @axe-core/react
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

test('Button has no accessibility violations', async () => {
  const { container } = render(<Button>Click me</Button>);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### E2E Level

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

## 12. Debugging Tips

### Vitest Debug Mode

```bash
# Debug a single test
npx vitest run src/av/avManager.test.ts --reporter=verbose

# With browser UI
npx vitest --ui

# With coverage in browser
npx vitest --coverage --ui
```

### Playwright Debug Mode

```bash
# With UI
npx playwright test --ui

# Headed browser
npx playwright test --headed

# Step by step
npx playwright test --debug
```

---

## 13. Maintenance and Review

### Weekly Tasks

- [ ] Check coverage trends
- [ ] Identify and fix flaky tests
- [ ] Check new modules for test coverage

### During Code Reviews

- [ ] New logic has unit tests
- [ ] Edge cases covered
- [ ] No `any` types in tests
- [ ] Mocks cleaned up (afterEach cleanup)
- [ ] Tests are deterministic (no time dependencies)

---

## Summary

This test strategy provides:

1. **Clear priorities**: Test critical paths first
2. **Modular structure**: Tests close to the code
3. **Automation**: CI/CD for every PR
4. **Coverage targets**: Measurable quality
5. **E2E for UX**: Test core features end-to-end

Questions or additions? Create issues or consult AGENTS.md.
