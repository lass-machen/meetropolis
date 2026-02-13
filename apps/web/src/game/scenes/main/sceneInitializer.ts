import Phaser from 'phaser';
import { V2State, computeFirstGids } from '../../../lib/mapV2';

export class SceneInitializer {
  static initializeMap(scene: Phaser.Scene): {
    mapRef: Phaser.Tilemaps.Tilemap;
    editorGround: Phaser.Tilemaps.TilemapLayer;
    wallsLayer: Phaser.Tilemaps.TilemapLayer;
    collisionLayer: Phaser.Tilemaps.TilemapLayer;
    dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
    v2: { state: V2State; firstGids: number[]; chunkSize: number };
  } {
    const pre = (window as any).__v2_state as V2State | undefined;
    if (!pre || !pre.mapMeta.width) throw new Error('Missing V2 state in MainScene');

    const map = scene.make.tilemap({
      width: pre.mapMeta.width,
      height: pre.mapMeta.height,
      tileWidth: pre.mapMeta.tileWidth,
      tileHeight: pre.mapMeta.tileHeight,
    });

    // Compute firstGids based on texture dimensions BEFORE registering tilesets,
    // so we can pass them explicitly to addTilesetImage for GID alignment.
    const firstGids = computeFirstGids(pre.tilesetRegistry, scene);

    const sorted = [...pre.tilesetRegistry].sort((a, b) => a.slot - b.slot);
    const dynamicTilesets = new Map<string, Phaser.Tilemaps.Tileset>();
    for (const ts of sorted) {
      try {
        const fg = firstGids[ts.slot];
        const phTs = map.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0, fg);
        if (phTs) dynamicTilesets.set(ts.key, phTs);
      } catch {}
    }

    const allTs = Array.from(dynamicTilesets.values());
    const tilesets = allTs.length > 0 ? allTs : [undefined as any];
    const editorGround = map.createBlankLayer(
      'Ground',
      tilesets,
      0,
      0,
      pre.mapMeta.width,
      pre.mapMeta.height,
      pre.mapMeta.tileWidth,
      pre.mapMeta.tileHeight
    ) as any;
    const wallsLayer = map.createBlankLayer(
      'Walls',
      tilesets,
      0,
      0,
      pre.mapMeta.width,
      pre.mapMeta.height,
      pre.mapMeta.tileWidth,
      pre.mapMeta.tileHeight
    ) as any;
    const collisionLayer = map.createBlankLayer(
      'Collision',
      tilesets,
      0,
      0,
      pre.mapMeta.width,
      pre.mapMeta.height,
      pre.mapMeta.tileWidth,
      pre.mapMeta.tileHeight
    ) as any;

    editorGround?.setDepth(0);
    wallsLayer?.setDepth(5);
    collisionLayer?.setDepth(10);

    try {
      collisionLayer?.setVisible(false);
    } catch {}
    try {
      collisionLayer?.setCollisionByExclusion([-1], true);
    } catch {}

    const v2 = { state: pre, firstGids, chunkSize: pre.mapMeta.chunkSize };

    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);
    if (collision) dynamicTilesets.set('collision_tiles', collision);

    scene.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    return { mapRef: map, editorGround, wallsLayer, collisionLayer, dynamicTilesets, v2 };
  }

  static initializeCamera(scene: Phaser.Scene, mapRef: Phaser.Tilemaps.Tilemap): {
    labelCamera: Phaser.Cameras.Scene2D.Camera;
    labelLayer: Phaser.GameObjects.Layer;
  } {
    const cam = scene.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);
    cam.setBounds(0, 0, mapRef.widthInPixels, mapRef.heightInPixels);

    const labelLayer = scene.add.layer();
    labelLayer.setDepth(10000);
    cam.ignore(labelLayer);

    const labelCam = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
    labelCam.setZoom(1);
    labelCam.setScroll(0, 0);
    labelCam.setRoundPixels(true);

    const refreshLabelCamIgnore = () => {
      if (!labelCam || !labelLayer) return;
      const labelMembers = new Set(labelLayer.list as Phaser.GameObjects.GameObject[]);
      labelMembers.add(labelLayer as unknown as Phaser.GameObjects.GameObject);
      const toIgnore = scene.children.list.filter((o) => !labelMembers.has(o as Phaser.GameObjects.GameObject));
      labelCam.ignore(toIgnore as any);
    };

    refreshLabelCamIgnore();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, refreshLabelCamIgnore);

    scene.scale.on('resize', () => {
      cam.setBounds(0, 0, mapRef.widthInPixels, mapRef.heightInPixels);
      if (labelCam) labelCam.setSize(scene.scale.width, scene.scale.height);
    });

    return { labelCamera: labelCam, labelLayer };
  }
}
