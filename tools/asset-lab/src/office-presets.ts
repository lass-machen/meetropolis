import type { AssetId } from './assets.ts';
import type { OfficeId, OfficePreset, OfficeZone, PlacedAsset, Point, Workplace } from './office-model.ts';

interface WorkstationSet {
  placements: PlacedAsset[];
  workplace: Workplace;
}

const asset = (id: string, assetId: AssetId, x: number, y: number): PlacedAsset => ({
  id,
  asset: assetId,
  x,
  y,
});

const workstation = (office: OfficeId, slot: string, x: number, y: number): WorkstationSet => {
  const deskId = `${office}-${slot}-desk`;
  return {
    placements: [
      asset(deskId, 'compact_desk', x, y),
      asset(`${office}-${slot}-chair`, 'compact_chair_north', x + 16, y + 48),
      asset(`${office}-${slot}-drawer`, 'drawer', x + 48, y),
    ],
    workplace: { id: deskId, approach: { x: x + 24, y: y + 48 } },
  };
};

const workstations = (
  office: OfficeId,
  entries: Array<[string, number, number]>,
): {
  placements: PlacedAsset[];
  workplaces: Workplace[];
} => {
  const result = entries.map(([slot, x, y]) => workstation(office, slot, x, y));
  return {
    placements: result.flatMap((item) => item.placements),
    workplaces: result.map((item) => item.workplace),
  };
};

const wallColumn = (x: number, rows: number[]): Point[] => rows.map((y) => ({ x, y }));

const meetingSeats = (office: OfficeId, meeting: string, x: number, y: number, sides: boolean): PlacedAsset[] => {
  const seats = [
    asset(`${office}-${meeting}-seat-north-1`, 'compact_chair', x, y - 32),
    asset(`${office}-${meeting}-seat-north-2`, 'compact_chair', x + 48, y - 32),
    asset(`${office}-${meeting}-seat-south-1`, 'compact_chair_north', x, y + 48),
    asset(`${office}-${meeting}-seat-south-2`, 'compact_chair_north', x + 48, y + 48),
  ];
  if (sides) {
    seats.push(
      asset(`${office}-${meeting}-seat-west`, 'compact_chair_east', x - 16, y),
      asset(`${office}-${meeting}-seat-east`, 'compact_chair_west', x + 64, y),
    );
  }
  return seats;
};

const zone = (
  id: string,
  name: string,
  detail: string,
  kind: OfficeZone['kind'],
  x: number,
  y: number,
  w: number,
  h: number,
  entry: Point,
  surface?: OfficeZone['surface'],
): OfficeZone => ({
  id,
  name,
  detail,
  kind,
  x,
  y,
  w,
  h,
  entry,
  ...(surface ? { surface } : {}),
});

const loftWork = workstations('loft', [
  ['team-1', 96, 144],
  ['team-2', 256, 144],
  ['team-3', 96, 272],
  ['team-4', 256, 272],
  ['focus-1', 608, 144],
  ['focus-2', 768, 144],
]);

const loft: OfficePreset = {
  id: 'loft',
  name: 'Team-Loft',
  subtitle: 'Sechs Arbeitsplätze, kurze Wege und eine eigene Fokusnische',
  defaultTheme: 'holz',
  capacity: 6,
  world: { width: 960, height: 672, tile: 16 },
  bounds: { x: 32, y: 80, w: 896, h: 544 },
  spawn: { x: 480, y: 560 },
  placements: [
    ...loftWork.placements,
    asset('loft-door', 'door_open', 464, 576),
    asset('loft-window-west', 'window', 112, 32),
    asset('loft-window-east', 'window', 720, 32),
    asset('loft-coffee', 'compact_counter', 416, 96),
    asset('loft-lounge-sofa', 'compact_sofa', 96, 416),
    asset('loft-lounge-table', 'compact_table', 208, 448),
    asset('loft-meeting-table', 'compact_meeting_table', 704, 400),
    ...meetingSeats('loft', 'meeting', 704, 400, false),
    asset('loft-shelf', 'compact_shelf', 480, 448),
    asset('loft-divider', 'compact_divider', 512, 272),
    asset('loft-lamp', 'compact_floor_lamp', 64, 368),
    asset('loft-plant', 'planter', 320, 432),
    asset('loft-meeting-board', 'compact_whiteboard', 608, 352),
    asset('loft-meeting-plant', 'compact_plant', 832, 480),
    asset('loft-cabinet', 'cabinet', 448, 448),
    asset('loft-armchair', 'armchair', 256, 432),
    asset('loft-round-table', 'round_table', 288, 480),
    asset('loft-printer', 'printer', 352, 144),
    asset('loft-coat', 'coat_stand', 400, 512),
    asset('loft-water', 'water_cooler', 496, 96),
    asset('loft-pinboard', 'pinboard', 816, 352),
    asset('loft-lounge-bench', 'compact_bench', 112, 528),
  ],
  walls: [
    ...wallColumn(544, [112, 128, 144, 160, 176, 240, 256, 272, 288, 304]),
    ...wallColumn(880, [112, 128, 144, 160, 176, 224, 240]),
    ...[576, 592, 608, 624, 640, 656, 672, 688, 704, 720, 736, 752].map((x) => ({ x, y: 272 })),
    ...[64, 80, 96, 112, 128, 144, 160, 176, 240, 256, 272, 288, 304, 320, 336].map((x) => ({ x, y: 368 })),
  ],
  zones: [
    zone(
      'loft-team',
      'Teamfläche',
      'Vier Plätze für konzentriertes gemeinsames Arbeiten.',
      'work',
      64,
      112,
      352,
      240,
      { x: 384, y: 208 },
      'carpet',
    ),
    zone(
      'loft-focus',
      'Fokusnische',
      'Zwei ruhige Plätze abseits des Hauptwegs.',
      'focus',
      576,
      112,
      304,
      160,
      { x: 608, y: 208 },
      'carpet',
    ),
    zone(
      'loft-lounge',
      'Lounge',
      'Sofa und Tisch für kurze Pausen und Austausch.',
      'lounge',
      64,
      400,
      352,
      192,
      { x: 256, y: 512 },
      'carpet',
    ),
    zone(
      'loft-meeting',
      'Besprechung',
      'Ein abgeschirmter Tisch für vier Personen.',
      'meeting',
      576,
      352,
      304,
      240,
      { x: 608, y: 544 },
      'carpet',
    ),
    zone('loft-coffee-zone', 'Kaffee', 'Die Kaffeebar liegt am zentralen Übergang.', 'coffee', 416, 96, 128, 112, {
      x: 448,
      y: 160,
    }),
    zone('loft-arrival', 'Ankommen', 'Der Eingang öffnet sich direkt auf den Hauptweg.', 'arrival', 416, 544, 128, 64, {
      x: 480,
      y: 560,
    }),
  ],
  workplaces: loftWork.workplaces,
};

const studioWork = workstations('studio', [
  ['team-a-1', 96, 144],
  ['team-a-2', 240, 144],
  ['team-a-3', 96, 272],
  ['team-a-4', 240, 272],
  ['team-b-1', 96, 464],
  ['team-b-2', 240, 464],
  ['team-b-3', 96, 592],
  ['team-b-4', 240, 592],
  ['focus-1', 800, 144],
  ['focus-2', 944, 144],
  ['atelier-1', 800, 272],
  ['atelier-2', 944, 272],
]);

const studio: OfficePreset = {
  id: 'studio',
  name: 'Gartenstudio',
  subtitle: 'Zwölf Arbeitsplätze rund um eine grüne Mitte',
  defaultTheme: 'garten',
  capacity: 12,
  world: { width: 1120, height: 768, tile: 16 },
  bounds: { x: 32, y: 80, w: 1056, h: 640 },
  spawn: { x: 528, y: 656 },
  placements: [
    ...studioWork.placements,
    asset('studio-door', 'door_open', 512, 672),
    asset('studio-window-west', 'window', 176, 32),
    asset('studio-window-east', 'window', 864, 32),
    asset('studio-coffee', 'compact_counter', 512, 96),
    asset('studio-center-sofa', 'compact_sofa', 480, 560),
    asset('studio-center-table', 'compact_table', 720, 576),
    asset('studio-meeting-table', 'compact_meeting_table', 880, 480),
    ...meetingSeats('studio', 'meeting', 880, 480, true),
    asset('studio-plant-north', 'planter', 480, 224),
    asset('studio-plant-south', 'planter', 576, 448),
    asset('studio-shelf', 'compact_shelf', 656, 256),
    asset('studio-divider', 'compact_divider', 736, 304),
    asset('studio-meeting-board', 'compact_whiteboard', 960, 432),
    asset('studio-meeting-plant', 'compact_plant', 1024, 592),
    asset('studio-cabinet', 'cabinet', 592, 96),
    asset('studio-armchair', 'armchair', 608, 560),
    asset('studio-round-table', 'round_table', 560, 592),
    asset('studio-printer', 'printer', 336, 144),
    asset('studio-coat', 'coat_stand', 672, 640),
    asset('studio-water', 'water_cooler', 624, 96),
    asset('studio-pinboard', 'pinboard', 800, 352),
    asset('studio-garden-bench', 'compact_bench', 576, 336),
  ],
  walls: [
    ...wallColumn(
      400,
      [
        112, 128, 144, 160, 176, 192, 208, 224, 240, 304, 320, 336, 352, 368, 384, 400, 496, 512, 528, 544, 560, 576,
        592, 608, 624, 640,
      ],
    ),
    ...wallColumn(
      704,
      [
        112, 128, 144, 160, 176, 192, 208, 224, 240, 304, 320, 336, 352, 368, 384, 400, 496, 512, 528, 544, 560, 576,
        592, 608, 624, 640,
      ],
    ),
    ...wallColumn(752, [112, 128, 144, 208, 224]),
    ...wallColumn(1040, [112, 128, 144, 160, 176, 192, 208, 224]),
    ...[768, 784, 800, 816, 832, 848, 960, 976, 992, 1008, 1024].map((x) => ({
      x,
      y: 240,
    })),
  ],
  zones: [
    zone(
      'studio-team-a',
      'Team A',
      'Vier Plätze mit Blick auf die gemeinsame Mitte.',
      'work',
      64,
      112,
      288,
      304,
      { x: 320, y: 320 },
      'carpet',
    ),
    zone(
      'studio-team-b',
      'Team B',
      'Vier Plätze für längere Arbeitsblöcke.',
      'work',
      64,
      432,
      288,
      256,
      { x: 320, y: 512 },
      'carpet',
    ),
    zone(
      'studio-focus',
      'Fokusplätze',
      'Zwei der zwölf Plätze liegen in einer stillen Nische.',
      'focus',
      768,
      112,
      288,
      128,
      { x: 784, y: 176 },
      'carpet',
    ),
    zone(
      'studio-atelier',
      'Atelier',
      'Zwei weitere Plätze am hellen Rand des Gartens.',
      'work',
      768,
      256,
      288,
      160,
      { x: 784, y: 320 },
      'carpet',
    ),
    zone(
      'studio-meeting',
      'Besprechung',
      'Ein Tisch für sechs Personen.',
      'meeting',
      768,
      432,
      288,
      256,
      { x: 768, y: 560 },
      'carpet',
    ),
    zone(
      'studio-garden',
      'Grüne Mitte',
      'Pflanzen, Wege und eine gemeinsame Sitzinsel.',
      'lounge',
      432,
      208,
      224,
      368,
      { x: 544, y: 368 },
      'garden',
    ),
    zone(
      'studio-coffee',
      'Kaffee',
      'Kaffee und Lounge liegen am oberen Zugang zur Mitte.',
      'coffee',
      432,
      96,
      224,
      96,
      { x: 544, y: 160 },
    ),
    zone('studio-arrival', 'Ankommen', 'Der Eingang öffnet sich auf beide Rundwege.', 'arrival', 432, 624, 224, 80, {
      x: 528,
      y: 656,
    }),
  ],
  workplaces: studioWork.workplaces,
};

const campusWork = workstations('campus', [
  ['team-a-1', 96, 144],
  ['team-a-2', 272, 144],
  ['team-a-3', 96, 272],
  ['team-a-4', 272, 272],
  ['team-a-5', 96, 400],
  ['team-a-6', 272, 400],
  ['team-a-7', 96, 528],
  ['team-a-8', 272, 528],
  ['team-b-1', 992, 144],
  ['team-b-2', 1168, 144],
  ['team-b-3', 992, 272],
  ['team-b-4', 1168, 272],
  ['team-b-5', 992, 400],
  ['team-b-6', 1168, 400],
  ['team-b-7', 992, 528],
  ['team-b-8', 1168, 528],
  ['team-c-1', 96, 688],
  ['team-c-2', 240, 688],
  ['team-c-3', 384, 688],
  ['team-c-4', 528, 688],
  ['team-c-5', 816, 688],
  ['team-c-6', 960, 688],
  ['team-c-7', 1104, 688],
  ['team-c-8', 1248, 688],
]);

const campus: OfficePreset = {
  id: 'campus',
  name: 'Hofcampus',
  subtitle: 'Vierundzwanzig Arbeitsplätze in drei Teamflügeln',
  defaultTheme: 'abend',
  capacity: 24,
  world: { width: 1440, height: 896, tile: 16 },
  bounds: { x: 32, y: 80, w: 1376, h: 768 },
  spawn: { x: 720, y: 784 },
  placements: [
    ...campusWork.placements,
    asset('campus-door', 'door_open', 704, 800),
    asset('campus-window-west', 'window', 256, 32),
    asset('campus-window-east', 'window', 1120, 32),
    asset('campus-coffee', 'compact_counter', 672, 96),
    asset('campus-meeting-table', 'compact_meeting_table', 608, 240),
    ...meetingSeats('campus', 'meeting', 608, 240, true),
    asset('campus-retreat-sofa', 'compact_sofa', 608, 480),
    asset('campus-retreat-bench', 'compact_bench', 768, 528),
    asset('campus-shelf', 'compact_shelf', 832, 272),
    asset('campus-plant-west', 'plant_small', 544, 336),
    asset('campus-plant-east', 'plant_small', 832, 336),
    asset('campus-lamp', 'compact_floor_lamp', 576, 592),
    asset('campus-meeting-board', 'compact_whiteboard', 800, 208),
    asset('campus-court-planter-west', 'planter', 544, 400),
    asset('campus-cabinet', 'cabinet', 768, 96),
    asset('campus-armchair', 'armchair', 688, 480),
    asset('campus-round-table', 'round_table', 688, 528),
    asset('campus-printer', 'printer', 384, 144),
    asset('campus-coat', 'coat_stand', 864, 736),
    asset('campus-water', 'water_cooler', 800, 96),
    asset('campus-pinboard', 'pinboard', 560, 208),
    asset('campus-court-planter-east', 'planter', 832, 432),
  ],
  walls: [
    ...wallColumn(
      496,
      [
        112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 320, 336, 352, 368, 384, 400, 416, 432, 448, 464, 480, 496,
        512, 528, 544, 608, 624, 640, 656, 672, 688, 704, 720, 736, 752, 768,
      ],
    ),
    ...wallColumn(
      928,
      [
        112, 128, 144, 160, 176, 192, 208, 224, 240, 256, 320, 336, 352, 368, 384, 400, 416, 432, 448, 464, 480, 496,
        512, 528, 544, 608, 624, 640, 656, 672, 688, 704, 720, 736, 752, 768,
      ],
    ),
  ],
  zones: [
    zone(
      'campus-team-a',
      'Teamflügel A',
      'Acht Plätze für das erste Team.',
      'work',
      64,
      112,
      416,
      512,
      { x: 464, y: 320 },
      'carpet',
    ),
    zone(
      'campus-team-b',
      'Teamflügel B',
      'Acht Plätze für das zweite Team.',
      'work',
      960,
      112,
      416,
      512,
      { x: 960, y: 320 },
      'carpet',
    ),
    zone('campus-arrival', 'Ankommen', 'Der Eingang führt direkt in den Hof.', 'arrival', 624, 752, 192, 80, {
      x: 720,
      y: 784,
    }),
    zone(
      'campus-team-c',
      'Teamflügel C',
      'Acht Plätze über beide Seiten des Hofzugangs.',
      'work',
      64,
      672,
      1312,
      144,
      { x: 480, y: 800 },
      'carpet',
    ),
    zone(
      'campus-retreat',
      'Rückzug',
      'Eine ruhige Sitzinsel abseits der Laufachsen.',
      'lounge',
      528,
      448,
      384,
      176,
      { x: 720, y: 608 },
      'carpet',
    ),
    zone(
      'campus-court',
      'Hof',
      'Der begrünte Hof verbindet die drei Flügel.',
      'lounge',
      528,
      320,
      384,
      128,
      { x: 720, y: 368 },
      'garden',
    ),
    zone('campus-coffee', 'Café', 'Kaffee und Ankommen liegen am oberen Hofrand.', 'coffee', 608, 96, 224, 112, {
      x: 720,
      y: 160,
    }),
    zone(
      'campus-meeting',
      'Besprechung',
      'Ein zentraler Tisch für sechs Personen.',
      'meeting',
      528,
      208,
      384,
      112,
      { x: 720, y: 224 },
      'carpet',
    ),
  ],
  workplaces: campusWork.workplaces,
};

export const officePresets: Record<OfficeId, OfficePreset> = {
  loft,
  studio,
  campus,
};

export const officeList = Object.values(officePresets);
