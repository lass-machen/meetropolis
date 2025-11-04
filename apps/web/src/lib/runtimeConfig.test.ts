import { describe, it, expect } from 'vitest';
import { getApiBaseFromWindow } from './runtimeConfig';

describe('getApiBaseFromWindow', () => {
  it('prefers query parameter', () => {
    const old = (global as any).window;
    (global as any).window = { location: { search: '?apiBase=https://x.example.com', protocol: 'https:', hostname: 'foo' } } as any;
    expect(getApiBaseFromWindow()).toBe('https://x.example.com');
    (global as any).window = old;
  });

  it('falls back to VITE env then host', () => {
    const old = (global as any).window;
    (global as any).window = { location: { search: '', protocol: 'http:', hostname: 'bar' } } as any;
    (import.meta as any).env = { VITE_API_BASE: '' } as any;
    expect(getApiBaseFromWindow()).toBe('http://bar:2567');
    (global as any).window = old;
  });
});


