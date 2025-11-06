import Phaser from 'phaser';

export function ensureRecenterUi(scene: Phaser.Scene & any): void {
  if (scene.recenterUi && scene.recenterUi.scene) return;
  const container = scene.add.container(0, 0);
  container.setDepth(1000);
  container.setScrollFactor(0);

  const bg = scene.add.rectangle(0, 0, 120, 28, 0x111114, 0.9);
  bg.setStrokeStyle(1, 0xffffff, 0.12);
  bg.setOrigin(0, 0);
  bg.setScrollFactor(0);

  const label = scene.add.text(10, 6, (window as any).i18next?.t?.('av.recenter') || 'Recenter', {
    fontSize: '13px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: '#ffffff'
  });
  label.setScrollFactor(0);

  container.add(bg);
  container.add(label);
  container.setPosition(12, 12);

  container.setSize(120, 28);
  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, 120, 28), Phaser.Geom.Rectangle.Contains);
  container.on(Phaser.Input.Events.POINTER_DOWN, () => {
    scene.cameras.main.startFollow(scene.hero, true, 0.1, 0.1);
    scene.manualCameraActive = false;
    updateRecenterUiVisibility(scene);
  });

  scene.recenterUi = container;
  scene.recenterUi.setVisible(false);
}

export function updateRecenterUiVisibility(scene: Phaser.Scene & any): void {
  if (!scene.recenterUi) return;
  const cam = scene.cameras.main;
  const isFollowing = (cam as any).follow === scene.hero;
  if (!scene.manualCameraActive && isFollowing) {
    scene.recenterUi.setVisible(false);
    try { scene.gameBridge.onCameraManualChange?.(false); } catch {}
    return;
  }
  const centerX = cam.worldView.centerX;
  const centerY = cam.worldView.centerY;
  const dx = Math.abs(scene.hero.x - centerX);
  const dy = Math.abs(scene.hero.y - centerY);
  const tolerance = 8;
  const shouldShow = scene.manualCameraActive || dx > tolerance || dy > tolerance;
  scene.recenterUi.setVisible(shouldShow);
  try { scene.gameBridge.onCameraManualChange?.(shouldShow); } catch {}
}

export function recenterCamera(scene: Phaser.Scene & any): void {
  scene.cameras.main.startFollow(scene.hero, true, 0.1, 0.1);
  scene.manualCameraActive = false;
  updateRecenterUiVisibility(scene);
}


