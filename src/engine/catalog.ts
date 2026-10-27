import type { CardDef, MapData, MerchantTileDef, OilfieldTileDef, QualityRewardDef, TileDef } from './types';
import { atlasSlotDefs } from '../ui/industryAtlas';
import mapJson from '../data/map.json';
import tilesJson from '../data/tiles.json';
import cardsJson from '../data/cards.json';
import extrasJson from '../data/extras.json';

const rawMap = mapJson as MapData;
export const mapData: MapData = {
  ...rawMap,
  locations: rawMap.locations.map((loc) => {
    const slots = atlasSlotDefs(loc.id);
    return slots ? { ...loc, slots } : loc;
  }),
};
export const tileDefs = tilesJson as TileDef[];
export const cardDefs = cardsJson as CardDef[];
export const merchantTiles = extrasJson.merchants as MerchantTileDef[];
export const oilfieldTiles = extrasJson.oilfields as OilfieldTileDef[];
export const qualityRewards = extrasJson.qualityRewards as QualityRewardDef[];

const tileById = new Map(tileDefs.map((t) => [t.id, t]));
const cardById = new Map(cardDefs.map((c) => [c.id, c]));
const locById = new Map(mapData.locations.map((l) => [l.id, l]));
const railById = new Map(mapData.railLines.map((r) => [r.id, r]));
const pipeById = new Map(mapData.pipelineLines.map((p) => [p.id, p]));
const marketById = new Map(mapData.markets.map((m) => [m.id, m]));
const oilfieldById = new Map(mapData.oilfields.map((o) => [o.id, o]));

export function tile(id: string): TileDef {
  const t = tileById.get(id);
  if (!t) throw new Error(`Unknown tile ${id}`);
  return t;
}

export function cardDef(id: string): CardDef {
  const c = cardById.get(id);
  if (!c) throw new Error(`Unknown card ${id}`);
  return c;
}

export function location(id: string): ReturnType<typeof locById.get> {
  return locById.get(id);
}

export function rail(id: string): ReturnType<typeof railById.get> {
  return railById.get(id);
}

export function pipeline(id: string): ReturnType<typeof pipeById.get> {
  return pipeById.get(id);
}

export function market(id: string): ReturnType<typeof marketById.get> {
  return marketById.get(id);
}

export function oilfield(id: string): ReturnType<typeof oilfieldById.get> {
  return oilfieldById.get(id);
}

export function emptyCost() {
  return { money: 0, coal: 0, iron: 0, coke: 0, steel: 0, incomeSpaces: 0 };
}

export function emptyReward() {
  return {
    money: 0,
    incomeSpaces: 0,
    whiskey: 0,
    vp: 0,
    bonusSell: false,
    freeDevelops: 0,
    doubleIncome: false,
  };
}
