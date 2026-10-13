import { describe, expect, it } from 'vitest';
import { readLoginNextParam, resolvePostLoginHash } from './resolvePostLoginHash';

describe('resolvePostLoginHash', () => {
  it('keeps a bare connect hash', () => {
    expect(resolvePostLoginHash('#/connect')).toBe('#/connect');
  });

  it('keeps a connect hash with a request query', () => {
    expect(resolvePostLoginHash('#/connect?request=abc_-1')).toBe('#/connect?request=abc_-1');
  });

  it('falls back for null', () => {
    expect(resolvePostLoginHash(null)).toBe('#/app');
  });

  it('falls back for the world hash', () => {
    expect(resolvePostLoginHash('#/app')).toBe('#/app');
  });

  it('falls back for a connect prefix that is a different route', () => {
    expect(resolvePostLoginHash('#/connectx')).toBe('#/app');
  });

  it('falls back for a path traversal lookalike', () => {
    expect(resolvePostLoginHash('#/connect/../app')).toBe('#/app');
  });

  it('falls back for an absolute https URL', () => {
    expect(resolvePostLoginHash('https://evil.example')).toBe('#/app');
  });

  it('falls back for a protocol-relative URL', () => {
    expect(resolvePostLoginHash('//evil.example')).toBe('#/app');
  });

  it('falls back for a javascript URL', () => {
    expect(resolvePostLoginHash('javascript:alert(1)')).toBe('#/app');
  });

  it('falls back when the query contains disallowed characters', () => {
    expect(resolvePostLoginHash('#/connect?request=<script>')).toBe('#/app');
  });
});

describe('readLoginNextParam', () => {
  it('returns the decoded next value from a login hash', () => {
    const encoded = encodeURIComponent('#/connect?request=abc_-1');
    expect(readLoginNextParam(`#/login?next=${encoded}`)).toBe('#/connect?request=abc_-1');
  });

  it('returns null when next is absent', () => {
    expect(readLoginNextParam('#/login')).toBeNull();
  });

  it('returns null on a non-login hash', () => {
    expect(readLoginNextParam('#/register?next=%23%2Fconnect')).toBeNull();
  });
});
