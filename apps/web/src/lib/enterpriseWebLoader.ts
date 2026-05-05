/**
 * Enterprise-Web Module Loader (Conditional Loading Pattern)
 *
 * Analog zu desktopLoader.ts. Lädt @meetropolis/enterprise-web per Dynamic
 * Import. Das Submodule liegt unter packages/tenancy-enterprise/packages/
 * enterprise-web/ — bei OSS-Builds ohne Submodule liefert das Vite-Plugin
 * `optionalSubmodules` ein leeres Modul (null), der Loader fängt das ab und
 * gibt null zurück; Aufrufer rendern dann den OSS-Fallback.
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
 * Lädt das Enterprise-Web-Modul falls vorhanden.
 * Gibt null zurück wenn das Modul nicht verfügbar ist (OSS-Build).
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
