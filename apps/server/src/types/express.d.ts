import 'express-serve-static-core';
import type { Tenant } from '../generated/prisma/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    tenantSlug?: string;
    tenantId?: string;
    tenant?: Tenant;
    /** Correlation/request id assigned by the request logger middleware. */
    id?: string;
  }
}
