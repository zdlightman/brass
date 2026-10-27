/** A sprite on tiles.png (1033×1033). Box is the opaque tile, measured from the sheet. */
export type TileBox = readonly [number, number, number, number];

export const TILE_SHEET = { src: '/game/tiles.png', w: 1033, h: 1033 } as const;

/** Four player-color plates, left to right: blue, purple, red, gold. */
export const TILE_BACKS = { src: '/game/tiles-backgrounds.jpg', count: 4 } as const;

/**
 * BGA draws an unflipped tile as one cell of this 7×7 sheet:
 * background-size 700% 700%, position (column / 6) (row / 6).
 * Measured on the buildable overview, state 0, 58×58.
 */
const TILE_GRID = 7;
const TILE_CELL = TILE_SHEET.w / TILE_GRID;
function tileCell(column: number, row: number): TileBox {
  return [column * TILE_CELL, row * TILE_CELL, TILE_CELL, TILE_CELL];
}

/** Each box is one level's art. The five exposed tiles use the unflipped grid cell. */
const SPRITE = {
  kerosene2: tileCell(1, 6),
  kerosene3: tileCell(6, 2),
  kerosene4: tileCell(3, 4),
  oilCity: [309, 744, 136, 132],
  coal1: tileCell(0, 6),
  coal2: tileCell(0, 0),
  coal3: tileCell(1, 0),
  manufacturing1: tileCell(1, 3),
  manufacturing2: tileCell(2, 3),
  manufacturing3: [451, 455, 132, 126],
  manufacturing4: tileCell(6, 3),
  manufacturing5: [593, 449, 141, 126],
  coke1: tileCell(3, 0),
  coke2: [603, 12, 122, 122],
  bessemer1: tileCell(4, 1),
  bessemer2: tileCell(5, 1),
  bessemer4: tileCell(6, 1),
  car: [12, 596, 131, 123],
  locomotive: [748, 443, 135, 141],
  alternator: [305, 9, 133, 132],
  skyscraper3: [745, 303, 136, 132],
  skyscraper5: tileCell(1, 2),
} as const satisfies Record<string, TileBox>;

/** player-mat.jpg is 2129×1517. Slot is the tile window, not the side banners. */
export const MAT_SIZE = { w: 2129, h: 1517 } as const;

export type MatSlot = { x: number; y: number; w: number; h: number };

export type MatStack = {
  id: string;
  industry: string;
  level: string;
  count: number;
  box: TileBox;
  slot: MatSlot;
  /** Exposed at the start of the game, so it appears on the build row. */
  exposed?: boolean;
};

/**
 * Counts are the V52 player-mat quantities already read from the live table.
 * Costs and VP are painted on the tile art; they are not in this list.
 */
export const MAT_COLUMNS: { name: string; stacks: MatStack[] }[] = [
  {
    name: '煤油',
    stacks: [
      { id: 'kero-2', industry: '煤油', level: 'II', count: 2, box: SPRITE.kerosene2, slot: { x: 109, y: 1153, w: 182, h: 182 }, exposed: true },
      { id: 'kero-3', industry: '煤油', level: 'III', count: 3, box: SPRITE.kerosene3, slot: { x: 109, y: 780, w: 182, h: 182 } },
      { id: 'kero-4', industry: '煤油', level: 'IV', count: 2, box: SPRITE.kerosene4, slot: { x: 109, y: 537, w: 182, h: 182 } },
      { id: 'oil-city', industry: '油城', level: 'V', count: 1, box: SPRITE.oilCity, slot: { x: 109, y: 164, w: 182, h: 182 } },
    ],
  },
  {
    name: '煤矿',
    stacks: [
      { id: 'coal-1', industry: '煤矿', level: 'I', count: 1, box: SPRITE.coal1, slot: { x: 457, y: 1212, w: 182, h: 182 }, exposed: true },
      { id: 'coal-2', industry: '煤矿', level: 'II', count: 2, box: SPRITE.coal2, slot: { x: 457, y: 965, w: 182, h: 182 } },
      { id: 'coal-3', industry: '煤矿', level: 'III', count: 2, box: SPRITE.coal3, slot: { x: 457, y: 540, w: 182, h: 182 } },
    ],
  },
  {
    name: '制造',
    stacks: [
      { id: 'mfg-1', industry: '制造', level: 'I', count: 2, box: SPRITE.manufacturing1, slot: { x: 830, y: 1245, w: 182, h: 182 }, exposed: true },
      { id: 'mfg-2', industry: '制造', level: 'II', count: 1, box: SPRITE.manufacturing2, slot: { x: 830, y: 978, w: 182, h: 182 } },
      { id: 'mfg-3', industry: '制造', level: 'III', count: 2, box: SPRITE.manufacturing3, slot: { x: 830, y: 543, w: 182, h: 182 } },
      { id: 'mfg-4', industry: '制造', level: 'IV', count: 1, box: SPRITE.manufacturing4, slot: { x: 1197, y: 543, w: 182, h: 182 } },
      { id: 'mfg-5', industry: '制造', level: 'V', count: 2, box: SPRITE.manufacturing5, slot: { x: 830, y: 285, w: 182, h: 182 } },
      { id: 'car-6', industry: '汽车', level: 'VI', count: 3, box: SPRITE.car, slot: { x: 1200, y: 36, w: 182, h: 182 } },
      { id: 'loco-7', industry: '机车', level: 'VII', count: 1, box: SPRITE.locomotive, slot: { x: 830, y: 36, w: 182, h: 182 } },
      { id: 'alt-4', industry: '发电机', level: 'IV', count: 1, box: SPRITE.alternator, slot: { x: 457, y: 127, w: 182, h: 182 } },
    ],
  },
  {
    name: '焦炭',
    stacks: [
      { id: 'coke-1', industry: '焦炭', level: 'I', count: 1, box: SPRITE.coke1, slot: { x: 1196, y: 1235, w: 182, h: 182 }, exposed: true },
      { id: 'coke-2', industry: '焦炭', level: 'II', count: 2, box: SPRITE.coke2, slot: { x: 1196, y: 985, w: 182, h: 182 } },
    ],
  },
  {
    name: '钢铁',
    stacks: [
      { id: 'steel-1', industry: '炼钢', level: 'I', count: 1, box: SPRITE.bessemer1, slot: { x: 1555, y: 1141, w: 182, h: 182 }, exposed: true },
      { id: 'steel-2', industry: '炼钢', level: 'II', count: 2, box: SPRITE.bessemer2, slot: { x: 1555, y: 731, w: 182, h: 182 } },
      { id: 'steel-4', industry: '炼钢', level: 'IV', count: 2, box: SPRITE.bessemer4, slot: { x: 1555, y: 287, w: 182, h: 182 } },
      { id: 'sky-3', industry: '摩天楼', level: 'III', count: 1, box: SPRITE.skyscraper3, slot: { x: 1914, y: 731, w: 182, h: 182 } },
      { id: 'sky-5', industry: '摩天楼', level: 'V', count: 1, box: SPRITE.skyscraper5, slot: { x: 1914, y: 287, w: 182, h: 182 } },
    ],
  },
];

export const EXPOSED_TILES: MatStack[] = MAT_COLUMNS.flatMap((column) =>
  column.stacks.filter((stack) => stack.exposed),
);

/**
 * BGA's build row is a crop of player-mat.jpg, not a calculated caption.
 * Positions are the overview background-position at a 1403px-wide mat, box 215×133.
 */
export const OVERVIEW_SHEET = { width: 1403, boxW: 215, boxH: 133 } as const;

export const OVERVIEW_POS: Record<string, { x: number; y: number }> = {
  'kero-2': { x: -20, y: -751 },
  'kero-3': { x: -20, y: -505 },
  'kero-4': { x: -20, y: -342 },
  'oil-city': { x: -20, y: -96 },
  'coal-1': { x: -249, y: -787 },
  'coal-2': { x: -249, y: -624 },
  'coal-3': { x: -249, y: -344 },
  'alt-4': { x: -249, y: -72 },
  'mfg-1': { x: -495, y: -809 },
  'mfg-2': { x: -495, y: -633 },
  'mfg-3': { x: -495, y: -346 },
  'mfg-4': { x: -737, y: -346 },
  'mfg-5': { x: -495, y: -176 },
  'car-6': { x: -739, y: -12 },
  'loco-7': { x: -495, y: -12 },
  'coke-1': { x: -736, y: -802 },
  'coke-2': { x: -736, y: -637 },
  'steel-1': { x: -973, y: -740 },
  'steel-2': { x: -973, y: -470 },
  'steel-4': { x: -973, y: -177 },
  'sky-3': { x: -1209, y: -470 },
  'sky-5': { x: -1209, y: -177 },
};

/** Build-row stack → the tile definition that picture represents. */
export const STACK_TILE: Record<string, string> = {
  'kero-2': 'k2',
  'kero-3': 'k3',
  'kero-4': 'k4',
  'oil-city': 'oilCity',
  'coal-1': 'c1',
  'coal-2': 'c2',
  'coal-3': 'c3',
  'alt-4': 'polyphase',
  'mfg-1': 'm1',
  'mfg-2': 'm2',
  'mfg-3': 'm3',
  'mfg-4': 'm4',
  'mfg-5': 'm5',
  'car-6': 'a1',
  'loco-7': 'locomotive',
  'coke-1': 'ck1',
  'coke-2': 'ck2',
  'steel-1': 'i1',
  'steel-2': 's2',
  'steel-4': 's4',
  'sky-3': 'sky1',
  'sky-5': 'sky2',
};

/** Tile definition → the sprite box, for industries whose art was measured. */
export const TILE_ART: Record<string, TileBox> = {
  k2: SPRITE.kerosene2,
  k3: SPRITE.kerosene3,
  k4: SPRITE.kerosene4,
  oilCity: SPRITE.oilCity,
  c1: SPRITE.coal1,
  c2: SPRITE.coal2,
  c3: SPRITE.coal3,
  m1: SPRITE.manufacturing1,
  m2: SPRITE.manufacturing2,
  m3: SPRITE.manufacturing3,
  m4: SPRITE.manufacturing4,
  m5: SPRITE.manufacturing5,
  ck1: SPRITE.coke1,
  ck2: SPRITE.coke2,
  i1: SPRITE.bessemer1,
  s2: SPRITE.bessemer2,
  s4: SPRITE.bessemer4,
  locomotive: SPRITE.locomotive,
  polyphase: SPRITE.alternator,
  a1: SPRITE.car,
};

/**
 * Flipped face of the same tile on tiles.png.
 * Paired with the unflipped cell by the picture and the roman level.
 */
export const FLIPPED_ART: Record<string, TileBox> = {
  c1: tileCell(5, 0),
  c2: tileCell(6, 0),
  c3: tileCell(0, 1),
  k2: tileCell(3, 5),
  k3: tileCell(4, 5),
  k4: tileCell(5, 5),
  oilCity: tileCell(6, 5),
  m1: tileCell(1, 4),
  m2: tileCell(2, 4),
  m3: tileCell(4, 4),
  m4: tileCell(0, 5),
  m5: tileCell(5, 4),
  ck1: tileCell(2, 1),
  ck2: tileCell(3, 1),
  i1: tileCell(2, 2),
  s2: tileCell(3, 2),
  s4: tileCell(4, 2),
  a1: tileCell(1, 5),
  locomotive: tileCell(6, 4),
  polyphase: tileCell(1, 1),
};

/**
 * Which locked piece sits on each measured bar.
 * The piece leaves the mat when this key is no longer in the player's locked list.
 */
export const MAT_LINK_LOCK: Record<string, string> = {
  'link-coalMine-2': 'heavy-whiskey',
  'link-coalMine-3': 'heavy-score',
  'link-manufacturer-2': 'heavy-oil',
  'link-cokeIndustry-2': 'heavy-coke',
  'link-bessemer-2': 'heavy-swap',
  'link-kerosene-2': 'pipe-4',
  'link-kerosene-4': 'pipe-7',
  'link-bessemer-1': 'pipe-3',
  'link-manufacturer-4': 'pipe-10',
};

/** Heavy-train and pipeline bars measured on the open BGA player mat. */
export const MAT_LINKS: { id: string; token: string; slot: MatSlot }[] = [
  { id: 'link-coalMine-2', token: 'whiskey', slot: { x: 434, y: 792, w: 220, h: 121 } },
  { id: 'link-coalMine-3', token: 'score', slot: { x: 434, y: 369, w: 220, h: 121 } },
  { id: 'link-manufacturer-2', token: 'oil', slot: { x: 797, y: 792, w: 220, h: 121 } },
  { id: 'link-cokeIndustry-2', token: 'coke', slot: { x: 1184, y: 792, w: 220, h: 121 } },
  { id: 'link-bessemer-2', token: 'swap', slot: { x: 1534, y: 546, w: 220, h: 121 } },
  { id: 'link-kerosene-2', token: 'points4', slot: { x: 83, y: 1015, w: 220, h: 91 } },
  { id: 'link-kerosene-4', token: 'points7', slot: { x: 83, y: 396, w: 220, h: 91 } },
  { id: 'link-bessemer-1', token: 'points3', slot: { x: 1539, y: 981, w: 220, h: 91 } },
  { id: 'link-manufacturer-4', token: 'money10', slot: { x: 1173, y: 329, w: 220, h: 91 } },
];
