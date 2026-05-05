import { create } from 'zustand';

export interface PublicConfig {
  registrationEnabled: boolean;
  billingEnabled: boolean;
  loaded: boolean;
}

interface PublicConfigState extends PublicConfig {
  load: (apiBase: string) => Promise<void>;
}

const DEFAULTS: PublicConfig = {
  registrationEnabled: true,
  billingEnabled: false,
  loaded: false,
};

export const usePublicConfigStore = create<PublicConfigState>((set, get) => ({
  ...DEFAULTS,
  load: async (apiBase: string) => {
    if (get().loaded) return;
    try {
      const res = await fetch(`${apiBase}/public/config`);
      if (!res.ok) throw new Error('public_config_http_' + res.status);
      const data = await res.json();
      set({
        registrationEnabled: typeof data.publicRegistrationEnabled === 'boolean' ? data.publicRegistrationEnabled : true,
        billingEnabled: typeof data.billingEnabled === 'boolean' ? data.billingEnabled : false,
        loaded: true,
      });
    } catch {
      // fallback: registration on, billing off (matches OSS-only deployment)
      set({ ...DEFAULTS, loaded: true });
    }
  },
}));
