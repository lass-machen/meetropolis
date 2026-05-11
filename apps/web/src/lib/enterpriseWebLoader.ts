/**
 * Enterprise-web module loader (conditional loading pattern).
 *
 * Mirrors desktopLoader.ts. Loads @meetropolis/enterprise-web via dynamic
 * import. The submodule lives at packages/tenancy-enterprise/packages/
 * enterprise-web/. For OSS builds without the submodule, the Vite plugin
 * `optionalSubmodules` returns an empty module (null); this loader detects
 * that case and returns null so callers render the OSS fallback.
 */

import type { ComponentType } from 'react';
import type { AdminCapabilities } from '../app/routes/hooks/useFetchMe';

export interface EnterpriseWebModule {
  AdminEnterpriseTabs: ComponentType<{ apiBase: string; capabilities: AdminCapabilities }>;
  BillingDashboard: ComponentType<{ activeTab: string; onTabChange: (k: string) => void; onClose: () => void }>;
  PackStore: ComponentType<{ apiBase: string; open: boolean; onOpenChange: (v: boolean) => void }>;
}

let cached: EnterpriseWebModule | null | undefined = undefined; // undefined = not yet tried

/**
 * Load the enterprise-web module when available.
 * Returns null when the module is missing (OSS build).
 */
export async function getEnterpriseWebModule(): Promise<EnterpriseWebModule | null> {
  if (cached !== undefined) return cached;

  try {
    const mod: any = await import('@meetropolis/enterprise-web');
    const resolved = mod.default ?? mod;
    if (!resolved || typeof resolved.AdminEnterpriseTabs !== 'function') {
      cached = null;
      return null;
    }
    cached = resolved as EnterpriseWebModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}
