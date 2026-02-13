import Phaser from 'phaser';

export function createNameLabel(
  scene: Phaser.Scene & any,
  name: string,
  playerId?: string,
  isNpc?: boolean
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);

  const bg = scene.add.graphics();
  const paddingX = 10;
  const paddingY = 6;
  const textStyle = {
    fontSize: '16px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#ffffff',
    fontStyle: 'normal',
    fontWeight: '500'
  } as const;
  const text = scene.add.text(0, 0, name, textStyle as any);
  try { (text as any).setResolution?.((window as any).devicePixelRatio || 2); } catch {}
  try { (text as any).setPadding?.(0, 0, 0, 1); } catch {}
  text.setOrigin(0.5, 0.5);

  let badgeText: Phaser.GameObjects.Text | null = null;
  if (isNpc) {
    const badgeStyle = {
      fontSize: '10px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#a78bfa',
      fontStyle: 'bold',
    } as const;
    badgeText = scene.add.text(0, 0, 'BOT', badgeStyle as any);
    try { (badgeText as any).setResolution?.((window as any).devicePixelRatio || 2); } catch {}
    badgeText!.setOrigin(0.5, 0.5);
  }

  const badgeWidth = badgeText ? (badgeText as any).width + 8 : 0;
  const width = (text as any).width + paddingX * 2 + badgeWidth;
  const height = (text as any).height + paddingY * 2;

  if (badgeText) {
    const totalContentWidth = (text as any).width + badgeWidth;
    text.setX(-totalContentWidth / 2 + (text as any).width / 2);
    badgeText.setX(-totalContentWidth / 2 + (text as any).width + 4 + (badgeText as any).width / 2);
  }

  (container as any).bg = bg;
  (container as any).text = text;
  (container as any).playerId = playerId;
  (container as any).isNpc = !!isNpc;
  (container as any).width = width;
  (container as any).height = height;
  (container as any).paddingX = paddingX;
  (container as any).paddingY = paddingY;

  drawNameLabel(scene, container, false);

  container.add(bg);
  container.add(text);
  if (badgeText) container.add(badgeText);
  container.setDepth(12);
  try { scene.labelLayer?.add(container); } catch {}

  return container;
}

export function drawNameLabel(
  _scene: Phaser.Scene & any,
  container: Phaser.GameObjects.Container,
  isSpeaking: boolean
): void {
  const bg = (container as any).bg as Phaser.GameObjects.Graphics;
  const width = (container as any).width;
  const height = (container as any).height;

  bg.clear();

  if (isSpeaking) {
    const w = Math.round(width);
    const h = Math.round(height);
    const rx = -Math.floor(w / 2);
    const ry = -Math.floor(h / 2);
    bg.fillStyle(0x111114, 0.85);
    bg.fillRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    bg.lineStyle(1, 0x22d3ee, 1);
    bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    bg.lineStyle(2, 0x22d3ee, 0.3);
    bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    bg.lineStyle(3, 0x22d3ee, 0.15);
    bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
  } else {
    const w = Math.round(width);
    const h = Math.round(height);
    const rx = -Math.floor(w / 2);
    const ry = -Math.floor(h / 2);
    bg.fillStyle(0x111114, 0.75);
    bg.fillRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    bg.lineStyle(1, 0xffffff, 0.1);
    bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
  }
}

export function updateNameLabel(
  scene: Phaser.Scene & any,
  container: Phaser.GameObjects.Container,
  x: number,
  y: number
): void {
  // Labels sind in einem separaten Layer mit eigener Kamera (labelCamera),
  // die NICHT scrollt (setScroll(0,0)). Daher müssen wir Bildschirmkoordinaten berechnen.
  const cam = scene.cameras.main;
  const view = cam.worldView;
  // Berechne Bildschirmposition: Weltkoordinaten -> Bildschirmkoordinaten
  const screenX = (x - view.x) * cam.zoom;
  const screenY = (y - view.y) * cam.zoom;
  // Avatar-Höhe und Abstand zum Label (in Weltpixeln, dann mit Zoom skaliert)
  const avatarWorldHeight = 24;
  const baseGap = 8;
  const offsetY = (avatarWorldHeight / 2 + baseGap) * cam.zoom;
  // Label bleibt in fester Größe, nur Position wird angepasst
  container.setPosition(Math.round(screenX), Math.round(screenY - offsetY));
}

export function setHeroName(scene: Phaser.Scene & any, name: string): void {
  if (scene.heroNameLabel) {
    try { scene.heroNameLabel.destroy(); } catch {}
  }
  scene.heroNameLabel = createNameLabel(scene, name, 'local');
  if (scene.hero) updateNameLabel(scene, scene.heroNameLabel, scene.hero.x, scene.hero.y);
}

export function updateSpeakingStates(scene: Phaser.Scene & any, speakingIds: Set<string>): void {
  scene.nameLabels?.forEach((label: Phaser.GameObjects.Container, id: string) => {
    const isSpeaking = speakingIds.has(id);
    drawNameLabel(scene, label, isSpeaking);
  });
  if (scene.heroNameLabel && speakingIds.has('local')) {
    drawNameLabel(scene, scene.heroNameLabel, true);
  } else if (scene.heroNameLabel) {
    drawNameLabel(scene, scene.heroNameLabel, false);
  }
}


