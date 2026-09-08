export type Color = readonly [number, number, number, number];

export function rgba(hex: string): Color {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Kleine Rasterfläche: dieselben Pixel gehen in Vorschau und PNG-Export. */
export class Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  rect(x: number, y: number, width: number, height: number, hex: string): void {
    const color = rgba(hex);
    for (let py = Math.max(0, y); py < Math.min(this.height, y + height); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + width); px++) {
        const offset = (py * this.width + px) * 4;
        this.data[offset] = color[0];
        this.data[offset + 1] = color[1];
        this.data[offset + 2] = color[2];
        this.data[offset + 3] = color[3];
      }
    }
  }

  /** Abgerundete Silhouetten bleiben am echten Pixelraster ausgerichtet. */
  box(x: number, y: number, w: number, h: number, color: string, radius = 1): void {
    this.rect(x + radius, y, w - radius * 2, h, color);
    this.rect(x, y + radius, w, h - radius * 2, color);
  }

  stamp(source: Pixels, x: number, y: number): void {
    for (let sy = Math.max(0, -y); sy < Math.min(source.height, this.height - y); sy++) {
      for (let sx = Math.max(0, -x); sx < Math.min(source.width, this.width - x); sx++) {
        const dx = sx + x;
        const dy = sy + y;
        const si = (sy * source.width + sx) * 4;
        if (source.data[si + 3] === 0) continue;
        const di = (dy * this.width + dx) * 4;
        this.data[di] = source.data[si];
        this.data[di + 1] = source.data[si + 1];
        this.data[di + 2] = source.data[si + 2];
        this.data[di + 3] = source.data[si + 3];
      }
    }
  }
}
