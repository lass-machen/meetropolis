type MoveCallback = (x: number, y: number, direction: string) => void;

const ARRIVAL_THRESHOLD = 3;
const TICK_INTERVAL_MS = 150;
const DEFAULT_SPEED = 40; // px/s
const MAX_DELAY_MS = 5000;

export class MovementEngine {
  private onStep: MoveCallback;
  private alive = false;
  private posX = 0;
  private posY = 0;
  private targetX = 0;
  private targetY = 0;
  private speed = DEFAULT_SPEED;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(onStep: MoveCallback) {
    this.onStep = onStep;
  }

  moveTo(x: number, y: number, speed?: number): void {
    this.targetX = x;
    this.targetY = y;
    if (speed && speed > 0) this.speed = speed;
    if (!this.alive) this.startLoop();
  }

  stop(): void {
    this.alive = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setPosition(x: number, y: number): void {
    this.posX = x;
    this.posY = y;
  }

  private startLoop(): void {
    this.alive = true;
    let lastTs = Date.now();

    const tick = (): void => {
      if (!this.alive) return;
      const now = Date.now();
      const dt = Math.max(1, now - lastTs) / 1000;
      lastTs = now;

      const dx = this.targetX - this.posX;
      const dy = this.targetY - this.posY;
      const dist = Math.hypot(dx, dy);

      if (dist < ARRIVAL_THRESHOLD) {
        this.posX = this.targetX;
        this.posY = this.targetY;
        const dir = this.computeDirection(dx, dy);
        this.onStep(Math.round(this.posX), Math.round(this.posY), dir);
        this.alive = false;
        return;
      }

      const step = Math.min(dist, this.speed * dt);
      this.posX += (dx / dist) * step;
      this.posY += (dy / dist) * step;
      const dir = this.computeDirection(dx, dy);
      this.onStep(Math.round(this.posX), Math.round(this.posY), dir);

      this.timer = setTimeout(tick, TICK_INTERVAL_MS);
    };

    tick();
  }

  private computeDirection(dx: number, dy: number): string {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'down' : 'up';
  }
}

// Re-export constants for testing if needed
export { DEFAULT_SPEED, ARRIVAL_THRESHOLD, TICK_INTERVAL_MS, MAX_DELAY_MS };
