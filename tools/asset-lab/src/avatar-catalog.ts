import { CATALOG_SCHEMA_V6, type SpriteCatalog } from '../../../packages/shared/src/sprite/types.ts';
import { addAccessories } from './avatar-accessories.ts';
import { createProportionCatalog, proportions, type ProportionId } from './avatar-proportions.ts';

export const faceNames = {
  ruhig: 'Ruhig',
  freundlich: 'Freundlich',
  wach: 'Wach',
} as const;
export type FaceId = keyof typeof faceNames;

const coveredHats = ['cap', 'cowboy', 'zylinder', 'bierhelm', 'beanie', 'fedora', 'propeller', 'cat'];

function grid(points: [number, number, string][]): string[] {
  const rows = Array.from({ length: 32 }, () => Array<string>(32).fill('.'));
  for (const [x, y, pixels] of points) {
    [...pixels].forEach((pixel, dx) => {
      rows[y][x + dx] = pixel;
    });
  }
  return rows.map((row) => row.join(''));
}

function addFaces(catalog: SpriteCatalog): void {
  catalog.catalogs.lab_faces = {
    ruhig: {
      front: grid([
        [12, 11, 'RR....RR'],
        [12, 13, 'EE....EE'],
        [12, 14, 'EE....EE'],
        [15, 16, 'MM'],
      ]),
      side: grid([
        [10, 11, 'RR'],
        [10, 13, 'EE'],
        [10, 14, 'EE'],
        [10, 16, 'M'],
      ]),
    },
    freundlich: {
      front: grid([
        [12, 11, 'RR....RR'],
        [12, 13, 'EE....EE'],
        [12, 14, 'EW....WE'],
        [14, 16, 'M..M'],
        [15, 17, 'MM'],
      ]),
      side: grid([
        [10, 11, 'RR'],
        [10, 13, 'EE'],
        [10, 14, 'WE'],
        [10, 16, 'MM'],
        [11, 17, 'M'],
      ]),
    },
    wach: {
      front: grid([
        [12, 10, 'RRR..RRR'],
        [12, 12, 'EE....EE'],
        [12, 13, 'EW....WE'],
        [12, 14, 'EE....EE'],
        [15, 16, 'MM'],
      ]),
      side: grid([
        [10, 10, 'RRR'],
        [10, 12, 'EE'],
        [10, 13, 'WE'],
        [10, 14, 'EE'],
        [10, 16, 'M'],
      ]),
    },
  };
  catalog.compose.base_kit.face_front = 'lab_faces.{face}.front';
  catalog.compose.base_kit.face_side = 'lab_faces.{face}.side';
}

function deepDifference(base: unknown, value: unknown): unknown {
  if (Object.is(base, value)) return undefined;
  if (Array.isArray(base) || Array.isArray(value)) {
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  }
  if (typeof base !== 'object' || base === null || typeof value !== 'object' || value === null) return value;
  const difference: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const changed = deepDifference((base as Record<string, unknown>)[key], child);
    if (changed !== undefined) difference[key] = changed;
  }
  return Object.keys(difference).length === 0 ? undefined : difference;
}

/** Build the generated v6 artifact from the Atelier's single raster source. */
export function buildAtelierCatalog(input: unknown): SpriteCatalog {
  const catalog = structuredClone(input) as SpriteCatalog;
  delete (catalog as Partial<SpriteCatalog>).variants;
  catalog.schema = CATALOG_SCHEMA_V6;
  addAccessories(catalog);
  catalog.palettes.beard = {
    ...(catalog.palettes.beard as Record<string, Record<string, string>>),
    rot: {
      e: (catalog.palettes.hair as Record<string, Record<string, string>>).rot.h,
      f: (catalog.palettes.hair as Record<string, Record<string, string>>).rot.i,
      g: (catalog.palettes.hair as Record<string, Record<string, string>>).rot.j,
    },
  };
  const beardColors = catalog.compose.config_fields.beard_color.values;
  if (!beardColors.includes('rot')) beardColors.push('rot');
  addFaces(catalog);
  catalog.compose.config_fields.face = { required: true, default: 'ruhig', values: Object.keys(faceNames) };
  catalog.compose.config_fields.proportion = {
    required: true,
    default: 'kompakt',
    values: Object.keys(proportions),
  };

  const overlays: Record<string, Record<string, unknown>> = {};
  for (const proportion of Object.keys(proportions) as ProportionId[]) {
    overlays[proportion] = {};
    for (const [state, covered] of [
      ['uncovered', false],
      ['covered', true],
    ] as const) {
      const generated = createProportionCatalog(catalog, proportion, covered);
      overlays[proportion][state] = deepDifference(catalog, generated) ?? {};
    }
  }
  catalog.variants = {
    proportion: {
      default: 'kompakt',
      values: Object.keys(proportions),
      overlays,
      state_field: 'hat',
      state_values: Object.fromEntries(coveredHats.map((hat) => [hat, 'covered'])),
      default_state: 'uncovered',
    },
  };
  return catalog;
}
