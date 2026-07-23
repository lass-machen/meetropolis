import { create } from 'zustand';

export interface PublicConfig {
  registrationEnabled: boolean;
  billingEnabled: boolean;
  avatarEditorEnabled: boolean;
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
}

const DEFAULTS: PublicConfig = {
  registrationEnabled: true,
  billingEnabled: false,
  avatarEditorEnabled: false,
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
        loaded: true,
      });
    } catch {
      // fallback: registration on, billing off (matches OSS-only deployment)
      set({ ...DEFAULTS, loaded: true });
    }
  },
}));
