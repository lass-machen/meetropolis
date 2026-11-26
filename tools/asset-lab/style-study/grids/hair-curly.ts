// curly in schwarz: rounded lobed volume with stepped bumps, light curl
// crowns and shaded valleys, closed rounded rear mass to y13.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`curly row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: twin crowns up top, lobed sides framing the forehead, both eyes
// and the mouth stay clear.
export const HAIR_FRONT = grid({
  4: '...........hhiihhiihh...........',
  5: '..........OhhiihhiihhO..........',
  6: '.........OihhijiihhiijiO........',
  7: '.........OjihhiijihhijO.........',
  8: '........OihhiiiiiijjiiiO........',
  9: '........OihiiiiiiiihiijO........',
  10: '........Oji..........ijO........',
  11: '.........Oj..........jO.........',
  12: '..........j..........j..........',
});

// Left profile: round lobed volume with a back lobe down to y12; the eye
// and the profile stay clear.
export const HAIR_SIDE_L = grid({
  4: '...........hhiihhiih............',
  5: '..........OhhiihhiijO...........',
  6: '.........OihhijihhiijO..........',
  7: '.........OjihhiijhhijO..........',
  8: '........OihhiiiiiijjiijO........',
  9: '........Oih.......iijjO.........',
  10: '........ij......iijjiO..........',
  11: '..................ijji..........',
  12: '..................jji...........',
});

// Right profile: mirrored lobed volume, eye and profile clear.
export const HAIR_SIDE_R = grid({
  4: '............hhiihhiih...........',
  5: '...........OihhiihhjiO..........',
  6: '..........OjihhijihhiiO.........',
  7: '..........OihhiijhhijjO.........',
  8: '.........OjiijjiiiiihhiO........',
  9: '.........Oijj......hijO.........',
  10: '.........Oiijj..................',
  11: '..........ijji..................',
  12: '...........ji...................',
});

// Rear: closed lobed cloud down to y13, narrow shadow nape below it.
export const HAIR_REAR = grid({
  4: '...........hhiihhiihh...........',
  5: '..........OhhiihhiihhO..........',
  6: '.........OihhijiihhiijiO........',
  7: '........OihhijiihhiijhiO........',
  8: '........OjihhiijhhiijiiO........',
  9: '........OihhiiiiiiijjiiO........',
  10: '.........OijhiiiiiijjiO.........',
  11: '.........OjiiiiiiijjiiO.........',
  12: '..........OjiiiiiijjiO..........',
  13: '............OiiiijiO............',
});
