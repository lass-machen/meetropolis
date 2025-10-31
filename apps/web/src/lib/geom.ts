// Geometrie-Helfer
// Punkt-in-Polygon Test (Ray-Casting)
export function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect = ((pi.y > p.y) !== (pj.y > p.y)) &&
      (p.x < (pj.x - pi.x) * (p.y - pi.y) / ((pj.y - pi.y) + 1e-9) + pi.x);
    if (intersect) inside = !inside;
  }
  return inside;
}


