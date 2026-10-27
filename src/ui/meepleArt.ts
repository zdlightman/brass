/** Crops of public/game/meeples.png (1273×1166), from BGA background-position. */
export type SpriteBox = { x: number; y: number; w: number; h: number };

export const MEEPLE_SHEET = { href: '/game/meeples.png', w: 1273, h: 1166 };

export const CUBE_SPRITE: Record<'coal' | 'iron' | 'coke' | 'steel', SpriteBox> = {
  coal: { x: 966, y: 740, w: 184, h: 184 },
  iron: { x: 778, y: 740, w: 184, h: 184 },
  coke: { x: 402, y: 740, w: 184, h: 184 },
  steel: { x: 590, y: 740, w: 184, h: 184 },
};

export const TRAIN_SPRITE = {
  light: { x: 885, y: 315, w: 203, h: 81 },
  steel: { x: 885, y: 230, w: 203, h: 81 },
  whiskey: { x: 621, y: 460, w: 203, h: 81 },
  oil: { x: 207, y: 460, w: 203, h: 81 },
  score: { x: 0, y: 460, w: 203, h: 81 },
  coke: { x: 828, y: 460, w: 203, h: 81 },
  swap: { x: 414, y: 460, w: 203, h: 81 },
} as const;

/** Last row of meeples.png: five oilfield faces and the unknown back. */
export const OIL_HEX = {
  back: { x: 155, y: 1022, w: 121, h: 130 },
  money2: { x: 10, y: 1022, w: 120, h: 130 },
  money3: { x: 302, y: 1022, w: 120, h: 130 },
  vp8: { x: 448, y: 1022, w: 120, h: 130 },
  whiskey: { x: 594, y: 1022, w: 120, h: 130 },
  bulb: { x: 739, y: 1022, w: 121, h: 130 },
} as const;

export const OIL_HEX_FOR_TILE: Record<string, SpriteBox> = {
  'oil-income-2': OIL_HEX.money2,
  'oil-income-3': OIL_HEX.money3,
  'oil-money-8': OIL_HEX.vp8,
  'oil-whiskey': OIL_HEX.whiskey,
  'oil-develop': OIL_HEX.bulb,
  'oil-money-2': OIL_HEX.money2,
  'oil-money-3': OIL_HEX.money3,
  'oil-vp-8': OIL_HEX.vp8,
  'oil-bulb': OIL_HEX.bulb,
};

export const PIPE_SPRITE = {
  points4: { x: 923, y: 933, w: 181, h: 75 },
  points7: { x: 740, y: 933, w: 181, h: 75 },
  points3: { x: 370, y: 933, w: 181, h: 75 },
  money10: { x: 1092, y: 315, w: 181, h: 75 },
  income2: { x: 1035, y: 460, w: 181, h: 75 },
  broken: { x: 185, y: 933, w: 181, h: 75 },
} as const;

/** Furnace doors: the shared back of a claimed quality-star card. */
export const QUALITY_BACK: SpriteBox = { x: 598, y: 238, w: 270, h: 204 };

/** Six quality-star faces. Grid matches the BGA crops. */
export const QUALITY_SPRITE: SpriteBox[] = [
  { x: 0, y: 0, w: 291, h: 227 },
  { x: 295, y: 0, w: 291, h: 227 },
  { x: 590, y: 0, w: 291, h: 227 },
  { x: 885, y: 0, w: 291, h: 227 },
  { x: 0, y: 230, w: 291, h: 227 },
  { x: 295, y: 230, w: 291, h: 227 },
];

/** Gold frame is the unflipped face. Red frame is the flipped face. */
export const MERCHANT_SPRITE: { gold: SpriteBox; red: SpriteBox }[] = [
  { gold: { x: 1005, y: 544, w: 197, h: 192 }, red: { x: 402, y: 544, w: 197, h: 192 } },
  { gold: { x: 603, y: 544, w: 197, h: 192 }, red: { x: 0, y: 544, w: 197, h: 192 } },
  { gold: { x: 201, y: 737, w: 197, h: 192 }, red: { x: 201, y: 544, w: 197, h: 192 } },
  { gold: { x: 804, y: 544, w: 197, h: 192 }, red: { x: 0, y: 737, w: 197, h: 192 } },
];

/** Panel chips. Percentages are the BGA background-position / background-size. */
export const PANEL_TOKEN: Record<string, { pos: string; size: string; w: number; h: number }> = {
  light: { pos: '82.7103% 29.0323%', size: '627.094% auto', w: 52, h: 21 },
  steel: { pos: '82.7103% 21.1982%', size: '627.094% auto', w: 52, h: 21 },
  whiskey: { pos: '58.0374% 42.3963%', size: '627.094% auto', w: 52, h: 21 },
  oil: { pos: '19.3458% 42.3963%', size: '627.094% auto', w: 52, h: 21 },
  score: { pos: '0% 42.3963%', size: '627.094% auto', w: 52, h: 21 },
  coke: { pos: '77.3832% 42.3963%', size: '627.094% auto', w: 52, h: 21 },
  swap: { pos: '38.6916% 42.3963%', size: '627.094% auto', w: 52, h: 21 },
  income2: { pos: '94.7802% 42.1632%', size: '703.315% auto', w: 52, h: 22 },
  broken: { pos: '16.9414% 85.5179%', size: '703.315% auto', w: 52, h: 22 },
  money10: { pos: '100% 28.8726%', size: '703.315% auto', w: 52, h: 22 },
  points3: { pos: '33.8828% 85.5179%', size: '703.315% auto', w: 52, h: 22 },
  points4: { pos: '84.5% 85.5179%', size: '703.315% auto', w: 52, h: 22 },
  points7: { pos: '67.7656% 85.5179%', size: '703.315% auto', w: 52, h: 22 },
};
