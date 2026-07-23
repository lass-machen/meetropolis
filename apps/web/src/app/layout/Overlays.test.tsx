import { describe, it, expect } from 'vitest';
import { isFullscreenOverlayOpen } from './Overlays';

/**
 * The world view hides its banner row for exactly as long as this predicate is
 * true (see WorldMainView), so the two must agree on every input — a second,
 * hand-written copy of the condition is what these cases exist to prevent.
 */
describe('isFullscreenOverlayOpen', () => {
  const base = { editorActive: false, avDnd: false, selectedSid: null as string | null };

  it('is open when a participant is selected', () => {
    expect(isFullscreenOverlayOpen({ ...base, selectedSid: 'sid-1' })).toBe(true);
  });

  it('is closed without a selection', () => {
    expect(isFullscreenOverlayOpen(base)).toBe(false);
  });

  it('is closed in the editor, even with a selection', () => {
    expect(isFullscreenOverlayOpen({ ...base, selectedSid: 'sid-1', editorActive: true })).toBe(false);
  });

  it('is closed while do-not-disturb is on', () => {
    expect(isFullscreenOverlayOpen({ ...base, selectedSid: 'sid-1', avDnd: true })).toBe(false);
  });

  it('treats an empty selection id as no selection', () => {
    expect(isFullscreenOverlayOpen({ ...base, selectedSid: '' })).toBe(false);
  });
});
