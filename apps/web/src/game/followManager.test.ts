import { describe, it, expect } from 'vitest';
import { FollowManager } from './followManager';

describe('FollowManager', () => {
  it('start/stop follow toggles target', () => {
    const fm = new FollowManager(100);
    expect(fm.getTarget()).toBeNull();
    fm.startFollowing('u1');
    expect(fm.getTarget()).toBe('u1');
    fm.stop();
    expect(fm.getTarget()).toBeNull();
  });

  it('interpolates towards target while within cancel distance', () => {
    const fm = new FollowManager(100);
    fm.startFollowing('u1');
    const local = { x: 0, y: 0 };
    const targets = { u1: { x: 100, y: 0 } };
    const res = fm.update(local, targets);
    expect(res.following).toBe(true);
    expect(res.x).toBeGreaterThan(0);
  });

  it('cancels follow if target too far', () => {
    const fm = new FollowManager(10);
    fm.startFollowing('u1');
    const local = { x: 0, y: 0 };
    const targets = { u1: { x: 100, y: 0 } };
    const res = fm.update(local, targets);
    expect(res.following).toBe(false);
    expect(fm.getTarget()).toBeNull();
  });
});
