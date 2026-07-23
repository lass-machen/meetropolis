export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const ZOOM_BUTTON_STEP = 0.25;

// WheelEvent.deltaMode values, inlined so this module stays DOM-free and
// unit-testable without a browser environment.
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_DELTA_PX = 16;
const PAGE_DELTA_PX = 100;

// Multiplicative damping so high-frequency trackpad/Magic-Mouse deltas
// produce a smooth continuous zoom instead of discrete jumps.
const PINCH_ZOOM_SENSITIVITY = 0.002;

export type PanOffset = { x: number; y: number };
export type StageSize = { width: number; height: number };

export type WheelInput = {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
};

export type WheelAction =
  | { kind: 'zoom'; zoom: number }
  | { kind: 'pan'; deltaX: number; deltaY: number }
  | { kind: 'none' };

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function stepZoom(zoom: number, direction: 1 | -1): number {
  return clampZoom(+(zoom + direction * ZOOM_BUTTON_STEP).toFixed(2));
}

export function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) return delta * LINE_DELTA_PX;
  if (deltaMode === DOM_DELTA_PAGE) return delta * PAGE_DELTA_PX;
  return delta;
}

export function pinchZoom(zoom: number, normalizedDeltaY: number): number {
  return clampZoom(zoom * Math.exp(-normalizedDeltaY * PINCH_ZOOM_SENSITIVITY));
}

function clampAxis(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(-max, Math.min(max, value));
}

export function clampPan(pan: PanOffset, zoom: number, stage: StageSize): PanOffset {
  return {
    x: clampAxis(pan.x, ((zoom - 1) * stage.width) / 2),
    y: clampAxis(pan.y, ((zoom - 1) * stage.height) / 2),
  };
}

export function resolveWheelAction(input: WheelInput, zoom: number): WheelAction {
  const deltaY = normalizeWheelDelta(input.deltaY, input.deltaMode);
  // Zoom only with an explicit modifier: macOS pinch gestures arrive as
  // ctrlKey+wheel; plain two-finger scrolling must never change the zoom.
  if (input.ctrlKey || input.metaKey) {
    return { kind: 'zoom', zoom: pinchZoom(zoom, deltaY) };
  }
  if (zoom <= 1) return { kind: 'none' };
  const deltaX = normalizeWheelDelta(input.deltaX, input.deltaMode);
  return { kind: 'pan', deltaX: -deltaX, deltaY: -deltaY };
}
