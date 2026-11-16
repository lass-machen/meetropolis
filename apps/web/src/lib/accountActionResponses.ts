function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readAccountError(value: unknown) {
  const body = record(value);
  const error = record(body?.error);
  return {
    code: typeof body?.code === 'string' ? body.code : typeof error?.code === 'string' ? error.code : null,
    message: typeof body?.error === 'string' ? body.error : typeof error?.message === 'string' ? error.message : null,
    retryAfter: typeof body?.retryAfter === 'number' && body.retryAfter > 0 ? body.retryAfter : null,
  };
}

export class AccountActionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

export function needsEmailVerification(error: unknown): error is AccountActionError {
  return (
    error instanceof AccountActionError &&
    (error.code === 'EMAIL_VERIFICATION_REQUIRED' || error.code === 'EMAIL_VERIFICATION_BINDING_REQUIRED')
  );
}

export function readMailSent(value: unknown): boolean {
  return record(value)?.sent === true;
}

export function readProofResult(
  value: unknown,
): { purpose: 'invite' | 'verify' | 'email_change'; tenantSlug: string | null } | null {
  const body = record(value);
  const purpose = body?.purpose;
  if (body?.ok !== true || (purpose !== 'invite' && purpose !== 'verify' && purpose !== 'email_change')) return null;
  return { purpose, tenantSlug: typeof body.tenantSlug === 'string' ? body.tenantSlug : null };
}

export function readEmailChangePending(value: unknown): string | null {
  const body = record(value);
  return body?.emailChangePending === true && typeof body.pendingEmail === 'string' ? body.pendingEmail : null;
}

export function readVerificationDelivery(value: unknown): 'sent' | 'unavailable' | 'login_required' | null {
  const body = record(value);
  if (body?.code === 'ACCOUNT_LOGIN_REQUIRED' && body.status === 'login_required') return 'login_required';
  if (body?.code === 'EMAIL_VERIFICATION_REQUIRED' && (body.status === 'sent' || body.status === 'unavailable'))
    return body.status;
  if (body?.requiresLogin === true) return 'login_required';
  const delivery = record(value)?.pendingDelivery;
  return delivery === 'sent' || delivery === 'unavailable' ? delivery : null;
}
