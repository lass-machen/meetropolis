import { describe, expect, it } from 'vitest';
import { createSharedPlanResolver } from './sharedPlanResolver.js';

describe('createSharedPlanResolver', () => {
  it('creates the resolver once, also for concurrent first calls, and returns the same instance', async () => {
    let created = 0;
    const shared = createSharedPlanResolver(
      async (dir: string) => {
        created += 1;
        return { dir };
      },
      () => undefined,
    );
    const [first, second] = await Promise.all([shared('/journal'), shared('/journal')]);
    const third = await shared('/journal');
    expect(created).toBe(1);
    expect(first).toBe(second);
    expect(third).toBe(first);
  });

  it('refuses a second, different journal directory', async () => {
    let created = 0;
    const shared = createSharedPlanResolver(
      async (dir: string) => {
        created += 1;
        return { dir };
      },
      () => undefined,
    );
    const first = await shared('/journal');
    expect(await shared('/other')).toBeUndefined();
    expect(await shared('/journal')).toBe(first);
    expect(created).toBe(1);
  });

  it('forgets a failed creation and retries on the next call', async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const shared = createSharedPlanResolver(
      async (dir: string) => {
        attempts += 1;
        if (attempts === 1) throw new Error('journal unavailable');
        return { dir };
      },
      (error) => errors.push(error),
    );
    expect(await shared('/journal')).toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(await shared('/journal')).toEqual({ dir: '/journal' });
    expect(attempts).toBe(2);
  });
});
