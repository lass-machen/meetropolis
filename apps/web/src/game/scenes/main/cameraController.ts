import Phaser from 'phaser';

export interface CameraControllerConfig {
  scene: Phaser.Scene;
  camera: Phaser.Cameras.Scene2D.Camera;
  hero: Phaser.GameObjects.Sprite;
  editorMode: boolean;
}

export class CameraController {
  private scene: Phaser.Scene;
  private camera: Phaser.Cameras.Scene2D.Camera;
  private hero: Phaser.GameObjects.Sprite;
  private manualCameraActive = false;
  private panState: { isPanning: boolean; lastX: number; lastY: number } = {
    isPanning: false,
    lastX: 0,
    lastY: 0,
  };
  private spaceHeld = false;
  private leftDragCandidate: { active: boolean; startX: number; startY: number } | null = null;
  private editorMode = false;
  private editorPanKeys?: {
    up?: Phaser.Input.Keyboard.Key;
    down?: Phaser.Input.Keyboard.Key;
    left?: Phaser.Input.Keyboard.Key;
    right?: Phaser.Input.Keyboard.Key;
  };

  constructor(config: CameraControllerConfig) {
    this.scene = config.scene;
    this.camera = config.camera;
    this.hero = config.hero;
    this.editorMode = config.editorMode;
  }

  init(input: Phaser.Input.InputPlugin) {
    this.setupInputHandlers(input);
    this.setupZoom();
    this.setupPan();
    this.setupKeyboardTracking();
  }

  private setupKeyboardTracking() {
    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase?.();
      if (tag === 'input' || tag === 'textarea') return true;
      if ((el as any).isContentEditable) return true;
      return false;
    };

    const keyBlocker = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') {
        this.spaceHeld = ev.type === 'keydown';
      }
      if (isEditableTarget(ev.target)) {
        ev.stopPropagation();
      }
    };

    window.addEventListener('keydown', keyBlocker, true);
    window.addEventListener('keyup', keyBlocker, true);
    window.addEventListener(
      'blur',
      () => {
        this.spaceHeld = false;
      },
      true,
    );
  }

  private setupInputHandlers(input: Phaser.Input.InputPlugin) {
    try {
      this.editorPanKeys = input.keyboard!.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      });
    } catch {}
  }

  private setupZoom() {
    this.scene.input.on('wheel', (_pointer: any, _over: any, _dx: number, dy: number) => {
      const zoomDelta = -dy * 0.002;
      const prevZoom = this.camera.zoom;
      const nextZoom = Phaser.Math.Clamp(prevZoom + zoomDelta, 1, 5);

      if (Math.abs(nextZoom - prevZoom) < 1e-3) return;

      this.camera.setZoom(nextZoom);

      if (this.hero) {
        this.camera.startFollow(this.hero, true, 0.1, 0.1);
        this.manualCameraActive = false;
      }
    });
  }

  private setupPan() {
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const isLeft = p.leftButtonDown();
      const isMiddle = p.middleButtonDown();
      const allowPan = isMiddle || (this.spaceHeld && isLeft);

      if (allowPan) {
        if (isLeft) {
          this.leftDragCandidate = { active: true, startX: p.x, startY: p.y };
        }
        this.panState.isPanning = true;
        this.panState.lastX = p.x;
        this.panState.lastY = p.y;
        this.camera.stopFollow();
        this.manualCameraActive = true;

        try {
          (p.event as any)?.preventDefault?.();
        } catch {}
        try {
          (p.event as any)?.stopPropagation?.();
        } catch {}
      }
    });

    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.panState.isPanning) return;

      const dx = p.x - this.panState.lastX;
      const dy = p.y - this.panState.lastY;
      this.panState.lastX = p.x;
      this.panState.lastY = p.y;

      this.camera.scrollX -= dx / this.camera.zoom;
      this.camera.scrollY -= dy / this.camera.zoom;

      if (this.leftDragCandidate && this.leftDragCandidate.active) {
        const mdx = Math.abs(p.x - this.leftDragCandidate.startX);
        const mdy = Math.abs(p.y - this.leftDragCandidate.startY);
        if (mdx + mdy > 3) {
          try {
            (p.event as any)?.preventDefault?.();
          } catch {}
          try {
            (p.event as any)?.stopPropagation?.();
          } catch {}
        }
      }
    });

    const stopPan = (p?: Phaser.Input.Pointer) => {
      this.panState.isPanning = false;
      if (this.leftDragCandidate && this.leftDragCandidate.active && p) {
        const mdx = Math.abs(p.x - this.leftDragCandidate.startX);
        const mdy = Math.abs(p.y - this.leftDragCandidate.startY);
        if (mdx + mdy > 3) {
          try {
            (p.event as any)?.preventDefault?.();
          } catch {}
          try {
            (p.event as any)?.stopPropagation?.();
          } catch {}
        }
      }
      this.leftDragCandidate = null;
    };

    this.scene.input.on(Phaser.Input.Events.POINTER_UP, stopPan);
    this.scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, stopPan);
  }

  autoFollowIfHeroOutOfView() {
    try {
      if (!this.camera || !this.hero) return;

      const isFollowing = (this.camera as any).follow === this.hero;
      if (!this.manualCameraActive && isFollowing) return;

      const view = this.camera.worldView;
      const margin = 8;
      const outLeft = this.hero.x < view.x - margin;
      const outRight = this.hero.x > view.right + margin;
      const outTop = this.hero.y < view.y - margin;
      const outBottom = this.hero.y > view.bottom + margin;
      const isOutside = outLeft || outRight || outTop || outBottom;

      if (isOutside && !this.editorMode && !this.panState.isPanning) {
        try {
          this.camera.startFollow(this.hero, true, 0.1, 0.1);
        } catch {}
        this.manualCameraActive = false;
      }
    } catch {}
  }

  recenterCamera() {
    try {
      this.camera.startFollow(this.hero, true, 0.1, 0.1);
      this.manualCameraActive = false;
    } catch {}
  }

  updateEditorPan(cursors: Phaser.Types.Input.Keyboard.CursorKeys, delta: number) {
    if (!this.editorMode || this.panState.isPanning) return;

    const dt = Math.max(delta, 16) / 1000;
    const base = 600;
    const step = (base * dt) / Math.max(this.camera.zoom, 0.001);
    const anyCursors: any = cursors;
    const keys = this.editorPanKeys || ({} as any);

    let moved = false;

    if (anyCursors.left?.isDown || keys.left?.isDown) {
      this.camera.scrollX -= step;
      moved = true;
    }
    if (anyCursors.right?.isDown || keys.right?.isDown) {
      this.camera.scrollX += step;
      moved = true;
    }
    if (anyCursors.up?.isDown || keys.up?.isDown) {
      this.camera.scrollY -= step;
      moved = true;
    }
    if (anyCursors.down?.isDown || keys.down?.isDown) {
      this.camera.scrollY += step;
      moved = true;
    }

    if (moved) {
      try {
        this.camera.stopFollow();
      } catch {}
      this.manualCameraActive = true;
    }
  }

  setEditorMode(enabled: boolean) {
    this.editorMode = enabled;
    if (enabled) {
      try {
        this.camera.stopFollow();
      } catch {}
      this.manualCameraActive = true;
    } else {
      try {
        this.camera.startFollow(this.hero, true, 0.1, 0.1);
      } catch {}
      this.manualCameraActive = false;
    }
  }

  isManuallyControlled(): boolean {
    return this.manualCameraActive;
  }

  isPanning(): boolean {
    return this.panState.isPanning;
  }

  isSpaceHeld(): boolean {
    return this.spaceHeld;
  }

  getLeftDragCandidate() {
    return this.leftDragCandidate;
  }
}
