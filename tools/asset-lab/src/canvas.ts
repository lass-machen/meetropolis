import type { RgbaImage } from '../../../packages/shared/src/sprite/types.ts';

export function paint(canvas: HTMLCanvasElement, pixels: RgbaImage): void {
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Die Pixelvorschau benötigt Canvas 2D.');
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
}

export function toCanvas(pixels: RgbaImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  paint(canvas, pixels);
  return canvas;
}

export async function png(pixels: RgbaImage): Promise<Blob> {
  return new Promise((resolve, reject) =>
    toCanvas(pixels).toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Die PNG-Datei konnte nicht erzeugt werden.'));
    }, 'image/png'),
  );
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
