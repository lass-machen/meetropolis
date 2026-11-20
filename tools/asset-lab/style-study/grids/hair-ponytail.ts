// ponytail in schwarz: sleek bound cap, tail tied at the back of the head,
// long centered tail down the nape onto the upper back in the rear view.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`ponytail row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: smooth bound mass with no parting and no side tail; the tail is
// hidden behind the head from the front.
export const HAIR_FRONT = grid({
  4: '............hhhhhhhh............',
  5: '...........ihhhhhhhhi...........',
  6: '..........OihhhhhiijiO..........',
  7: '.........OihhhhiiijjiO..........',
  8: '.........OjiiiiiiiijjiO.........',
});

// Left profile: tail tied at the back of the head, hanging just behind it.
export const HAIR_SIDE_L = grid({
  4: '............hhhhhhh.............',
  5: '..........ihhhhhhhhhi...........',
  6: '.........OihhhhhhhhiijO.........',
  7: '.........OiiiiiiiiiijjO.........',
  8: '.........OjiiiiiiiijjO..........',
  9: '.........OiiiiiiiijjijO.........',
  10: '..........OiiiiiiiijijO.........',
  11: '....................ijO.........',
  12: '....................ijO.........',
  13: '....................ijO.........',
  14: '....................ijO.........',
  15: '...................ij...........',
});

// Right profile: mirrored tie at the back of the head.
export const HAIR_SIDE_R = grid({
  4: '.............hhhhhhh............',
  5: '...........ihhhhhhhhhi..........',
  6: '..........OjiihhhhhhhhiO........',
  7: '..........OjjiiiiiiiiiiO........',
  8: '..........OjjiiiiiiiijO.........',
  9: '.........OijjiiiiiiiiiO.........',
  10: '.........OjijiiiiiiiiO..........',
  11: '.........Oij....................',
  12: '.........Oij....................',
  13: '.........Oij....................',
  14: '.........Oij....................',
  15: '..........ij....................',
});

// Rear: cap with a tie band at y11, root at y12 and a centered tail over
// the nape down to a rounded tip at y20.
export const HAIR_REAR = grid({
  4: '............hhhhhhhh............',
  5: '...........ihhhhhhhhi...........',
  6: '..........OihhhhhiijiO..........',
  7: '..........OiiiiiiiijjO..........',
  8: '..........OiiiiiiiijjO..........',
  9: '..........OiiiiiiiijjO..........',
  10: '...........OiiiiiiijO...........',
  11: '............OjjjjiiO............',
  12: '.............OiijjO.............',
  13: '.............OhiijO.............',
  14: '.............OhiijO.............',
  15: '.............OhiijO.............',
  16: '.............OhiijO.............',
  17: '.............OhiijO.............',
  18: '.............OhiijO.............',
  19: '..............iijj..............',
  20: '...............ij...............',
});
