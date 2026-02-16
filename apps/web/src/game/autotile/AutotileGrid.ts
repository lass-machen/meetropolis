/**
 * AutotileGrid — Sparse grid data structure for autotile wall data.
 * Maps (x, y) positions to wall type IDs.
 * Implements AutotileGridLike for use with autotileEngine.
 */

import type { AutotileGridLike } from './autotileEngine';

export class AutotileGrid implements AutotileGridLike {
  private data: Map<string, number> = new Map();

  private key(x: number, y: number): string {
    return `${x}:${y}`;
  }

  get(x: number, y: number): number {
    return this.data.get(this.key(x, y)) ?? 0;
  }

  set(x: number, y: number, wallTypeId: number): void {
    if (wallTypeId === 0) {
      this.data.delete(this.key(x, y));
    } else {
      this.data.set(this.key(x, y), wallTypeId);
    }
  }

  has(x: number, y: number): boolean {
    return this.data.has(this.key(x, y));
  }

  remove(x: number, y: number): void {
    this.data.delete(this.key(x, y));
  }

  clear(): void {
    this.data.clear();
  }

  get size(): number {
    return this.data.size;
  }

  /** Iterate over all non-empty tiles */
  entries(): IterableIterator<[string, number]> {
    return this.data.entries();
  }
}
