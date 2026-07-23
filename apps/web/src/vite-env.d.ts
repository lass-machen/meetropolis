/// <reference types="vite/client" />

// Augment Vite's ImportMetaEnv with the project-specific VITE_* variables.
//
// Without this declaration, `import.meta.env.VITE_X` is typed as `any` from
// the default index signature, which makes the no-unsafe-* and no-explicit-any
// lint rules fire wherever env vars are read. With explicit typings, callers
// get IDE completion, typo detection, and a clean lint surface.
//
// Keep this file in sync with the VITE_* variables actually consumed by the
// codebase. Add new entries when introducing a new env var, prune them when
// removing one.

interface ImportMetaEnv {
  // Backend wiring
  readonly VITE_API_BASE?: string;
  readonly VITE_LIVEKIT_URL?: string;
  readonly VITE_LIVEKIT_TOKEN_TIMEOUT_MS?: string;
  readonly VITE_LIVEKIT_URL_TIMEOUT_MS?: string;
  readonly VITE_LIVEKIT_CONNECT_TIMEOUT_MS?: string;
  readonly VITE_MIC_PUBLISH_TIMEOUT_MS?: string;
  readonly VITE_COLYSEUS_JOIN_TIMEOUT_MS?: string;
  readonly VITE_COLYSEUS_STATE_TIMEOUT_MS?: string;
  readonly VITE_HEARTBEAT_INTERVAL_MS?: string;

  // AV behaviour
  readonly VITE_AV_DEBUG?: string;
  readonly VITE_AV_FORCE_RELAY?: string;
  readonly VITE_LK_FORCE_RELAY?: string;
  readonly VITE_AV_MAX_VIDEO_SUBS?: string;
  readonly VITE_AV_BUBBLE_ATTENUATION_DB?: string;
  readonly VITE_AV_VIDEO_RETENTION_MS?: string;
  readonly VITE_AV_REPUBLISH_DEBOUNCE_MS?: string;

  // Feature flags
  readonly VITE_FEATURE_AV_SETTINGS?: string;
  readonly VITE_FEATURE_VOICE_ONLY?: string;

  // Logging / debugging
  readonly VITE_LOG_LEVEL?: string;
  readonly VITE_DEBUG_LOGS?: string;

  // Debug autologin (dev/staging only)
  readonly VITE_DEBUG_AUTOLOGIN?: string;
  readonly VITE_DEBUG_AUTOLOGIN_ALLOW_PROD?: string;
  readonly VITE_DEBUG_AUTOLOGIN_EMAIL?: string;
  readonly VITE_DEBUG_AUTOLOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
