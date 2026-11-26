import { create } from 'zustand';
import type { PublicAdsConfig } from '../lib/brandLoader';

export interface PublicConfig {
  registrationEnabled: boolean;
  billingEnabled: boolean;
  avatarEditorEnabled: boolean;
  ads: PublicAdsConfig | null;
  loaded: boolean;
}

interface PublicConfigState extends PublicConfig {
  load: (apiBase: string) => Promise<void>;
}

/** Shape returned by GET /public/config (only fields this store reads). */
interface PublicConfigResponse {
  publicRegistrationEnabled?: boolean;
  billingEnabled?: boolean;
  avatarEditorEnabled?: boolean;
  /**
   * Optional telemetry activation block, present only when the closed-source
   * telemetry module is loaded and enabled server-side. Carries no secrets and
   * names no vendor. The telemetry module fetches `/public/config` itself at
   * init, so this OSS store does not act on the block; it is declared here only
   * to document the OSS-facing contract and keep the response shape typed.
   */
  telemetry?: { enabled?: boolean; environment?: string };
  /**
   * Optional ads consent block, present only when the server is configured
   * for ads measurement. Normalization (id/label/mode rules) happens on the
   * providing side; this store keeps the block as received when it is an
   * object and falls back to null otherwise.
   */
  ads?: unknown;
}

const DEFAULTS: PublicConfig = {
  registrationEnabled: true,
  billingEnabled: false,
  avatarEditorEnabled: false,
  ads: null,
  loaded: false,
};

export const usePublicConfigStore = create<PublicConfigState>((set, get) => ({
  ...DEFAULTS,
  load: async (apiBase: string) => {
    if (get().loaded) return;
    try {
      const res = await fetch(`${apiBase}/public/config`);
      if (!res.ok) throw new Error('public_config_http_' + res.status);
      const data = (await res.json()) as PublicConfigResponse;
      set({
        registrationEnabled:
          typeof data.publicRegistrationEnabled === 'boolean' ? data.publicRegistrationEnabled : true,
        billingEnabled: typeof data.billingEnabled === 'boolean' ? data.billingEnabled : false,
        avatarEditorEnabled: typeof data.avatarEditorEnabled === 'boolean' ? data.avatarEditorEnabled : false,
        ads: typeof data.ads === 'object' && data.ads !== null ? (data.ads as PublicAdsConfig) : null,
        loaded: true,
      });
    } catch {
      // fallback: registration on, billing off (matches OSS-only deployment)
      set({ ...DEFAULTS, loaded: true });
    }
  },
}));
