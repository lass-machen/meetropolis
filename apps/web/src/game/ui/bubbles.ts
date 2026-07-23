import Phaser from 'phaser';
import type { MainSceneLike } from '../types/scene';

// Visual bubble rendering only. The AV layer is fed separately with LiveKit
// identities (realtime/handlers/bubbleHandlers.ts); the Colyseus session ids
// plus '__local__' used here must never cross into the AV domain.
export function setBubbleMembers(scene: MainSceneLike, members: Set<string>): void {
  for (const outline of (scene.bubbleOutlines?.values?.() || []) as Iterable<Phaser.GameObjects.Graphics>) {
    try {
      outline.destroy();
    } catch {}
  }
  try {
    scene.bubbleOutlines?.clear?.();
  } catch {}

  for (const id of members) {
    const sprite = scene.remotes?.get?.(id);
    if (sprite) {
      const g = scene.add.graphics();
      g.setDepth(9);
      scene.bubbleOutlines.set(id, g);
      const updateFunc = () => {
        if (scene.bubbleOutlines.has(id)) {
          updateBubbleOutline(scene, id, sprite);
        }
      };
      scene.time.addEvent({ delay: 50, callback: updateFunc, loop: true });
    }
  }

  if (members.has('__local__') && scene.hero) {
    const g = scene.add.graphics();
    g.setDepth(9);
    scene.bubbleOutlines.set('local', g);
    const localHero = scene.hero;
    const updateFunc = () => {
      if (scene.bubbleOutlines.has('local')) {
        updateBubbleOutline(scene, 'local', localHero);
      }
    };
    scene.time.addEvent({ delay: 50, callback: updateFunc, loop: true });
  }
}

export function updateBubbleOutline(scene: MainSceneLike, id: string, sprite: Phaser.GameObjects.Sprite): void {
  const g = scene.bubbleOutlines.get(id);
  if (!g) return;
  // Follow the avatar's y-sort depth so the ring sorts with its actor (Strang C).
  // Set here, in the 50 ms outline update, so it never lags behind the sprite's
  // per-frame depth. Just under the actor so the avatar renders over its ring.
  g.setDepth(sprite.depth - 1);
  g.clear();
  const x = sprite.x;
  const y = sprite.y;
  const radius = 20;
  const color = 0x00ffff;
  const alpha = 0.25;
  g.lineStyle(2, color, 0.9);
  g.strokeCircle(x, y, radius);
  g.fillStyle(color, alpha);
  g.fillCircle(x, y, radius);
}
