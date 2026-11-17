import { describe, expect, it } from 'vitest';
import { ASSET_PROTOCOL_HEADER } from '@meetropolis/shared';
import { ALLOWED_REQUEST_HEADERS } from './originPolicy.js';

describe('ALLOWED_REQUEST_HEADERS', () => {
  it('lets a cross-origin request announce the asset protocol', () => {
    const allowed = ALLOWED_REQUEST_HEADERS.split(',').map((header) => header.trim().toLowerCase());
    expect(allowed).toContain(ASSET_PROTOCOL_HEADER.toLowerCase());
  });
});
