export interface GameSystem {
  init(): void;
  update(time: number, delta: number): void;
  destroy(): void;
}


