import Phaser from 'phaser';

/** Monotonic counter used for unique texture keys. */
let labelTexId = 0;

export function createNameLabel(
  scene: Phaser.Scene & any,
  name: string,
  playerId?: string,
  isNpc?: boolean
): Phaser.GameObjects.Container {
  const container = scene.add.container(0, 0);

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
  const dpr = window.devicePixelRatio || 1;
  try { (text as any).setResolution?.(dpr); } catch { /* noop */ }
  try { (text as any).setPadding?.(0, 0, 0, 1); } catch { /* noop */ }
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
    try { (badgeText as any).setResolution?.(dpr); } catch { /* noop */ }
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

  (container as any).text = text;
  (container as any).playerId = playerId;
  (container as any).isNpc = !!isNpc;
  (container as any).width = width;
  (container as any).height = height;
  (container as any).paddingX = paddingX;
  (container as any).paddingY = paddingY;

  // Create high-DPI background sprite (inserted at index 0, behind text)
  const bgSprite = renderBgTexture(scene, container, false);
  container.add(bgSprite);
  container.add(text);
  if (badgeText) container.add(badgeText);
  container.setDepth(12);
  try { scene.labelLayer?.add(container); } catch { /* noop */ }

  return container;
}

/**
 * Render the label background into a high-DPI texture and return an Image.
 * The Graphics object is drawn at DPR-scaled resolution, captured via
 * `generateTexture`, then displayed at 1/DPR scale so it appears pixel-
 * perfect on Retina displays.
 */
function renderBgTexture(
  scene: Phaser.Scene & any,
  container: Phaser.GameObjects.Container,
  isSpeaking: boolean
): Phaser.GameObjects.Image {
  const dpr = window.devicePixelRatio || 1;
  const width = (container as any).width as number;
  const height = (container as any).height as number;

  const w = Math.round(width);
  const h = Math.round(height);
  const sw = Math.ceil(w * dpr);
  const sh = Math.ceil(h * dpr);
  const radius = Math.floor(h / 2);
  const sRadius = Math.floor(radius * dpr);

  // Draw into a temporary Graphics at DPR scale (origin at 0,0)
  const gfx = scene.add.graphics();

  if (isSpeaking) {
    gfx.fillStyle(0x111114, 0.85);
    gfx.fillRoundedRect(0, 0, sw, sh, sRadius);
    gfx.lineStyle(Math.max(1, Math.round(1 * dpr)), 0x22d3ee, 1);
    gfx.strokeRoundedRect(0, 0, sw, sh, sRadius);
    gfx.lineStyle(Math.max(1, Math.round(2 * dpr)), 0x22d3ee, 0.3);
    gfx.strokeRoundedRect(0, 0, sw, sh, sRadius);
    gfx.lineStyle(Math.max(1, Math.round(3 * dpr)), 0x22d3ee, 0.15);
    gfx.strokeRoundedRect(0, 0, sw, sh, sRadius);
  } else {
    gfx.fillStyle(0x111114, 0.75);
    gfx.fillRoundedRect(0, 0, sw, sh, sRadius);
    gfx.lineStyle(Math.max(1, Math.round(1 * dpr)), 0xffffff, 0.1);
    gfx.strokeRoundedRect(0, 0, sw, sh, sRadius);
  }

  // Remove old texture if it exists
  const prevKey = (container as any).bgTexKey as string | undefined;
  if (prevKey && scene.textures.exists(prevKey)) {
    scene.textures.remove(prevKey);
  }

  const texKey = `nlbl_${++labelTexId}`;
  gfx.generateTexture(texKey, sw, sh);
  gfx.destroy();

  (container as any).bgTexKey = texKey;

  // Reuse existing bgSprite or create a new one
  let bgSprite = (container as any).bgSprite as Phaser.GameObjects.Image | undefined;
  if (bgSprite) {
    bgSprite.setTexture(texKey);
  } else {
    bgSprite = scene.add.image(0, 0, texKey);
    (container as any).bgSprite = bgSprite;
  }

  bgSprite!.setOrigin(0.5, 0.5);
  bgSprite!.setScale(1 / dpr);

  return bgSprite!;
}

export function drawNameLabel(
  scene: Phaser.Scene & any,
  container: Phaser.GameObjects.Container,
  isSpeaking: boolean
): void {
  const bgSprite = renderBgTexture(scene, container, isSpeaking);

  // Ensure the bgSprite is in the container at index 0 (behind text)
  if (container.getIndex(bgSprite) === -1) {
    container.addAt(bgSprite, 0);
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


