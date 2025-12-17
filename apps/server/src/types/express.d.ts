import 'express-serve-static-core';
import type { Tenant } from '@prisma/client';

declare module 'express-serve-static-core' {
  interface Request {
    tenantSlug?: string;
    tenantId?: string;
    tenant?: Tenant;
  }
}

