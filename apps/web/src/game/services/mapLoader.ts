import type Phaser from 'phaser';

export type MapLoaderOptions = {
  mapName: string;
};

export async function loadMap(scene: Phaser.Scene, options: MapLoaderOptions): Promise<void> {
  // Platzhalter: tatsächliche Map-/Layer-Lade-Logik wird aus MainScene migriert
  void options;
  void scene;
}


