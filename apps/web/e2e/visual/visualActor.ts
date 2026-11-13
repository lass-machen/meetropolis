import { createHash } from 'node:crypto';
import path from 'node:path';

import type { BrowserContext, TestInfo } from '@playwright/test';
import type { Client } from 'pg';

import { test as base } from '../fixtures';
import type { TestStackEnv } from '../fixtures';
import { passwordFor } from '../fixtures/helpers';
import { createApiRequest, MeetropolisApi } from '../support/api';
import type { TestUser } from '../support/api';
import { provisionInvitedUser } from '../support/provisioning';

import { guardOssVisualSuite } from './visualHelpers';

/** Display name of the account every visual spec acts with. */
export const VISUAL_ACTOR_NAME = 'Visuelles Testkonto';

const VISUAL_ACTOR_EMAIL_PREFIX = 'p0-visual-';
const VISUAL_ACTOR_EMAIL_DOMAIN = 'meetropolis.test';
const DEFAULT_TENANT_SLUG = 'default';

export type VisualActor = {
  user: TestUser;
  tenantSlug: string;
  email: string;
};

export type VisualActorOptions = {
  /** The onboarding overlay covers the world, so it is closed by default. */
  completeOnboarding: boolean;
};

export type VisualActorFixtures = {
  visualActor: VisualActor;
};

/**
 * The address of the account is derived from the test, not from the run: the
 * same test always gets the same address, so phase 0 and phase 1 stay comparable. No
 * absolute path, no line number, no worker index, no time, no UUID.
 */
export function visualActorEmail(testInfo: TestInfo): string {
  const relativeSpec = path.relative(testInfo.config.rootDir, testInfo.file).split(path.sep).join('/');
  const identity = [
    testInfo.project.name,
    relativeSpec,
    testInfo.titlePath.join(' > '),
    String(testInfo.repeatEachIndex),
  ].join('|');
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  return `${VISUAL_ACTOR_EMAIL_PREFIX}${digest}@${VISUAL_ACTOR_EMAIL_DOMAIN}`;
}

/**
 * The account of one visual spec: a fresh member of the default tenant that
 * only this test owns. It replaces the seed owner as the actor on the screen,
 * so nothing a spec does can change the state of the seeded accounts.
 */
export const test = base.extend<VisualActorOptions & VisualActorFixtures>({
  completeOnboarding: [true, { option: true }],

  visualActor: async (
    { page, context, playwright, stack, seed, db, completeOnboarding },
    provide,
    testInfo,
  ): Promise<void> => {
    const tenantSlug = seed.operator.tenantSlug;
    if (tenantSlug !== DEFAULT_TENANT_SLUG) {
      throw new Error(`The seed operator does not belong to the default tenant (${tenantSlug}).`);
    }
    const tenantId = seed.tenants.default?.tenantId;
    if (!tenantId) throw new Error('The seed file has no default tenant ID.');

    const email = visualActorEmail(testInfo);
    const password = stack.userPassword;
    const ownerRequest = await createApiRequest(playwright.request, stack.apiUrl, tenantSlug);
    let actorUserId: string | undefined;
    let provisioningStarted = false;
    let testError: unknown;
    const teardownErrors: Error[] = [];

    try {
      await assertNamespaceFree(db, { email, tenantId });
      await assertTenantScope(db, { tenantId, tenantSlug });

      // The seeded owner of the default tenant authorizes the invitation and
      // nothing else: its session is revoked again below.
      const ownerApi = new MeetropolisApi(ownerRequest, stack.apiUrl, tenantSlug);
      const owner = await ownerApi.login(seed.operator.email, passwordFor(seed.operator));
      if (owner.role !== 'owner' || owner.tenantSlug !== tenantSlug) {
        throw new Error(`The seed operator is not an owner of the default tenant (${owner.role}).`);
      }

      // From here on the rows of this address can only be ours: the check
      // above found neither a user nor an invitation for it.
      provisioningStarted = true;
      const user = await provisionInvitedUser({
        playwrightRequest: playwright.request,
        ownerApi,
        apiUrl: stack.apiUrl,
        tenantSlug,
        email,
        name: VISUAL_ACTOR_NAME,
        role: 'admin',
        password,
      });
      actorUserId = user.userId;

      // The login runs in the context of the test, so it carries the locale,
      // the time zone and the viewport of the visual project.
      await context.setExtraHTTPHeaders({ 'x-tenant': tenantSlug });
      const api = new MeetropolisApi(context.request, stack.apiUrl, tenantSlug);
      await api.login(user.email, passwordFor(user));

      if (completeOnboarding) await completeOnboardingRequest(context, stack);

      await provide({ user, tenantSlug, email });
    } catch (error) {
      testError = error;
    } finally {
      await page.close().catch(() => undefined);

      // The session of the seeded owner ends here and nowhere else:
      // POST /auth/logout revokes exactly the one session of the token it
      // gets (server auth.signin.ts:299-313 -> Session by tokenHash), never
      // the other sessions of that account. A non-ok answer or a transport
      // error is a teardown error - a session that outlives the test must not
      // pass unnoticed.
      let ownerLogout: OwnerLogoutReport = { status: null, ok: false, error: null };
      try {
        const response = await ownerRequest.post('/auth/logout');
        ownerLogout = { status: response.status(), ok: response.ok(), error: null };
        if (!response.ok()) {
          teardownErrors.push(new Error(`Owner-Logout: HTTP ${response.status()}.`));
        }
      } catch (error) {
        ownerLogout = { status: null, ok: false, error: transportErrorName(error) };
        teardownErrors.push(new Error(`Owner-Logout: ${transportErrorName(error)}`));
      }
      try {
        await ownerRequest.dispose();
      } catch (error) {
        teardownErrors.push(new Error(`Owner-Request-Context: ${transportErrorName(error)}`));
      }

      // The cleanup of the own actor runs in any case, also when the logout
      // failed above.
      let report: CleanupReport | null = null;
      try {
        report = await cleanupVisualActor(db, {
          email,
          tenantId,
          userId: actorUserId,
          provisioningStarted,
        });
        for (const finding of report.errors) {
          teardownErrors.push(new Error(`Actor-Cleanup: ${finding}`));
        }
      } catch (error) {
        teardownErrors.push(new Error(`Actor-Cleanup: ${cleanupErrorMessage(error)}`));
      }

      // The metadata come out even when the teardown failed - with the status
      // of the owner logout and without any token and without any password.
      // Every field is explicit: the report of the own actor is spread when
      // the cleanup ran, the placeholder carries null when it did not.
      try {
        await testInfo.attach('visual-actor-cleanup.json', {
          body: JSON.stringify(
            {
              ...(report ?? {
                email,
                userId: actorUserId ?? null,
                deleted: null,
                remaining: null,
                errors: [],
              }),
              ownerLogout,
              teardownErrors: teardownErrors.map((error) => error.message),
            },
            null,
            2,
          ),
          contentType: 'application/json',
        });
      } catch (error) {
        teardownErrors.push(new Error(`Cleanup-Anhang: ${cleanupErrorMessage(error)}`));
      }
    }

    if (teardownErrors.length > 0) {
      const errors = testError === undefined ? teardownErrors : [asError(testError), ...teardownErrors];
      throw new AggregateError(errors, 'The teardown of the visual actor failed.');
    }
    if (testError !== undefined) throw asError(testError);
  },
});

guardOssVisualSuite(test);

/**
 * The onboarding overlay covers the whole world, so the app specs close it
 * through the same endpoint the button uses. The payload stays empty: the
 * server then only marks the onboarding as done and leaves the avatar alone.
 */
async function completeOnboardingRequest(context: BrowserContext, stack: TestStackEnv): Promise<void> {
  const response = await context.request.post(`${stack.apiUrl}/auth/onboarding/complete`, { data: {} });
  if (!response.ok()) {
    throw new Error(`Onboarding could not be completed: HTTP ${response.status()}.`);
  }
}

/**
 * Before the provisioning: neither the user nor the invitation may exist yet.
 * Rows that are already there are reported, never deleted - they could belong
 * to another run.
 */
async function assertNamespaceFree(db: Client, scope: { email: string; tenantId: string }): Promise<void> {
  const users = await countRows(db, 'SELECT count(*)::text AS count FROM "User" WHERE "email" = $1', [scope.email]);
  const invites = await countRows(
    db,
    'SELECT count(*)::text AS count FROM "Invite" WHERE "email" = $1 AND "tenantId" = $2',
    [scope.email, scope.tenantId],
  );
  if (users > 0 || invites > 0) {
    throw new Error(
      `The visual actor ${scope.email} already exists (user ${users}, invite ${invites}). ` +
        'Fail closed: existing rows are not deleted.',
    );
  }
}

/** The scope of the cleanup: the default tenant of the seed, not another one. */
async function assertTenantScope(db: Client, scope: { tenantId: string; tenantSlug: string }): Promise<void> {
  const rows = await db.query<{ id: string }>('SELECT "id" FROM "Tenant" WHERE "id" = $1 AND "slug" = $2', [
    scope.tenantId,
    scope.tenantSlug,
  ]);
  if (rows.rows.length !== 1) {
    throw new Error(`The tenant ID ${scope.tenantId} does not belong to the slug ${scope.tenantSlug}.`);
  }
}

type CleanupReport = {
  email: string;
  userId: string | null;
  deleted: {
    presences: number;
    sessions: number;
    emailVerifications: number;
    memberships: number;
    invites: number;
    users: number;
  };
  remaining: { users: number; invites: number; sessions: number };
  /** Findings of the cleanup, without any token and without any password. */
  errors: string[];
};

/** State of the logout of the seeded owner, for the cleanup attachment. */
type OwnerLogoutReport = {
  status: number | null;
  ok: boolean;
  error: string | null;
};

/**
 * Deletes only the rows of this actor: the children are addressed by the
 * known id of the own user, the invitation by the own address in the default
 * tenant. The order follows the schema (the relations of User are required and
 * therefore restrict the delete).
 *
 * This SQL is deliberately schema- and table-coupled and exists only for the
 * disposable database of a test slot: a spec has no product endpoint yet that
 * would delete its own account. As soon as the product API can delete a user
 * (user deletion), this helper moves over to that endpoint and the
 * direct table access disappears.
 *
 * Nothing is deleted when the provisioning never started: rows that already
 * existed before belong to another run and are only reported.
 */
async function cleanupVisualActor(
  db: Client,
  scope: {
    email: string;
    tenantId: string;
    userId?: string | undefined;
    provisioningStarted: boolean;
  },
): Promise<CleanupReport> {
  const deleted: CleanupReport['deleted'] = {
    presences: 0,
    sessions: 0,
    emailVerifications: 0,
    memberships: 0,
    invites: 0,
    users: 0,
  };

  let userId = scope.userId ?? null;
  if (!userId && scope.provisioningStarted) {
    const rows = await db.query<{ id: string }>('SELECT "id" FROM "User" WHERE "email" = $1', [scope.email]);
    userId = rows.rows[0]?.id ?? null;
  }

  if (userId) {
    deleted.presences = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "Presence" WHERE "userId" = $1',
      'DELETE FROM "Presence" WHERE "id" = ANY($1::text[])',
      [userId],
    );
    deleted.sessions = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "Session" WHERE "userId" = $1',
      'DELETE FROM "Session" WHERE "id" = ANY($1::text[])',
      [userId],
    );
    deleted.emailVerifications = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "EmailVerification" WHERE "userId" = $1',
      'DELETE FROM "EmailVerification" WHERE "id" = ANY($1::text[])',
      [userId],
    );
    deleted.memberships = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "Membership" WHERE "userId" = $1 AND "tenantId" = $2',
      'DELETE FROM "Membership" WHERE "id" = ANY($1::text[])',
      [userId, scope.tenantId],
    );
    deleted.users = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "User" WHERE "id" = $1',
      'DELETE FROM "User" WHERE "id" = ANY($1::text[])',
      [userId],
    );
  }

  if (scope.provisioningStarted) {
    deleted.invites = await deleteOwnedRows(
      db,
      'SELECT "id" FROM "Invite" WHERE "email" = $1 AND "tenantId" = $2',
      'DELETE FROM "Invite" WHERE "id" = ANY($1::text[])',
      [scope.email, scope.tenantId],
    );
  }

  const remaining = {
    users: await countRows(db, 'SELECT count(*)::text AS count FROM "User" WHERE "email" = $1', [scope.email]),
    invites: await countRows(
      db,
      'SELECT count(*)::text AS count FROM "Invite" WHERE "email" = $1 AND "tenantId" = $2',
      [scope.email, scope.tenantId],
    ),
    sessions: userId
      ? await countRows(db, 'SELECT count(*)::text AS count FROM "Session" WHERE "userId" = $1', [userId])
      : 0,
  };
  const errors: string[] = [];
  if (scope.provisioningStarted && (remaining.users > 0 || remaining.invites > 0 || remaining.sessions > 0)) {
    errors.push(`Cleanup incomplete: ${JSON.stringify(remaining)}.`);
  }
  return { email: scope.email, userId, deleted, remaining, errors };
}

/**
 * A transport error of Playwright can carry request logs and headers, so only
 * the fixed context and the name of the error reach the report and the
 * aggregate error - never the message of the error.
 */
function transportErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/**
 * The cleanup of the own actor talks to the disposable test database and
 * carries no secret, so its message may stay - a value that is not an error
 * gets a fixed message.
 */
function cleanupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error during cleanup of the visual actor.';
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function countRows(db: Client, sql: string, params: unknown[]): Promise<number> {
  const result = await db.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? '0');
}

async function deleteOwnedRows(db: Client, selectSql: string, deleteSql: string, params: unknown[]): Promise<number> {
  const rows = await db.query<{ id: string }>(selectSql, params);
  const ids = rows.rows.map((row) => row.id);
  if (ids.length === 0) return 0;
  const result = await db.query(deleteSql, [ids]);
  return result.rowCount ?? 0;
}
