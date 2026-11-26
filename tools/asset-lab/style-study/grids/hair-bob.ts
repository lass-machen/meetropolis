// bob in rot: one connected chin-length outline, side masses framing the
// face, rounded inward-stepped ends and a closed rounded rear mass.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`bob row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: side masses at x8..x10 and x21..x23 join the cap and curve inward
// to the chin at y15; both eyes and the mouth stay clear.
export const HAIR_FRONT = grid({
  4: '............hhhhhhhh............',
  5: '...........ihhhhhhhhi...........',
  6: '.........OihhhhhhhhhiiO.........',
  7: '........OjiiiiiiiijjiiiO........',
  8: '........OjjiiiiiiijjiiiO........',
  9: '........Oji..........ijO........',
  10: '........Oji..........ijO........',
  11: '........Oji..........ijO........',
  12: '........Oji..........ijO........',
  13: '........Ojj..........jjO........',
  14: '........Ojj..........jjO........',
  15: '..........ji........ij..........',
});

// Left profile: back mass runs connected down to chin height with an inward
// step at the bottom; eye and profile stay clear.
export const HAIR_SIDE_L = grid({
  4: '...........hhhhhhhhh............',
  5: '..........ihhhhhhhhhi...........',
  6: '.........OihhhhhhiijiO..........',
  7: '........OjiiiiiiiijjiiO.........',
  8: '.........Oj......iijjiO.........',
  9: '..................ijjiO.........',
  10: '..................ijjiO.........',
  11: '..................ijjiO.........',
  12: '..................ijjiO.........',
  13: '..................ijjiO.........',
  14: '...................jji..........',
  15: '....................ji..........',
});

// Right profile: mirrored back mass on the left, eye and profile clear.
export const HAIR_SIDE_R = grid({
  4: '............hhhhhhhhh...........',
  5: '...........ihhhhhhhhhi..........',
  6: '..........OijhhhhhiiiiiO........',
  7: '.........OijiiiiiiijjiiO........',
  8: '.........Oijj...................',
  9: '.........Oijj...................',
  10: '.........Oijj...................',
  11: '.........Oijj...................',
  12: '.........Oijj...................',
  13: '.........Oijj...................',
  14: '..........jji...................',
  15: '...........ji...................',
});

// Rear: broad closed mass down to y15 with a slight inward step at the
// bottom corners; no bare nape shows under the cap.
export const HAIR_REAR = grid({
  4: '...........hhhhhhhhhh...........',
  5: '..........ihhhhhhhhhhi..........',
  6: '.........OihhhhhhhijjiO.........',
  7: '.........OjiiiiiiiiiijiO........',
  8: '.........OjiiiiiiiiiijjO........',
  9: '.........OjiiiiiiiiiijjO........',
  10: '.........OjiiiiiiiiiijjO........',
  11: '.........OjiiiiiiiiiijjO........',
  12: '.........OjiiiiiiiiiijjO........',
  13: '.........OjiiiiiiiiiijjO........',
  14: '..........OjiiiiiiiijO..........',
  15: '...........jiiiiiiiij...........',
});
