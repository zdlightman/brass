import type { CardDef } from '../engine/types';

/** cards.jpg is 6×4. Column edges are measured; rows are 521px. */
const COLS = [0, 370, 741, 1111, 1482, 1852, 2223] as const;
const ROWS = [0, 521, 1042, 1563, 2084] as const;
const SHEET_W = 2223;
const SHEET_H = 2084;

const LOCATION: Record<string, [number, number]> = {
  columbus: [1, 0],
  indianapolis: [2, 0],
  toledo: [3, 0],
  chicago: [4, 0],
  detroit: [5, 0],
  saginaw: [0, 1],
  erie: [1, 1],
  clarksburg: [2, 1],
  cleveland: [3, 1],
  pittsburgh: [4, 1],
  rochester: [5, 1],
  'wilkes-barre': [0, 2],
  buffalo: [1, 2],
  bethlehem: [2, 2],
  'new-york': [3, 2],
  philadelphia: [4, 2],
  baltimore: [5, 2],
  harrisburg: [0, 3],
  boston: [1, 3],
};

/**
 * BGA industry cards are combined. Corner icons on the sheet:
 * coal+coke, manufacturing+automobile, kerosene+oil, Bessemer+skyscraper.
 */
const INDUSTRY: Record<string, [number, number]> = {
  coal: [2, 3],
  coke: [2, 3],
  manufacturing: [3, 3],
  automobile: [3, 3],
  kerosene: [4, 3],
  oilCity: [4, 3],
  iron: [5, 3],
  steel: [5, 3],
  skyscraper: [5, 3],
};

export const CITY_NAME: Record<string, { zh: string; en: string }> = {
  columbus: { zh: '哥伦布', en: 'Columbus' },
  indianapolis: { zh: '印第安纳波利斯', en: 'Indianapolis' },
  toledo: { zh: '托莱多', en: 'Toledo' },
  chicago: { zh: '芝加哥', en: 'Chicago' },
  detroit: { zh: '底特律', en: 'Detroit' },
  saginaw: { zh: '萨吉诺', en: 'Saginaw' },
  erie: { zh: '伊利', en: 'Erie' },
  clarksburg: { zh: '克拉克斯堡', en: 'Clarksburg' },
  cleveland: { zh: '克利夫兰', en: 'Cleveland' },
  pittsburgh: { zh: '匹兹堡', en: 'Pittsburgh' },
  rochester: { zh: '罗切斯特', en: 'Rochester' },
  'wilkes-barre': { zh: '威尔克斯巴里', en: 'Wilkes-Barre' },
  buffalo: { zh: '布法罗', en: 'Buffalo' },
  bethlehem: { zh: '伯利恒', en: 'Bethlehem' },
  'new-york': { zh: '纽约', en: 'New York' },
  philadelphia: { zh: '费城', en: 'Philadelphia' },
  baltimore: { zh: '巴尔的摩', en: 'Baltimore' },
  harrisburg: { zh: '哈里斯堡', en: 'Harrisburg' },
  boston: { zh: '波士顿', en: 'Boston' },
  albany: { zh: '奥尔巴尼', en: 'Albany' },
};

export function cardFace(def: CardDef): { src: string; x: number; y: number; w: number; h: number; sheetW: number; sheetH: number } | null {
  const cell =
    def.kind === 'location' && def.locationId
      ? LOCATION[def.locationId]
      : def.kind === 'industry' && def.industry
        ? INDUSTRY[def.industry]
        : undefined;
  if (!cell) return null;
  const [col, row] = cell;
  return {
    src: '/game/cards.jpg',
    x: COLS[col]!,
    y: ROWS[row]!,
    w: COLS[col + 1]! - COLS[col]!,
    h: ROWS[row + 1]! - ROWS[row]!,
    sheetW: SHEET_W,
    sheetH: SHEET_H,
  };
}
