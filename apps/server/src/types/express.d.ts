import 'express-serve-static-core';
import type { Tenant } from '../generated/prisma/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    tenantSlug?: string;
    tenantId?: string;
    tenant?: Tenant;
  }
}

