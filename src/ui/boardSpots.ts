/** Centers on the 2048 board, measured from BGA #brass-board-holder. Index 0 is the bottom slot. */

export type Spot = { x: number; y: number };

export const MARKET_CELLS: Record<string, { iron?: Spot[]; coal?: Spot[]; steel?: Spot[]; coke?: Spot[] }> = {
  'm-wilkes': {
    iron: [
      { x: 1500, y: 680 },
      { x: 1500, y: 645 },
      { x: 1500, y: 610 },
    ],
    coal: [
      { x: 1545, y: 680 },
      { x: 1545, y: 645 },
      { x: 1545, y: 610 },
    ],
  },
  'm-clarksburg': {
    iron: [
      { x: 893, y: 1372 },
      { x: 893, y: 1337 },
      { x: 893, y: 1302 },
    ],
    coal: [
      { x: 938, y: 1372 },
      { x: 938, y: 1337 },
      { x: 938, y: 1302 },
    ],
  },
  'm-toledo': {
    iron: [
      { x: 624, y: 734 },
      { x: 624, y: 699 },
      { x: 624, y: 664 },
    ],
    coal: [
      { x: 669, y: 734 },
      { x: 669, y: 699 },
      { x: 669, y: 664 },
    ],
  },
  'm-philadelphia': {
    steel: [
      { x: 1451, y: 1500 },
      { x: 1451, y: 1465 },
    ],
    coke: [
      { x: 1496, y: 1500 },
      { x: 1496, y: 1465 },
    ],
  },
  'm-eads': {
    steel: [
      { x: 196, y: 1119 },
      { x: 196, y: 1084 },
    ],
    coke: [
      { x: 241, y: 1119 },
      { x: 241, y: 1084 },
    ],
  },
  'm-canada': {
    steel: [
      { x: 913, y: 277 },
      { x: 913, y: 242 },
    ],
    coke: [
      { x: 958, y: 277 },
      { x: 958, y: 242 },
    ],
  },
};

export const MERCHANT_SPOTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  canada: { x: 934, y: 410, w: 86, h: 83 },
  boston: { x: 1832, y: 829, w: 86, h: 83 },
  'the-south': { x: 1029, y: 1681, w: 86, h: 83 },
  'eads-bridge': { x: 216, y: 1242, w: 86, h: 83 },
};

export type LinkSpot = { lineId: string; x: number; y: number; w: number; h: number; deg: number };

/**
 * Click holder on each pipeline route.
 * x/y/w/h and deg are the BGA pipeline-*-holder: center, axis-aligned box, CSS rotate.
 */
export const PIPELINE_SPOTS: LinkSpot[] = [
  { lineId: 'p-bradford-wilkes', x: 1329, y: 713, w: 70, h: 75, deg: -50 },
  { lineId: 'p-bradford-buffalo', x: 1242, y: 623, w: 62, h: 78, deg: -60 },
  { lineId: 'p-venango-erie', x: 1115, y: 768, w: 75, h: 70, deg: 40 },
  { lineId: 'p-venango-cleveland', x: 1035, y: 836, w: 78, h: 48, deg: 15 },
  { lineId: 'p-venango-pitt', x: 1044, y: 914, w: 75, h: 70, deg: -40 },
  { lineId: 'p-lima-toledo', x: 592, y: 929, w: 42, h: 77, deg: 80 },
  { lineId: 'p-lima-cleveland', x: 736, y: 925, w: 66, h: 77, deg: -55 },
  { lineId: 'p-trenton-chicago', x: 426, y: 919, w: 73, h: 73, deg: 45 },
  { lineId: 'p-trenton-indianapolis', x: 426, y: 1009, w: 75, h: 70, deg: -40 },
  { lineId: 'p-macksburg-pitt', x: 811, y: 1224, w: 75, h: 70, deg: -40 },
  { lineId: 'p-macksburg-clarksburg', x: 807, y: 1342, w: 77, h: 66, deg: 35 },
];

/**
 * Layout size of a holder before CSS rotate.
 * The console w/h is the axis-aligned box after rotation.
 */
export function unrotatedPlate(w: number, h: number, deg: number): { w: number; h: number } {
  const rad = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const det = c * c - s * s;
  if (Math.abs(det) < 0.08) return { w: 72, h: 40 };
  const pw = (w * c - h * s) / det;
  const ph = (h * c - w * s) / det;
  if (pw < 24 || ph < 16) return { w: 72, h: 40 };
  return { w: pw, h: ph };
}

/** Meeple holder on each rail. deg is the BGA holder's CSS rotate. w/h is the box after that rotation. */
export const RAIL_SPOTS: LinkSpot[] = [
  { lineId: 'r-buffalo-rochester', x: 1380, y: 400, w: 76, h: 46, deg: -5 },
  { lineId: 'r-chicago-saginaw', x: 462, y: 592, w: 52, h: 79, deg: 100 },
  { lineId: 'r-saginaw-detroit', x: 583, y: 486, w: 83, h: 71, deg: 30 },
  { lineId: 'r-buffalo-canada', x: 1037, y: 451, w: 76, h: 46, deg: 5 },
  { lineId: 'r-detroit-canada', x: 888, y: 504, w: 80, h: 80, deg: -45 },
  { lineId: 'r-albany-boston', x: 1795, y: 508, w: 80, h: 80, deg: 45 },
  { lineId: 'r-buffalo-wilkes', x: 1383, y: 531, w: 78, h: 82, deg: 50 },
  { lineId: 'r-erie-buffalo', x: 1211, y: 554, w: 80, h: 80, deg: -45 },
  { lineId: 'r-albany-newyork', x: 1707, y: 712, w: 46, h: 76, deg: 85 },
  { lineId: 'r-detroit-toledo', x: 574, y: 590, w: 78, h: 82, deg: -50 },
  { lineId: 'r-cleveland-erie', x: 990, y: 727, w: 82, h: 78, deg: -40 },
  { lineId: 'r-newyork-boston', x: 1769, y: 880, w: 52, h: 79, deg: -80 },
  { lineId: 'r-newyork-wilkes', x: 1631, y: 796, w: 75, h: 83, deg: 55 },
  { lineId: 'r-chicago-toledo', x: 455, y: 791, w: 83, h: 67, deg: -25 },
  { lineId: 'r-toledo-cleveland', x: 742, y: 804, w: 78, h: 50, deg: 8 },
  { lineId: 'r-wilkes-bethlehem', x: 1523, y: 900, w: 63, h: 82, deg: -70 },
  { lineId: 'r-chicago-eads', x: 225, y: 925, w: 46, h: 76, deg: -85 },
  { lineId: 'r-chicago-indianapolis', x: 335, y: 1046, w: 51, h: 78, deg: 81 },
  { lineId: 'r-cleveland-pittsburgh', x: 959, y: 933, w: 63, h: 82, deg: 70 },
  { lineId: 'r-columbus-cleveland', x: 783, y: 993, w: 78, h: 82, deg: -50 },
  { lineId: 'r-bethlehem-harrisburg', x: 1344, y: 996, w: 82, h: 63, deg: -20 },
  { lineId: 'r-newyork-bethlehem', x: 1543, y: 990, w: 79, h: 52, deg: 10 },
  { lineId: 'r-pittsburgh-harrisburg', x: 1147, y: 1028, w: 79, h: 52, deg: -10 },
  { lineId: 'r-philadelphia-newyork', x: 1534, y: 1088, w: 75, h: 83, deg: -55 },
  { lineId: 'r-pittsburgh-columbus', x: 818, y: 1127, w: 81, h: 58, deg: -15 },
  { lineId: 'r-harrisburg-philadelphia', x: 1340, y: 1180, w: 82, h: 61, deg: 18 },
  { lineId: 'r-columbus-indianapolis', x: 533, y: 1139, w: 79, h: 52, deg: -10 },
  { lineId: 'r-pittsburgh-clarksburg', x: 1021, y: 1249, w: 58, h: 81, deg: -75 },
  { lineId: 'r-columbus-cincinnati', x: 614, y: 1276, w: 78, h: 82, deg: -50 },
  { lineId: 'r-indianapolis-eads', x: 337, y: 1209, w: 76, h: 46, deg: -5 },
  { lineId: 'r-indianapolis-cincinnati', x: 429, y: 1342, w: 67, h: 83, deg: 65 },
  { lineId: 'r-philadelphia-baltimore', x: 1275, y: 1254, w: 81, h: 58, deg: -15 },
  { lineId: 'r-baltimore-clarksburg', x: 1114, y: 1333, w: 79, h: 52, deg: 10 },
  { lineId: 'r-cincinnati-clarksburg', x: 762, y: 1457, w: 79, h: 52, deg: 10 },
  { lineId: 'r-cincinnati-south', x: 762, y: 1579, w: 82, h: 63, deg: 20 },
  { lineId: 'r-baltimore-south', x: 1085, y: 1506, w: 71, h: 83, deg: -60 },
  { lineId: 'r-rochester-albany', x: 1616, y: 377, w: 83, h: 75, deg: 35 },
];
