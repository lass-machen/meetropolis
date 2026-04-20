import { describe, it, expect, beforeEach } from 'vitest';
import { isDesktopRuntime, loadMetaPixel } from './metaPixel';

describe('metaPixel', () => {
  beforeEach(() => {
    delete (window as unknown as { fbq?: unknown }).fbq;
    delete (window as unknown as { _fbq?: unknown })._fbq;
    delete (window as unknown as { __META_PIXEL_LOADED__?: unknown }).__META_PIXEL_LOADED__;
    delete (window as unknown as { __MEETROPOLIS_API_BASE__?: unknown }).__MEETROPOLIS_API_BASE__;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    const existing = document.getElementById('meta-pixel-noscript');
    existing?.parentNode?.removeChild(existing);
    // Remove any injected fbevents.js scripts.
    Array.from(document.querySelectorAll('script[src*="fbevents.js"]')).forEach((s) =>
      s.parentNode?.removeChild(s),
    );
  });

  it('isDesktopRuntime detects __MEETROPOLIS_API_BASE__', () => {
    (window as unknown as { __MEETROPOLIS_API_BASE__?: string }).__MEETROPOLIS_API_BASE__ =
      'http://desktop.local:2567';
    expect(isDesktopRuntime()).toBe(true);
  });

  it('isDesktopRuntime detects __TAURI__', () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { tauri: true };
    expect(isDesktopRuntime()).toBe(true);
  });

  it('isDesktopRuntime returns false for browser', () => {
    expect(isDesktopRuntime()).toBe(false);
  });

  it('loadMetaPixel injects script + noscript and sets loaded flag', () => {
    loadMetaPixel('1234567890');
    const scripts = Array.from(document.querySelectorAll('script[src*="fbevents.js"]'));
    expect(scripts.length).toBe(1);
    expect(document.getElementById('meta-pixel-noscript')).toBeTruthy();
    expect(
      (window as unknown as { __META_PIXEL_LOADED__?: boolean }).__META_PIXEL_LOADED__,
    ).toBe(true);
    expect(typeof (window as unknown as { fbq?: unknown }).fbq).toBe('function');
  });

  it('loadMetaPixel is idempotent', () => {
    loadMetaPixel('1234567890');
    loadMetaPixel('1234567890');
    const scripts = Array.from(document.querySelectorAll('script[src*="fbevents.js"]'));
    expect(scripts.length).toBe(1);
  });

  it('loadMetaPixel does nothing for empty pixel id', () => {
    loadMetaPixel('');
    expect((window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
    expect(document.getElementById('meta-pixel-noscript')).toBeFalsy();
  });
});
