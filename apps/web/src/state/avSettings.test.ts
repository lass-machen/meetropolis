import { describe, expect, it, beforeEach } from 'vitest';
import { useAvSettingsStore } from './avSettings';

describe('avSettings store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAvSettingsStore.getState().reset();
  });

  it('defaults stopMicOnMute to true (hard-close mic on mute/DND by default)', () => {
    expect(useAvSettingsStore.getState().settings.stopMicOnMute).toBe(true);
  });

  it('setSetting updates and persists stopMicOnMute', () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);

    expect(useAvSettingsStore.getState().settings.stopMicOnMute).toBe(false);
    const persisted = JSON.parse(window.localStorage.getItem('meetropolis.av.settings.v1') || '{}');
    expect(persisted.stopMicOnMute).toBe(false);
  });

  it('reset() restores stopMicOnMute to the default (true)', () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
    useAvSettingsStore.getState().reset();

    expect(useAvSettingsStore.getState().settings.stopMicOnMute).toBe(true);
  });

  it('applyPreset does not change stopMicOnMute (device-scoped preference, not a preset concern)', () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
    useAvSettingsStore.getState().applyPreset('studio');

    expect(useAvSettingsStore.getState().settings.stopMicOnMute).toBe(false);
  });
});
