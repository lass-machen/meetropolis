import Phaser from 'phaser';
import { emitBubbleMembers } from '../../lib/avEvents';

export function setBubbleMembers(scene: Phaser.Scene & any, members: Set<string>): void {
  try {
    emitBubbleMembers(Array.from(members));
  } catch {}

  for (const outline of (scene.bubbleOutlines?.values?.() || []) as Iterable<Phaser.GameObjects.Graphics>) {
    try { outline.destroy(); } catch {}
  }
  try { scene.bubbleOutlines?.clear?.(); } catch {}

  for (const id of members) {
    const sprite = scene.remotes?.get?.(id) as Phaser.GameObjects.Sprite | undefined;
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

  if (members.has('__local__')) {
    const g = scene.add.graphics();
    g.setDepth(9);
    scene.bubbleOutlines.set('local', g);
    const updateFunc = () => {
      if (scene.bubbleOutlines.has('local')) {
        updateBubbleOutline(scene, 'local', scene.hero);
      }
    };
    scene.time.addEvent({ delay: 50, callback: updateFunc, loop: true });
  }
}

export function updateBubbleOutline(
  scene: Phaser.Scene & any,
  id: string,
  sprite: Phaser.GameObjects.Sprite
): void {
  const g = scene.bubbleOutlines.get(id) as Phaser.GameObjects.Graphics | undefined;
  if (!g) return;
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


