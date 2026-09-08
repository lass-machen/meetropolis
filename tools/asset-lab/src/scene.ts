import Phaser from 'phaser';
import { buildAssets, type AssetLibrary } from './assets.ts';
import { characterSheet, defaultCharacter, type Character } from './avatar.ts';
import { paint, toCanvas } from './canvas.ts';
import { collisions, prepareRoom, type RoomRender, findPath, move, zoneAt } from './world.ts';
import { officePresets } from './office-presets.ts';
import type { OfficePreset, Point, Rect } from './office-model.ts';
import type { Pixels } from './pixels.ts';

export const VIEWPORT = { width: 640, height: 416 };

export interface SceneStatus extends Point {
  zone: string;
  detail: string;
  moving: boolean;
}

export class OfficeScene extends Phaser.Scene {
  private assets: AssetLibrary = buildAssets('holz');
  private roomRender: RoomRender | undefined;
  private character: Character = { ...defaultCharacter };
  private avatar!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Ellipse;
  private marker!: Phaser.GameObjects.Arc;
  private guides!: Phaser.GameObjects.Graphics;
  private obstacles: Rect[] = [];
  private office: OfficePreset = officePresets.loft;
  private position = { ...this.office.spawn };
  private roomObjects: Phaser.GameObjects.Image[] = [];
  private roomKeys = new Set<string>();
  private overview = false;
  private path: Point[] = [];
  private held = new Set<string>();
  private direction = 0;
  private walkingTime = 0;
  private ready = false;
  private status: (state: SceneStatus) => void;

  constructor(status: (state: SceneStatus) => void) {
    super('office');
    this.status = status;
  }

  create(): void {
    const texture = this.textures.addCanvas('character', toCanvas(characterSheet(this.character)));
    if (!texture) throw new Error('Die Charaktertextur konnte nicht angelegt werden.');
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 4; col++) texture.add(row * 4 + col, 0, col * 32, row * 32, 32, 32);
    this.marker = this.add.circle(0, 0, 4, 0x3b7169, 0.3).setStrokeStyle(1, 0x35665e).setDepth(0).setVisible(false);
    this.shadow = this.add.ellipse(this.office.spawn.x, this.office.spawn.y, 18, 6, 0x35483e, 0.18).setDepth(1);
    this.avatar = this.add
      .image(this.office.spawn.x, this.office.spawn.y + 2, 'character', 0)
      .setOrigin(0.5, 1)
      .setDepth(this.office.spawn.y);
    this.guides = this.add.graphics().setDepth(1000).setVisible(false);
    this.rebuildRoom();
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      'Begehbares Büro. Mit Pfeiltasten oder WASD laufen. Ein Klick setzt ein Laufziel.',
    );
    canvas.setAttribute('role', 'application');
    const down = (event: KeyboardEvent): void => {
      if (
        document.activeElement !== canvas ||
        !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(event.key)
      )
        return;
      event.preventDefault();
      this.held.add(event.key.toLowerCase());
      this.path = [];
      this.marker.setVisible(false);
    };
    const up = (event: KeyboardEvent): void => {
      this.held.delete(event.key.toLowerCase());
    };
    const blur = (): void => {
      this.held.clear();
      this.path = [];
      this.marker.setVisible(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    canvas.addEventListener('blur', blur);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      canvas.removeEventListener('blur', blur);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      canvas.focus({ preventScroll: true });
      const target = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const point = { x: Math.round(target.x), y: Math.round(target.y) };
      this.path = findPath(this.position, point, this.obstacles, this.office.bounds);
      this.marker.setPosition(point.x, point.y).setVisible(this.path.length > 0);
    });
    this.ready = true;
    this.game.canvas.dataset.ready = 'true';
  }

  private addTexture(id: string, pixels: Pixels): void {
    const texture = this.textures.addCanvas(id, toCanvas(pixels));
    if (!texture) throw new Error(`Textur ${id} konnte nicht angelegt werden.`);
  }

  private updateTexture(id: string, pixels: { width: number; height: number; data: Uint8ClampedArray }): void {
    const texture = this.textures.get(id) as Phaser.Textures.CanvasTexture;
    paint(texture.canvas, pixels);
    texture.refresh();
  }

  setRoom(office: OfficePreset, assets: AssetLibrary, render: RoomRender): void {
    const changed = this.office.id !== office.id;
    this.office = office;
    this.assets = assets;
    this.roomRender = render;
    if (changed) {
      this.overview = false;
      this.resetPosition();
    }
    if (!this.ready) return;
    if (changed) {
      this.rebuildRoom();
      return;
    }
    this.updateTexture('room', render.background);
    const updated = new Set<string>();
    for (const item of render.sprites) {
      if (updated.has(item.key)) continue;
      this.updateTexture(item.key, item.pixels);
      updated.add(item.key);
    }
  }

  setCharacter(character: Character): void {
    this.character = { ...character };
    if (this.ready) this.updateTexture('character', characterSheet(character));
  }

  setGuides(visible: boolean): void {
    this.guides?.setVisible(visible);
  }

  resetPosition(): void {
    this.position = { ...this.office.spawn };
    this.path = [];
    this.held.clear();
    this.marker?.setVisible(false);
  }

  setOverview(overview: boolean): void {
    this.overview = overview;
    if (this.ready) this.configureCamera();
  }

  private configureCamera(): void {
    const camera = this.cameras.main;
    camera.setBounds(0, 0, this.office.world.width, this.office.world.height);
    if (this.overview) {
      camera.stopFollow();
      camera.setZoom(Math.min(VIEWPORT.width / this.office.world.width, VIEWPORT.height / this.office.world.height));
      camera.centerOn(this.office.world.width / 2, this.office.world.height / 2);
    } else {
      camera.setZoom(1);
      camera.startFollow(this.avatar, true, 1, 1);
    }
    camera.preRender();
  }

  private rebuildRoom(): void {
    for (const object of this.roomObjects) object.destroy();
    for (const key of this.roomKeys) this.textures.remove(key);
    this.roomObjects = [];
    this.roomKeys.clear();
    const render = this.roomRender ?? prepareRoom('holz', this.assets, this.office);
    const sprites = [{ key: 'room', pixels: render.background, x: 0, y: 0, depth: -100 }, ...render.sprites];
    for (const item of sprites) {
      if (!this.roomKeys.has(item.key)) {
        this.addTexture(item.key, item.pixels);
        this.roomKeys.add(item.key);
      }
      this.roomObjects.push(this.add.image(item.x, item.y, item.key).setOrigin(0).setDepth(item.depth));
    }
    this.obstacles = collisions(this.office, this.assets);
    this.drawGuides();
    this.avatar.setPosition(this.position.x, this.position.y + 2).setDepth(this.position.y);
    this.shadow.setPosition(this.position.x, this.position.y);
    this.configureCamera();
    this.game.canvas.dataset.office = this.office.id;
  }

  private drawGuides(): void {
    this.guides.clear();
    const b = this.office.bounds;
    this.guides.lineStyle(1, 0x2f7771, 0.22);
    for (let x = b.x; x <= b.x + b.w; x += 16) this.guides.lineBetween(x, b.y, x, b.y + b.h);
    for (let y = b.y; y <= b.y + b.h; y += 16) this.guides.lineBetween(b.x, y, b.x + b.w, y);
    this.guides.lineStyle(1, 0xc96d51, 0.9);
    for (const r of this.obstacles) this.guides.strokeRect(r.x, r.y, r.w, r.h);
  }

  update(_time: number, delta: number): void {
    if (!this.ready) return;
    const dt = Math.min(delta, 50) / 1000;
    let dx =
      Number(this.held.has('arrowright') || this.held.has('d')) -
      Number(this.held.has('arrowleft') || this.held.has('a'));
    let dy =
      Number(this.held.has('arrowdown') || this.held.has('s')) - Number(this.held.has('arrowup') || this.held.has('w'));
    let distance = 88 * dt;
    if (!dx && !dy && this.path.length) {
      const next = this.path[0];
      dx = next.x - this.position.x;
      dy = next.y - this.position.y;
      distance = Math.min(distance, Math.hypot(dx, dy));
      if (Math.hypot(dx, dy) <= distance + 0.01) this.path.shift();
    }
    const magnitude = Math.hypot(dx, dy);
    const previous = this.position;
    if (magnitude)
      this.position = move(
        previous,
        { x: (dx / magnitude) * distance, y: (dy / magnitude) * distance },
        this.obstacles,
        this.office.bounds,
      );
    const movedX = this.position.x - previous.x;
    const movedY = this.position.y - previous.y;
    const moving = Math.hypot(movedX, movedY) > 0.01;
    if (moving) {
      this.direction = Math.abs(movedX) > Math.abs(movedY) ? (movedX < 0 ? 1 : 2) : movedY < 0 ? 3 : 0;
      this.walkingTime += dt;
    } else this.walkingTime = 0;
    const frame = moving ? (4 + this.direction) * 4 + (Math.floor(this.walkingTime * 8) % 4) : this.direction * 4;
    this.avatar
      .setPosition(Math.round(this.position.x), Math.round(this.position.y) + 2)
      .setDepth(this.position.y)
      .setFrame(frame);
    this.shadow.setPosition(Math.round(this.position.x), Math.round(this.position.y));
    if (!this.path.length) this.marker.setVisible(false);
    this.game.canvas.dataset.x = this.position.x.toFixed(2);
    this.game.canvas.dataset.y = this.position.y.toFixed(2);
    this.game.canvas.dataset.frame = String(frame);
    const camera = this.cameras.main;
    this.game.canvas.dataset.cameraX = String(camera.worldView.x);
    this.game.canvas.dataset.cameraY = String(camera.worldView.y);
    this.game.canvas.dataset.zoom = String(camera.zoom);
    const zone = zoneAt(this.position, this.office);
    this.status({
      ...this.position,
      moving,
      zone: zone?.name ?? 'Freier Bereich',
      detail: zone?.detail ?? 'Klicke in den Raum und erkunde das Büro.',
    });
  }
}

export function createOffice(
  parent: HTMLElement,
  status: (state: SceneStatus) => void,
): { game: Phaser.Game; scene: OfficeScene } {
  const scene = new OfficeScene(status);
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    parent,
    pixelArt: true,
    roundPixels: true,
    transparent: true,
    banner: false,
    input: { keyboard: false },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [scene],
  });
  return { game, scene };
}
