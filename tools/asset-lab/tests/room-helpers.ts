import type { Page } from '@playwright/test';
import type { Point } from '../src/office-model.ts';

/** Echte Maus-/Touch-Eingabe unter der sichtbaren Kameratransformation. */
export async function clickWorld(page: Page, target: Point, touch = false): Promise<Point> {
  const canvas = page.locator('#game canvas');
  await canvas.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const position = await canvas.evaluate(
    (node: HTMLCanvasElement, p) => {
      const rect = node.getBoundingClientRect();
      const zoom = Number(node.dataset.zoom);
      const cx = Number(node.dataset.cameraX);
      const cy = Number(node.dataset.cameraY);
      const receive = (event: MouseEvent | TouchEvent) => {
        const point = 'touches' in event ? event.touches[0] : event;
        node.dataset.inputX = String(Math.round((((point.clientX - rect.left) / rect.width) * node.width) / zoom + cx));
        node.dataset.inputY = String(
          Math.round((((point.clientY - rect.top) / rect.height) * node.height) / zoom + cy),
        );
      };
      node.addEventListener(p.touch ? 'touchstart' : 'mousedown', receive as EventListener, { once: true });
      return {
        x: (((p.target.x - cx) * zoom) / node.width) * rect.width,
        y: (((p.target.y - cy) * zoom) / node.height) * rect.height,
        left: rect.left,
        top: rect.top,
      };
    },
    { target, touch },
  );
  if (touch) await page.touchscreen.tap(position.left + position.x, position.top + position.y);
  else await canvas.click({ position: { x: position.x, y: position.y } });
  return {
    x: Number(await canvas.getAttribute('data-input-x')),
    y: Number(await canvas.getAttribute('data-input-y')),
  };
}
