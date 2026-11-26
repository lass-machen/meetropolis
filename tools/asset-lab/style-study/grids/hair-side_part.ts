// side_part in braun: asymmetric swept hair with a visible parting line,
// a deeper fringe on the swept side and a rounded closed rear mass.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`side_part row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: parting slit at x13 across y5..y8, mass swept to the right with a
// deeper fringe (y9) on that side, left forehead stays visible.
export const HAIR_FRONT = grid({
  4: '...........hhhhhhhh.............',
  5: '..........ihhjhhhhhhii..........',
  6: '.........OihhjiiiiijiiO.........',
  7: '.........OihhjiiiiijjiO.........',
  8: '............jjiiiiijjiO.........',
  9: '...................ijj..........',
});

// Left profile: parting near the front, sweep falling toward the back with
// a deeper back hairline; the eye stays clear.
export const HAIR_SIDE_L = grid({
  4: '............hhhhhhh.............',
  5: '..........ijjhhhhhhii...........',
  6: '.........OijjiiiiiijiO..........',
  7: '.........OijjiiiiijjiO..........',
  8: '...........jjiiiiijjiO..........',
  9: '...................ijjO.........',
  10: '...................ijjO.........',
  11: '...................ijj..........',
});

// Right profile: same sweep seen from the heavy side, deeper front fringe
// ending in a rounded point beside the temple; the eye stays clear.
export const HAIR_SIDE_R = grid({
  4: '.............hhhhhhh............',
  5: '...........ihhhhjjhhi...........',
  6: '..........OihhhhjjhiiO..........',
  7: '..........OihhhjjjiijO..........',
  8: '..........OihhhiiijjjO..........',
  9: '....................jjjO........',
  10: '....................jjjO........',
  11: '......................j.........',
});

// Rear: closed rounded mass down to y13, narrow shadow nape below it.
export const HAIR_REAR = grid({
  4: '............hhhhhhhh............',
  5: '...........ihhhhhhhhi...........',
  6: '..........OihhhhhiijiO..........',
  7: '.........OihhhhiiiijiiO.........',
  8: '.........OiiiiiiiiijjiO.........',
  9: '..........OiiiiiiiijiO..........',
  10: '..........OiiiiiiijiiO..........',
  11: '...........OiiiiiijiO...........',
  12: '...........OiiiiiijiO...........',
  13: '............OiiiijiO............',
});
