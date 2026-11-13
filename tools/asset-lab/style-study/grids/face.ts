// Shared calm face grids: 2px-high dark eyes, one small quiet mouth, one
// small profile nose per side view. The rear view carries nape skin only,
// never face pixels.

function grid(rows: Record<number, string>): string[] {
  const out = Array.from({ length: 32 }, () => '.'.repeat(32));
  for (const [y, row] of Object.entries(rows)) {
    if (row.length !== 32) throw new Error(`face row ${y} is ${row.length} chars`);
    out[Number(y)] = row;
  }
  return out;
}

// Front: lit left cheek, shaded right cheek, eyes at y11..12, mouth at y14.
export const FACE_FRONT = grid({
  9: '.........OabbbbbbbbbbcO.........',
  10: '.........OabbbbbbbbbbcO.........',
  11: '.........OaEEbbbbbbEEcO.........',
  12: '.........OaEEbbbbbbEEcO.........',
  13: '.........OabbbbbbbbbbcO.........',
  14: '.........OabbbbMMbbbbcO.........',
  15: '...........ObbbbbbbbO...........',
});

// Left profile: nose tip at x9, eye toward the front, mouth below it.
export const FACE_SIDE_L = grid({
  9: '..........Obbbbbbbbb............',
  10: '..........Obbbbbbbbb............',
  11: '.........OaaEEbbbbbc............',
  12: '.........caaEEbbbbbcO...........',
  13: '.........caabbbbbbbcO...........',
  14: '..........OMMbbbbbbcO...........',
  15: '............ObbbbbO.............',
});

// Right profile: same top-left light (lit back of head, shaded face front),
// single eye, nose tip at x22, mouth below it.
export const FACE_SIDE_R = grid({
  9: '............bbbbbbbbbO..........',
  10: '............bbbbbbbbbO..........',
  11: '...........OabbbbbEEbcO.........',
  12: '...........OabbbbbEEbcc.........',
  13: '...........Oabbbbbbbbcc.........',
  14: '...........ObbbbbbbMMcO.........',
  15: '..............ObbbbO............',
});

// Rear: a narrow shadow nape (darkest skin step only) below the hair
// mass, no eyes, no mouth, no nose. Hair layers may cover it.
export const FACE_REAR = grid({
  13: '..............cccc..............',
  14: '..............cccc..............',
  15: '..............cccc..............',
});
