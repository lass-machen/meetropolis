// The four fixed study recipes and the after-state composer. Every figure
// shares clothing (trousers, hoodie_blue, dark pants, brown shoes) and the
// calm face; only skin, hairstyle and hair color vary. Layers stack as
// body, then face, then hair, so hair always covers what it should.

import { BODY_FRONT, BODY_REAR, BODY_SIDE_L, BODY_SIDE_R } from './grids/body.ts';
import { FACE_FRONT, FACE_REAR, FACE_SIDE_L, FACE_SIDE_R } from './grids/face.ts';
import {
  HAIR_FRONT as BOB_FRONT,
  HAIR_REAR as BOB_REAR,
  HAIR_SIDE_L as BOB_SIDE_L,
  HAIR_SIDE_R as BOB_SIDE_R,
} from './grids/hair-bob.ts';
import {
  HAIR_FRONT as CURLY_FRONT,
  HAIR_REAR as CURLY_REAR,
  HAIR_SIDE_L as CURLY_SIDE_L,
  HAIR_SIDE_R as CURLY_SIDE_R,
} from './grids/hair-curly.ts';
import {
  HAIR_FRONT as PONY_FRONT,
  HAIR_REAR as PONY_REAR,
  HAIR_SIDE_L as PONY_SIDE_L,
  HAIR_SIDE_R as PONY_SIDE_R,
} from './grids/hair-ponytail.ts';
import {
  HAIR_FRONT as PART_FRONT,
  HAIR_REAR as PART_REAR,
  HAIR_SIDE_L as PART_SIDE_L,
  HAIR_SIDE_R as PART_SIDE_R,
} from './grids/hair-side_part.ts';

export type Direction = 'front' | 'left' | 'right' | 'rear';

export const DIRECTIONS: Direction[] = ['front', 'left', 'right', 'rear'];

export const DIRECTION_LABELS: Record<Direction, string> = {
  front: 'vorne',
  left: 'links',
  right: 'rechts',
  rear: 'hinten',
};

export interface FigureRecipe {
  id: string;
  label: string;
  skin: string;
  hair: string;
  hairColor: string;
}

// Four fixed recipes: same clothing and calm face, four skin tones and
// four hairstyles. Recipe colors match the catalog before-state exactly.
export const FIGURES: FigureRecipe[] = [
  { id: 'fig1', label: 'hell · Seitenscheitel · braun', skin: 'light', hair: 'side_part', hairColor: 'braun' },
  { id: 'fig2', label: 'medium · Bob · rot', skin: 'medium', hair: 'bob', hairColor: 'rot' },
  { id: 'fig3', label: 'tan · Locken · schwarz', skin: 'tan', hair: 'curly', hairColor: 'schwarz' },
  { id: 'fig4', label: 'dark · Pferdeschwanz · schwarz', skin: 'dark', hair: 'ponytail', hairColor: 'schwarz' },
];

const HAIR: Record<string, Record<Direction, string[]>> = {
  side_part: { front: PART_FRONT, left: PART_SIDE_L, right: PART_SIDE_R, rear: PART_REAR },
  bob: { front: BOB_FRONT, left: BOB_SIDE_L, right: BOB_SIDE_R, rear: BOB_REAR },
  curly: { front: CURLY_FRONT, left: CURLY_SIDE_L, right: CURLY_SIDE_R, rear: CURLY_REAR },
  ponytail: { front: PONY_FRONT, left: PONY_SIDE_L, right: PONY_SIDE_R, rear: PONY_REAR },
};

const BODY: Record<Direction, string[]> = {
  front: BODY_FRONT,
  left: BODY_SIDE_L,
  right: BODY_SIDE_R,
  rear: BODY_REAR,
};

const FACE: Record<Direction, string[]> = {
  front: FACE_FRONT,
  left: FACE_SIDE_L,
  right: FACE_SIDE_R,
  rear: FACE_REAR,
};

// Overlay body, face and hair additively: later layers win on non '.' cells.
export function composeAfter(recipe: FigureRecipe, direction: Direction): string[] {
  const hair = HAIR[recipe.hair]?.[direction];
  if (!hair) throw new Error(`unknown hair: ${recipe.hair}`);
  const body = BODY[direction];
  const face = FACE[direction];
  return body.map((bodyRow, y) => {
    const faceRow = face[y];
    const hairRow = hair[y];
    return [...bodyRow]
      .map((cell, x) => {
        if (hairRow[x] !== '.') return hairRow[x];
        if (faceRow[x] !== '.') return faceRow[x];
        return cell;
      })
      .join('');
  });
}
