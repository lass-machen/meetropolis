/**
 * AV Module Public API
 *
 * This is the main entry point for the audio/video system.
 */

// Main manager
export { AVManager } from './avManager';
export type { AVDevices } from './core/types';

// Hooks
export { useAVManager } from './hooks/useAVManager';
export { useDoNotDisturb, toggleDoNotDisturb } from './hooks/useDoNotDisturb';
export { useGlobalAudioTracks } from './useGlobalAudioTracks';

// Logger (for external debugging)
export { AVLogger } from './AVLogger';

// Types
export type {
  AVConnectionState,
  AVManagerConfig,
  DNDState,
  SignalHealth,
} from './core/types';
