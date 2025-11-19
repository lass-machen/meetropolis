import Phaser from 'phaser';

export function saveEditorLayers(scene: Phaser.Scene & any): void {
  // Deprecated: v2 uses direct server sync (paint-rect)
  void scene;
}

export function saveEditorLayersHard(scene: Phaser.Scene & any): void {
   saveEditorLayers(scene);
}

export function loadEditorLayers(scene: Phaser.Scene & any): void {
  // Deprecated: v2 uses serverSync/chunks
  void scene;
}

export function reloadEditorLayers(scene: Phaser.Scene & any): void {
  // Deprecated
  void scene;
}


