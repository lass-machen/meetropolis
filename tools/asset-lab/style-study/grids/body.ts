// Shared body grids for all four figures: neck, hoodie torso with short
// sleeves and cuffs, two hands, legs, two separate shoes. Identical
// clothing (trousers, hoodie_blue, dark pants, brown shoes), identical
// floor anchor (shoe soles at y29 with a transparent gap at x15..x16) and
// joint positions. Front and rear are 12px wide (x10..x21); profiles are
// narrower with the toe pointing toward the facing direction. Shading
// always assumes the screen-top-left light, so the right profile is NOT
// a mirrored left.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`body row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: stepped shoulders (y17 narrower, y18 wider), sleeve seams at
// x12/x19 so the hoodie center never crosses the sleeve contour, pocket
// seam, cuff rows, two hands flanking the hem, two shoes split at x15..16.
export const BODY_FRONT = grid({
  16: '..............cbbc..............',
  17: '...........OttttttttO...........',
  18: '..........OtuuuuuuuuvO..........',
  19: '..........OtvuuuuuuvuO..........',
  20: '..........OuvuuuuuuvuO..........',
  21: '..........OvvuvvvvuvvO..........',
  22: '.........ObbvvvvvvvvbbO.........',
  23: '.........Obb........bbO.........',
  24: '...........Opqq..qqnO...........',
  25: '...........Opqq..qqnO...........',
  26: '...........Opqq..qqnO...........',
  27: '...........Opqq..qqnO...........',
  28: '..........Orssd..rssdO..........',
  29: '..........OdddO..OdddO..........',
});

// Rear: same silhouette and split shoes, no pocket seam; the back reads as
// one calm surface with the same sleeve seams and cuffs.
export const BODY_REAR = grid({
  16: '..............cbbc..............',
  17: '...........OttttttttO...........',
  18: '..........OtuuuuuuuuvO..........',
  19: '..........OtvuuuuuuvuO..........',
  20: '..........OuvuuuuuuvuO..........',
  21: '..........OvvuuuuuuvvO..........',
  22: '.........ObbvvvvvvvvbbO.........',
  23: '.........Obb........bbO.........',
  24: '...........Opqq..qqnO...........',
  25: '...........Opqq..qqnO...........',
  26: '...........Opqq..qqnO...........',
  27: '...........Opqq..qqnO...........',
  28: '..........Orssd..rssdO..........',
  29: '..........OdddO..OdddO..........',
});

// Left profile: toe points left, highlight stays on the left. The stance is
// mirrored on the right profile; only the toe and the nose/eye/mouth move.
export const BODY_SIDE_L = grid({
  16: '..............cbbc..............',
  17: '............OttttttO............',
  18: '...........OtuuuuuuvO...........',
  19: '...........OtuuuuuuvO...........',
  20: '...........OuuuuuuuvO...........',
  21: '...........OvvvvvvuvO...........',
  22: '...........ObbvvvvvvO...........',
  23: '...........ObbvvvvvvO...........',
  24: '...........OpqqqqnO.............',
  25: '...........OpqqqqnO.............',
  26: '...........OpqqqqnO.............',
  27: '...........OpqqqqnO.............',
  28: '.........OrrsssssdO.............',
  29: '.........OddddddddO.............',
});

// Right profile: mirrored stance, same top-left light (heel dark on the
// left, light steps on the left half, toe darker on the right).
export const BODY_SIDE_R = grid({
  16: '..............cbbc..............',
  17: '............OttttttO............',
  18: '...........OtuuuuuuvO...........',
  19: '...........OtuuuuuuvO...........',
  20: '...........OuuuuuuuvO...........',
  21: '...........OvvvvvvuvO...........',
  22: '...........ObbvvvvvvO...........',
  23: '...........ObbvvvvvvO...........',
  24: '.............OpqqqqnO...........',
  25: '.............OpqqqqnO...........',
  26: '.............OpqqqqnO...........',
  27: '.............OpqqqqnO...........',
  28: '.............OdrrsssddO.........',
  29: '.............OddddddddO.........',
});
