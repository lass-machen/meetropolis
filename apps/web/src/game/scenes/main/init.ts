import Phaser from 'phaser';
import { V2State, computeFirstGids } from '../../../lib/mapV2';
import { editorLog, editorError } from '../../../lib/editorLog';

export function initMainScene(scene: Phaser.Scene & any): void {
  const pre = (window as any).__v2_state as V2State | undefined;
  if (pre && pre.mapMeta.width && pre.mapMeta.height && pre.mapMeta.tileWidth && pre.mapMeta.tileHeight) {
    const map = scene.make.tilemap({ width: pre.mapMeta.width, height: pre.mapMeta.height, tileWidth: pre.mapMeta.tileWidth, tileHeight: pre.mapMeta.tileHeight });
    scene.mapRef = map;
    for (const ts of pre.tilesetRegistry) {
      try {
        const phTs = map.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
        if (phTs) scene.dynamicTilesets.set(ts.key, phTs);
      } catch {}
    }
    const allTs = Array.from(scene.dynamicTilesets.values());
    scene.editorGround = map.createBlankLayer('Ground', allTs[0] || (undefined as any), 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
    scene.wallsLayer = map.createBlankLayer('Walls', allTs[0] || (undefined as any), 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
    scene.collisionLayer = map.createBlankLayer('Collision', allTs[0] || (undefined as any), 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
    scene.editorGround?.setDepth(0);
    scene.wallsLayer?.setDepth(5);
    scene.collisionLayer?.setDepth(10);
    try { scene.collisionLayer?.setVisible(false); } catch {}
    try { scene.collisionLayer?.setCollisionByExclusion([-1], true); } catch {}
    const firstGids = computeFirstGids(pre.tilesetRegistry, scene);
    scene.v2 = { state: pre, firstGids, chunkSize: pre.mapMeta.chunkSize };
    scene.loadVisibleChunks('ground');
    scene.loadVisibleChunks('walls');
    scene.loadVisibleChunks('collision');
  } else {
    throw new Error('Missing V2 state in initMainScene');
  }

  const map = scene.mapRef!;
  const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
  const furniture = map.addTilesetImage('furniture_tiles', 'furniture_tiles', 16, 16, 0, 0);
  const decor = map.addTilesetImage('decor_tiles', 'decor_tiles', 16, 16, 0, 0);
  const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);
  
  const uniq = new Map<string, Phaser.Tilemaps.Tileset>();
  ;[office, furniture, decor, collision].filter(Boolean).forEach((ts: any) => {
    if (!uniq.has(ts.name)) uniq.set(ts.name, ts);
  });
  const available = Array.from(uniq.values());
  const ground = scene.editorGround;
  const walls = scene.wallsLayer;
  ground?.setDepth(0);
  walls?.setDepth(5);

  let collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined;
  try {
    collisionLayer = scene.collisionLayer;
    if (collisionLayer) { try { (collisionLayer as any).setTilesets(available); } catch {} }
    
    const layerData = (collisionLayer as any)?.layer;
    if (layerData && layerData.data) {
      const expectedRows = map.height;
      const actualRows = layerData.data.length;
      if (actualRows < expectedRows) {
        editorLog('Init', `Collision layer has wrong dimensions: ${actualRows} rows instead of ${expectedRows}, fixing...`);
        while (layerData.data.length < expectedRows) {
          const newRow = new Array(map.width);
          for (let x = 0; x < map.width; x++) {
            newRow[x] = new Phaser.Tilemaps.Tile(layerData, -1, x, layerData.data.length, map.tileWidth, map.tileHeight, map.tileWidth, map.tileHeight);
          }
          layerData.data.push(newRow);
        }
        layerData.height = expectedRows;
        editorLog('Init', `Fixed collision layer dimensions to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
        const testY = 30;
        if (layerData.data[testY]) { editorLog('Init', `Verification: Row ${testY} exists with ${layerData.data[testY].length} tiles`); }
        else { editorError('Init', `Verification failed: Row ${testY} still doesn't exist!`, null); }
      }
    }
  } catch (e) {
    editorLog('Init', 'Collision layer setup failed');
    if (available.length > 0) {
      const firstTs = available[0]!;
      collisionLayer = map.createBlankLayer('Collision', firstTs, 0, 0, map.width, map.height, map.tileWidth, map.tileHeight) as any;
      editorLog('Init', `Created blank collision layer: ${map.width}x${map.height}`);
    }
  }
  if (collisionLayer) scene.collisionLayer = collisionLayer; else delete (scene as any).collisionLayer;
  if (collisionLayer) { editorLog('Init', 'Collision layer created'); }
  if (collisionLayer) {
    collisionLayer.setDepth(10);
    collisionLayer.setVisible(false);
  } else {
    editorLog('Init', 'No collision layer created');
  }
  if (collision) {
    scene.dynamicTilesets.set('collision_tiles', collision);
    if (scene.collisionLayer) {
      const allTilesets = [office, furniture, decor, collision].filter(Boolean) as Phaser.Tilemaps.Tileset[];
      (scene.collisionLayer as any).setTilesets(allTilesets);
    }
  }
  let editorGround: Phaser.Tilemaps.TilemapLayer | undefined;
  editorGround = scene.editorGround;

  if (!editorGround) {
    try {
      const tmp = map.createBlankLayer('EditorGround', available[0], 0, 0, map.width, map.height, map.tileWidth, map.tileHeight);
      scene.editorGround = tmp as any;
    } catch {}
  } else {
    editorGround.setDepth(1);
  }
  let editorWalls: Phaser.Tilemaps.TilemapLayer | undefined;
  editorWalls = scene.wallsLayer;

  if (!editorWalls) {
    try {
      const tmp = map.createBlankLayer('EditorWalls', available[0], 0, 0, map.width, map.height, map.tileWidth, map.tileHeight);
      scene.wallsLayer = tmp as any;
    } catch {}
  } else {
    editorWalls.setDepth(6);
  }
  if (scene.wallsLayer && available.length > 0) { (scene.wallsLayer as any).tileset = available; }
  const cam = scene.cameras.main;
  cam.setBackgroundColor('#202020');
  cam.setZoom(3);
  cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  scene.labelLayer = scene.add.layer();
  scene.labelLayer.setDepth(10000);
  cam.ignore(scene.labelLayer);
  const labelCam = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height);
  labelCam.setZoom(1);
  labelCam.setScroll(0, 0);
  labelCam.setRoundPixels(true);
  scene.labelCamera = labelCam;
  const refreshLabelCamIgnore = () => {
    if (!scene.labelCamera || !scene.labelLayer) return;
    const labelMembers = new Set(scene.labelLayer.list as Phaser.GameObjects.GameObject[]);
    labelMembers.add(scene.labelLayer as unknown as Phaser.GameObjects.GameObject);
    const toIgnore = scene.children.list.filter((o: any) => !labelMembers.has(o as Phaser.GameObjects.GameObject));
    scene.labelCamera.ignore(toIgnore as any);
  };
  refreshLabelCamIgnore();
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, refreshLabelCamIgnore);
  scene.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
  const initialPos = (window as any).initialPlayerPosition || { x: 80, y: 120 };
  scene.hero = scene.physics.add.sprite(initialPos.x, initialPos.y, 'hero_walk_down', 0);
  try { scene.hero.setCollideWorldBounds(true); scene.hero.body.setSize(map.tileWidth * 0.8, map.tileHeight * 0.9); (scene.hero.body as Phaser.Physics.Arcade.Body).offset.set(map.tileWidth * 0.1, map.tileHeight * 0.1); } catch {}
  scene.hero.setDepth(10);
  scene.ensureCollisionCollider();
  scene.heroNameLabel = scene.createNameLabel('Loading...', 'local');
  scene.updateNameLabel(scene.heroNameLabel, scene.hero.x, scene.hero.y);
  scene.anims.create({ key: 'walk_down', frames: scene.anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
  scene.anims.create({ key: 'walk_up', frames: scene.anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
  scene.anims.create({ key: 'walk_left', frames: scene.anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
  scene.anims.create({ key: 'walk_right', frames: scene.anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
  const cursors = scene.input.keyboard!.createCursorKeys();
  try { scene.editorPanKeys = scene.input.keyboard!.addKeys({ up: Phaser.Input.Keyboard.KeyCodes.W, left: Phaser.Input.Keyboard.KeyCodes.A, down: Phaser.Input.Keyboard.KeyCodes.S, right: Phaser.Input.Keyboard.KeyCodes.D }) as any; } catch {}
  scene.spaceKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  scene.cameras.main.startFollow(scene.hero, true, 0.1, 0.1);
  scene.manualCameraActive = false;
  scene.ensureRecenterUi();
  scene.updateRecenterUiVisibility();
  const isEditableTarget = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName?.toLowerCase?.();
    if (tag === 'input' || tag === 'textarea') return true;
    if ((el as any).isContentEditable) return true;
    return false;
  };
  const keyBlocker = (ev: KeyboardEvent) => {
    if (ev.code === 'Space') { scene.spaceHeld = ev.type === 'keydown'; scene.updateCursor(); }
    if (isEditableTarget(ev.target)) { ev.stopPropagation(); }
  };
  window.addEventListener('keydown', keyBlocker, true);
  window.addEventListener('keyup', keyBlocker, true);
  window.addEventListener('blur', () => { scene.spaceHeld = false; scene.updateCursor(); }, true);
  scene.input.on('wheel', (pointer: any, _over: any, _dx: number, dy: number) => {
    const camera = scene.cameras.main;
    const zoomDelta = -dy * 0.002;
    const prevZoom = camera.zoom;
    let nextZoom = Phaser.Math.Clamp(prevZoom + zoomDelta, 1, 5);
    if (Math.abs(nextZoom - prevZoom) < 1e-3) return;
    const worldBefore = (pointer as Phaser.Input.Pointer).positionToCamera(camera) as Phaser.Math.Vector2;
    camera.setZoom(nextZoom);
    const worldAfter = (pointer as Phaser.Input.Pointer).positionToCamera(camera) as Phaser.Math.Vector2;
    camera.scrollX += worldBefore.x - worldAfter.x;
    camera.scrollY += worldBefore.y - worldAfter.y;
    camera.stopFollow();
    scene.manualCameraActive = true;
    scene.updateRecenterUiVisibility();
  });
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    const isLeft = p.leftButtonDown();
    const isMiddle = p.middleButtonDown();
    const spaceDown = scene.spaceHeld;
    const allowPan = isMiddle || (spaceDown && isLeft);
    if (allowPan) {
      if (isLeft) { scene.leftDragCandidate = { active: true, startX: p.x, startY: p.y }; }
      scene.panState.isPanning = true;
      scene.panState.lastX = p.x;
      scene.panState.lastY = p.y;
      scene.cameras.main.stopFollow();
      scene.manualCameraActive = true;
      scene.updateRecenterUiVisibility();
      try { (p.event as any)?.preventDefault?.(); } catch {}
      try { (p.event as any)?.stopPropagation?.(); } catch {}
      scene.updateCursor();
    }
  });
  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
    if (!scene.panState.isPanning) return;
    const camera = scene.cameras.main;
    const dx = p.x - scene.panState.lastX;
    const dy = p.y - scene.panState.lastY;
    scene.panState.lastX = p.x;
    scene.panState.lastY = p.y;
    camera.scrollX -= dx / camera.zoom;
    camera.scrollY -= dy / camera.zoom;
    if (scene.leftDragCandidate && scene.leftDragCandidate.active) {
      const mdx = Math.abs(p.x - scene.leftDragCandidate.startX);
      const mdy = Math.abs(p.y - scene.leftDragCandidate.startY);
      if (mdx + mdy > 3) { try { (p.event as any)?.preventDefault?.(); } catch {} try { (p.event as any)?.stopPropagation?.(); } catch {} }
    }
  });
  const stopPan = (p?: Phaser.Input.Pointer) => {
    scene.panState.isPanning = false;
    if (scene.leftDragCandidate && scene.leftDragCandidate.active && p) {
      const mdx = Math.abs(p.x - scene.leftDragCandidate.startX);
      const mdy = Math.abs(p.y - scene.leftDragCandidate.startY);
      if (mdx + mdy > 3) { try { (p.event as any)?.preventDefault?.(); } catch {} try { (p.event as any)?.stopPropagation?.(); } catch {} }
    }
    scene.leftDragCandidate = null;
    scene.updateCursor();
  };
  scene.input.on(Phaser.Input.Events.POINTER_UP, stopPan);
  scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, stopPan as any);
  scene.scale.on('resize', () => {
    const c = scene.cameras.main;
    c.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    scene.updateRecenterUiVisibility();
    if (scene.labelCamera) { scene.labelCamera.setSize(scene.scale.width, scene.scale.height); }
  });
  let currentDirection: 'up' | 'down' | 'left' | 'right' = 'down';
  try {
    const selfId = (typeof window !== 'undefined' ? (window as any).__localSessionId : undefined);
    if (selfId && scene.remotes.has(selfId)) {
      scene.remotes.get(selfId)?.destroy();
      scene.remotes.delete(selfId);
      const lbl = scene.nameLabels.get(selfId);
      if (lbl) { lbl.destroy(); scene.nameLabels.delete(selfId); }
    }
  } catch {}
  scene.events.on(Phaser.Scenes.Events.UPDATE, () => {
    const speed = 80;
    const body = scene.hero.body;
    body.setVelocity(0);
    if (scene.desiredPos) {
      const dx = scene.desiredPos.x - scene.hero.x;
      const dy = scene.desiredPos.y - scene.hero.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 2) { scene.desiredPos = null; scene.hero.anims.stop(); }
      else {
        const nx = dx / Math.max(Math.hypot(dx, dy), 1e-6);
        const ny = dy / Math.max(Math.hypot(dx, dy), 1e-6);
        body.setVelocity(nx * speed, ny * speed);
        if (Math.abs(nx) > Math.abs(ny)) { currentDirection = nx > 0 ? 'right' : 'left'; scene.hero.play(nx > 0 ? 'walk_right' : 'walk_left', true); }
        else { currentDirection = ny > 0 ? 'down' : 'up'; scene.hero.play(ny > 0 ? 'walk_down' : 'walk_up', true); }
      }
    } else if (!scene.movementLocked) {
      if (cursors.left?.isDown) { body.setVelocityX(-speed); scene.hero.play('walk_left', true); currentDirection = 'left'; }
      else if (cursors.right?.isDown) { body.setVelocityX(speed); scene.hero.play('walk_right', true); currentDirection = 'right'; }
      else if (cursors.up?.isDown) { body.setVelocityY(-speed); scene.hero.play('walk_up', true); currentDirection = 'up'; }
      else if (cursors.down?.isDown) { body.setVelocityY(speed); scene.hero.play('walk_down', true); currentDirection = 'down'; }
      else { scene.hero.anims.stop(); const base: any = { up: 'hero_walk_up', down: 'hero_walk_down', left: 'hero_walk_left', right: 'hero_walk_right' }; scene.hero.setTexture(base[currentDirection] || 'hero_walk_down', 0); }
    } else {
      body.setVelocity(0, 0);
      scene.hero.anims.stop();
      const base: any = { up: 'hero_walk_up', down: 'hero_walk_down', left: 'hero_walk_left', right: 'hero_walk_right' };
      scene.hero.setTexture(base[currentDirection] || 'hero_walk_down', 0);
    }
    scene.gameBridge.onLocalMove({ x: scene.hero.x, y: scene.hero.y, direction: currentDirection });
    if (scene.heroNameLabel) { scene.updateNameLabel(scene.heroNameLabel, scene.hero.x, scene.hero.y); }
    scene.updateRecenterUiVisibility();
    scene.autoFollowIfHeroOutOfView();
    try {
      if (scene.editorMode && !scene.panState.isPanning) {
        const cam2 = scene.cameras.main;
        const dt = Math.max(scene.game.loop.delta, 16) / 1000;
        const base = 600;
        const step = (base * dt) / Math.max(cam2.zoom, 0.001);
        const anyCursors: any = cursors;
        const keys = scene.editorPanKeys || ({} as any);
        if (anyCursors.left?.isDown || keys.left?.isDown) cam2.scrollX -= step;
        if (anyCursors.right?.isDown || keys.right?.isDown) cam2.scrollX += step;
        if (anyCursors.up?.isDown || keys.up?.isDown) cam2.scrollY -= step;
        if (anyCursors.down?.isDown || keys.down?.isDown) cam2.scrollY += step;
        if (anyCursors.left?.isDown || anyCursors.right?.isDown || anyCursors.up?.isDown || anyCursors.down?.isDown || keys.left?.isDown || keys.right?.isDown || keys.up?.isDown || keys.down?.isDown) {
          try { cam2.stopFollow(); } catch {}
          scene.manualCameraActive = true;
          scene.updateRecenterUiVisibility();
        }
      }
    } catch {}
  });
  const toTile = (p: Phaser.Input.Pointer) => {
    const wp = p.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2;
    if (!scene.mapRef) return { tileX: 0, tileY: 0 };
    const tileX = Math.floor(wp.x / scene.mapRef.tileWidth);
    const tileY = Math.floor(wp.y / scene.mapRef.tileHeight);
    return { tileX, tileY };
  };
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    const worldPoint = pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2;
    const isPanStart = (pointer.middleButtonDown() || ((scene.spaceHeld || !!scene.spaceKey?.isDown) && pointer.leftButtonDown()));
    if (pointer.rightButtonDown()) {
      try { (pointer.event as any)?.preventDefault?.(); } catch {}
      for (const [id, sprite] of scene.remotes) {
        const bounds = sprite.getBounds();
        if (bounds.contains(worldPoint.x, worldPoint.y)) {
          const evt = (pointer.event as any) as MouseEvent | undefined;
          const sx = evt?.clientX ?? pointer.x;
          const sy = evt?.clientY ?? pointer.y;
          scene.gameBridge.onRightClick({ x: sx, y: sy, playerId: id });
          break;
        }
      }
      return;
    }
    const assetPreviewActive = !!(scene as any).ghostSprite;
    if (!isPanStart && scene.editorMode) {
      if (!assetPreviewActive) { scene.gameBridge.onPointerDown({ x: worldPoint.x, y: worldPoint.y }); }
      const { tileX, tileY } = toTile(pointer);
      try { window.dispatchEvent(new CustomEvent('editor:tileDown', { detail: { tileX, tileY } })); } catch {}
      scene.gameBridge.onPointerDownTile({ tileX, tileY });
      try {
        (scene as any)._dragStartTile = { x: tileX, y: tileY };
        if (scene.mapRef) {
          const x = tileX * scene.mapRef.tileWidth;
          const y = tileY * scene.mapRef.tileHeight;
          scene.setSelectionRect({ x, y, w: scene.mapRef.tileWidth, h: scene.mapRef.tileHeight });
        }
      } catch {}
    }
  });
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    const { tileX, tileY } = toTile(pointer);
    try { if (scene.editorMode && !scene.panState.isPanning) window.dispatchEvent(new CustomEvent('editor:tileMove', { detail: { tileX, tileY } })); } catch {}
    if (scene.editorMode && !scene.panState.isPanning) scene.gameBridge.onPointerMoveTile({ tileX, tileY });
    if (scene.ghostSprite && scene.mapRef) {
      const x = tileX * scene.mapRef.tileWidth + scene.mapRef.tileWidth / 2;
      const y = tileY * scene.mapRef.tileHeight + scene.mapRef.tileHeight / 2;
      if (Math.abs(scene.ghostSprite.x - x) > 0.01 || Math.abs(scene.ghostSprite.y - y) > 0.01) {
        scene.ghostSprite.setPosition(x, y);
      }
    }
    try {
      const ds = (scene as any)._dragStartTile as { x: number; y: number } | undefined;
      if (scene.editorMode && ds && pointer.leftButtonDown() && !scene.panState.isPanning && scene.mapRef) {
        const sx = Math.min(ds.x, tileX) * scene.mapRef.tileWidth;
        const sy = Math.min(ds.y, tileY) * scene.mapRef.tileHeight;
        const ex = Math.max(ds.x, tileX) * scene.mapRef.tileWidth + scene.mapRef.tileWidth;
        const ey = Math.max(ds.y, tileY) * scene.mapRef.tileHeight + scene.mapRef.tileHeight;
        scene.setSelectionRect({ x: sx, y: sy, w: ex - sx, h: ey - sy });
      }
    } catch {}
  });
  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    const { tileX, tileY } = toTile(pointer);
    if (scene.editorMode && !scene.panState.isPanning) {
      try { console.log('[SPAWN_DBG][Scene] pointerup->onPointerUpTile', { tileX, tileY }); } catch {}
      try { window.dispatchEvent(new CustomEvent('editor:tileUp', { detail: { tileX, tileY } })); } catch {}
      scene.gameBridge.onPointerUpTile({ tileX, tileY });
    }
    try {
      const ds = (scene as any)._dragStartTile as { x: number; y: number } | undefined;
      if (scene.editorMode && ds && scene.ghostSprite && (scene as any)._ghostDataUrl && scene.editorCurrentTool !== 'collision' && scene.editorCurrentTool !== 'erase') {
        const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };
        scene.applyTerrainPaint({ rect, dataUrl: (scene as any)._ghostDataUrl as string });
      } else if (scene.editorMode && ds && (scene.editorCurrentTool === 'collision' || scene.editorCurrentTool === 'erase')) {
        const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };
        const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: scene.editorCurrentTool === 'erase' ? -1 : 1, rect };
        scene.applyTilePaint(edit);
      }
    } catch {}
    scene.setSelectionRect(null);
    (scene as any)._dragStartTile = undefined;
    scene.updateCursor();
  });
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
    if (p.rightButtonDown()) { try { (p.event as any)?.preventDefault?.(); } catch {} try { (p.event as any)?.stopPropagation?.(); } catch {} }
  });
  scene.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
    if (p.rightButtonReleased()) { try { (p.event as any)?.preventDefault?.(); } catch {} try { (p.event as any)?.stopPropagation?.(); } catch {} }
  });
  scene.hoverOutline = scene.add.graphics();
  scene.hoverOutline.setDepth(11);
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    const worldPoint = pointer.positionToCamera(scene.cameras.main) as Phaser.Math.Vector2;
    let foundHover = false;
    for (const [_id, sprite] of scene.remotes) {
      const bounds = sprite.getBounds();
      if (bounds.contains(worldPoint.x, worldPoint.y)) {
        if (scene.hoveredSprite !== sprite) { scene.hoveredSprite = sprite; scene.updateHoverOutline(); }
        foundHover = true;
        break;
      }
    }
    if (!foundHover && scene.hoveredSprite) { scene.hoveredSprite = null; scene.updateHoverOutline(); }
    scene.updateCursor();
  });
  try { scene.input.mouse?.disableContextMenu?.(); } catch {}
  scene.game.canvas.addEventListener('contextmenu', (e: Event) => { e.preventDefault(); return false as any; });
  scene.gameBridge.setSceneApi(scene);
  (window as any).currentPhaserScene = scene;
  const pendingTilesets = (window as any).pendingTilesets;
  if (pendingTilesets && Array.isArray(pendingTilesets)) {
    scene.pendingTilesetRegistrations = pendingTilesets;
    setTimeout(() => { scene.pendingTilesetRegistrations?.forEach((ts: any) => { scene.registerTileset(ts); }); }, 100);
    (window as any).pendingTilesets = null;
  }
  setTimeout(() => {
    if (scene.v2) { try { scene.collisionLayer?.setVisible(false); } catch {}; return; }
  }, 0);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { try { scene.gameBridge.setSceneApi(null); } catch {} });
  scene.events.once(Phaser.Scenes.Events.DESTROY, () => { try { scene.gameBridge.setSceneApi(null); } catch {} });
}


