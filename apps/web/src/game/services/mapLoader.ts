import type Phaser from 'phaser';

export type MapLoaderOptions = {
  mapName: string;
};

export function loadMap(scene: Phaser.Scene, options: MapLoaderOptions): void {
  // Platzhalter: tatsächliche Map-/Layer-Lade-Logik wird aus MainScene migriert
  void options;
  void scene;
}
