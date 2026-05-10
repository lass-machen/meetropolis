import Phaser from 'phaser';
import { V2State, computeFirstGids } from '../../../lib/mapV2';
import { useCameraSettingsStore } from '../../../state/cameraSettings';
import type { MainSceneLike } from '../../types/scene';

export class SceneInitializer {
  static initializeMap(scene: MainSceneLike): {
    mapRef: Phaser.Tilemaps.Tilemap;
    editorGround: Phaser.Tilemaps.TilemapLayer;
    wallsLayer: Phaser.Tilemaps.TilemapLayer;
    collisionLayer: Phaser.Tilemaps.TilemapLayer;
    dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
    v2: { state: V2State; firstGids: number[]; chunkSize: number };
  } {
    const pre = (window as any).__v2_state as V2State | undefined;
    if (!pre || !pre.mapMeta.width) throw new Error('Missing V2 state in MainScene');

    const tilemapConfig: Phaser.Types.Tilemaps.TilemapConfig = {};
    if (pre.mapMeta.width != null) tilemapConfig.width = pre.mapMeta.width;
    if (pre.mapMeta.height != null) tilemapConfig.height = pre.mapMeta.height;
    if (pre.mapMeta.tileWidth != null) tilemapConfig.tileWidth = pre.mapMeta.tileWidth;
    if (pre.mapMeta.tileHeight != null) tilemapConfig.tileHeight = pre.mapMeta.tileHeight;
    const map = scene.make.tilemap(tilemapConfig);

    // Compute firstGids based on texture dimensions BEFORE registering tilesets,
    // so we can pass them explicitly to addTilesetImage for GID alignment.
    const firstGids = computeFirstGids(pre.tilesetRegistry, scene);

    const sorted = [...pre.tilesetRegistry].sort((a, b) => a.slot - b.slot);
    const dynamicTilesets = new Map<string, Phaser.Tilemaps.Tileset>();
    for (const ts of sorted) {
      try {
        const fg = firstGids[ts.slot];
        const phTs = map.addTilesetImage(
          ts.key,
          ts.key,
          ts.tileWidth,
          ts.tileHeight,
          ts.margin ?? 0,
          ts.spacing ?? 0,
          fg,
        );
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
      pre.mapMeta.width ?? undefined,
      pre.mapMeta.height ?? undefined,
      pre.mapMeta.tileWidth ?? undefined,
      pre.mapMeta.tileHeight ?? undefined,
    ) as any;
    const wallsLayer = map.createBlankLayer(
      'Walls',
      tilesets,
      0,
      0,
      pre.mapMeta.width ?? undefined,
      pre.mapMeta.height ?? undefined,
      pre.mapMeta.tileWidth ?? undefined,
      pre.mapMeta.tileHeight ?? undefined,
    ) as any;
    const collisionLayer = map.createBlankLayer(
      'Collision',
      tilesets,
      0,
      0,
      pre.mapMeta.width ?? undefined,
      pre.mapMeta.height ?? undefined,
      pre.mapMeta.tileWidth ?? undefined,
      pre.mapMeta.tileHeight ?? undefined,
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

  static initializeCamera(
    scene: MainSceneLike,
    mapRef: Phaser.Tilemaps.Tilemap,
  ): {
    labelCamera: Phaser.Cameras.Scene2D.Camera;
    labelLayer: Phaser.GameObjects.Layer;
  } {
    // Clean up stale label state from previous scene run (Phaser reuses scene instances)
    const staleLayer = scene.labelLayer ?? undefined;
    const staleCam = scene.labelCamera ?? undefined;
    if (staleCam) {
      try {
        scene.cameras.remove(staleCam, true);
      } catch {
        /* already destroyed */
      }
    }
    if (staleLayer) {
      try {
        staleLayer.destroy();
      } catch {
        /* already destroyed */
      }
    }
    scene.labelLayer = null;
    scene.labelCamera = null;

    const cam = scene.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);
    cam.setBounds(0, 0, mapRef.widthInPixels, mapRef.heightInPixels);

    // Apply center-camera setting
    const cameraSettings = useCameraSettingsStore.getState().settings;
    if (cameraSettings.centerCamera) {
      cam.removeBounds();
    }

    const labelLayer = scene.add.layer();
    labelLayer.setDepth(10000);
    cam.ignore(labelLayer);

    const labelCam = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
    labelCam.setZoom(1);
    labelCam.setScroll(0, 0);
    labelCam.setRoundPixels(true);

    const refreshLabelCamIgnore = () => {
      if (!labelCam || !labelLayer) return;
      const labelMembers = new Set(labelLayer.list);
      labelMembers.add(labelLayer);
      const toIgnore = scene.children.list.filter((o) => !labelMembers.has(o));
      labelCam.ignore(toIgnore);
    };

    refreshLabelCamIgnore();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, refreshLabelCamIgnore);

    const onResize = () => {
      const cs = useCameraSettingsStore.getState().settings;
      if (!cs.centerCamera) {
        cam.setBounds(0, 0, mapRef.widthInPixels, mapRef.heightInPixels);
      }
      if (labelCam) labelCam.setSize(scene.scale.width, scene.scale.height);
    };
    scene.scale.on('resize', onResize);

    const unsubCameraSettings = useCameraSettingsStore.subscribe((state) => {
      if (state.settings.centerCamera) {
        cam.removeBounds();
      } else {
        cam.setBounds(0, 0, mapRef.widthInPixels, mapRef.heightInPixels);
      }
    });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubCameraSettings();
      // Remove POST_UPDATE listener
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, refreshLabelCamIgnore);
      // Remove scale resize listener (game-level, not cleaned up by scene shutdown)
      scene.scale.off('resize', onResize);
      // Destroy label camera
      try {
        scene.cameras.remove(labelCam, true);
      } catch {
        /* noop */
      }
      // Destroy label layer (and its children)
      try {
        labelLayer.destroy();
      } catch {
        /* noop */
      }
      // Clear references on scene instance
      scene.labelLayer = null;
      scene.labelCamera = null;
    });

    // Store references on scene instance for defensive cleanup on next run
    scene.labelLayer = labelLayer;
    scene.labelCamera = labelCam;

    return { labelCamera: labelCam, labelLayer };
  }
}
