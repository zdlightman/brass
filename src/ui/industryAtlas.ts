import type { IndustryKind } from '../engine/types';

/**
 * board-industries.png is one 5×6 sheet. Each cell is 312×312.
 * A city slot stores a cell index, so a V52 tweak changes data, not a new image.
 * Goods crates in rows 2–4 are the same "manufacturing" permission with different art.
 */

export const ATLAS = {
  href: '/game/board-industries.png',
  cell: 312,
  width: 1560,
  height: 1872,
} as const;

export type IconId =
  | 'steel'
  | 'iron+auto'
  | 'iron+coal'
  | 'iron+kerosene'
  | 'iron+goods'
  | 'iron'
  | 'auto'
  | 'coal'
  | 'coke'
  | 'locomotive'
  | 'kerosene+auto'
  | 'kerosene+coal'
  | 'kerosene'
  | 'goods-bicycles'
  | 'goods-bottles'
  | 'goods+auto'
  | 'goods+coal'
  | 'goods+kerosene'
  | 'goods-lamps'
  | 'goods'
  | 'goods-sewing'
  | 'goods-typewriter'
  | 'oil-derrick'
  | 'skyscraper+kerosene'
  | 'skyscraper+goods'
  | 'skyscraper';

export const ICONS: Record<IconId, { col: number; row: number }> = {
  steel: { col: 0, row: 0 },
  'iron+auto': { col: 1, row: 0 },
  'iron+coal': { col: 2, row: 0 },
  'iron+kerosene': { col: 3, row: 0 },
  'iron+goods': { col: 4, row: 0 },
  iron: { col: 0, row: 1 },
  auto: { col: 1, row: 1 },
  coal: { col: 2, row: 1 },
  coke: { col: 3, row: 1 },
  locomotive: { col: 4, row: 1 },
  'kerosene+auto': { col: 0, row: 2 },
  'kerosene+coal': { col: 1, row: 2 },
  kerosene: { col: 2, row: 2 },
  'goods-bicycles': { col: 3, row: 2 },
  'goods-bottles': { col: 4, row: 2 },
  'goods+auto': { col: 0, row: 3 },
  'goods+coal': { col: 1, row: 3 },
  'goods+kerosene': { col: 2, row: 3 },
  'goods-lamps': { col: 3, row: 3 },
  goods: { col: 4, row: 3 },
  'goods-sewing': { col: 0, row: 4 },
  'goods-typewriter': { col: 1, row: 4 },
  'oil-derrick': { col: 2, row: 4 },
  'skyscraper+kerosene': { col: 3, row: 4 },
  'skyscraper+goods': { col: 4, row: 4 },
  skyscraper: { col: 0, row: 5 },
};

/**
 * Empty-slot faces in V52 industry-slot order.
 * A city's star row is data-max, not this list's length.
 * Canada, Albany, Cincinnati, Eads Bridge, and The South have no industry slots.
 */
export const CITY_SLOTS: Record<string, IconId[]> = {
  SAGINAW: ['goods+auto', 'coal', 'coal'],
  DETROIT: ['goods+kerosene', 'iron', 'auto'],
  CHICAGO: ['skyscraper+kerosene', 'skyscraper', 'goods+kerosene', 'iron'],
  TOLEDO: ['goods+kerosene', 'iron+kerosene', 'auto'],
  INDIANAPOLIS: ['auto', 'goods+kerosene'],
  COLUMBUS: ['kerosene+coal', 'coal'],
  CLARKSBURG: ['coal', 'coal', 'iron+coal'],
  PITTSBURGH: ['coal', 'goods+kerosene', 'iron', 'iron+coal', 'goods+kerosene'],
  CLEVELAND: ['skyscraper+kerosene', 'iron+auto', 'goods+kerosene'],
  ERIE: ['auto', 'iron+goods'],
  BUFFALO: ['goods+kerosene', 'iron', 'goods+kerosene'],
  ROCHESTER: ['goods', 'iron+goods'],
  'WILKES-BARRE': ['coal', 'coal', 'coal'],
  BETHLEHEM: ['iron+coal', 'iron+goods'],
  HARRISBURG: ['coal', 'iron+coal'],
  BALTIMORE: ['goods+kerosene', 'iron+kerosene', 'goods+kerosene'],
  PHILADELPHIA: ['iron+auto', 'goods+kerosene', 'skyscraper'],
  'NEW YORK': ['goods+kerosene', 'skyscraper', 'kerosene', 'iron'],
  BOSTON: ['goods+auto', 'skyscraper'],
};

/** Banner name → engine location id. Slot id is `${locationId}-${index}` in CITY_SLOTS order. */
export const BANNER_LOCATION: Record<string, string> = {
  SAGINAW: 'saginaw',
  DETROIT: 'detroit',
  CHICAGO: 'chicago',
  TOLEDO: 'toledo',
  INDIANAPOLIS: 'indianapolis',
  COLUMBUS: 'columbus',
  CLARKSBURG: 'clarksburg',
  PITTSBURGH: 'pittsburgh',
  CLEVELAND: 'cleveland',
  ERIE: 'erie',
  BUFFALO: 'buffalo',
  ROCHESTER: 'rochester',
  'WILKES-BARRE': 'wilkes-barre',
  BETHLEHEM: 'bethlehem',
  HARRISBURG: 'harrisburg',
  BALTIMORE: 'baltimore',
  PHILADELPHIA: 'philadelphia',
  'NEW YORK': 'new-york',
  BOSTON: 'boston',
};

/** These locations are on the board and have no industry spaces in V52. */
const NO_INDUSTRY = new Set(['albany', 'cincinnati', 'canada', 'eads-bridge', 'the-south']);

export function industrySlotId(banner: string, index: number): string {
  return `${BANNER_LOCATION[banner]}-${index}`;
}

/** Industries a printed slot icon accepts. Iron icons also take the steel tiles on that track. */
export function industriesForIcon(icon: IconId): IndustryKind[] {
  const found = new Set<IndustryKind>();
  for (const part of icon.split('+')) {
    for (const kind of iconPartKinds(part)) found.add(kind);
  }
  return [...found];
}

function iconPartKinds(part: string): IndustryKind[] {
  if (part === 'coal') return ['coal'];
  if (part === 'coke') return ['coke'];
  if (part === 'iron') return ['iron', 'steel'];
  if (part === 'steel') return ['steel'];
  if (part === 'kerosene') return ['kerosene'];
  if (part === 'auto') return ['automobile'];
  if (part === 'locomotive') return ['locomotive'];
  if (part === 'skyscraper') return ['skyscraper'];
  if (part.startsWith('goods')) return ['manufacturing'];
  return [];
}

/** Slot permissions for one location, or undefined if this id is not on the V52 board. */
export function atlasSlotDefs(locationId: string): { id: string; allowed: IndustryKind[] }[] | undefined {
  const banner = Object.entries(BANNER_LOCATION).find(([, id]) => id === locationId)?.[0];
  if (banner) {
    return (CITY_SLOTS[banner] ?? []).map((icon, index) => ({
      id: `${locationId}-${index}`,
      allowed: industriesForIcon(icon),
    }));
  }
  if (NO_INDUSTRY.has(locationId)) return [];
  return undefined;
}

/** One derrick on each printed oilfield. Centers sit on the script label. */
export const OILFIELDS: { id: string; name: string; x: number; y: number }[] = [
  { id: 'bradford', name: 'Bradford & Olean', x: 1248, y: 739 },
  { id: 'macksburg', name: 'Macksburg', x: 721, y: 1305 },
  { id: 'trenton', name: 'Trenton', x: 508, y: 970 },
  { id: 'venango', name: 'Venango', x: 1130, y: 864 },
  { id: 'lima', name: 'Lima & Findlay', x: 656, y: 973 },
];
