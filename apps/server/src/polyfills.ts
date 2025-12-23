// Polyfill Symbol.metadata for @colyseus/schema v3.x ES decorators
// This must be imported FIRST in index.ts before any other imports
(Symbol as unknown as { metadata?: symbol }).metadata ??= Symbol('Symbol.metadata');
