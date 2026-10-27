import { location, market as marketDef, tile } from './catalog';
import { railConnected } from './graph';
import { describeReward, playerTag, tileName } from './logText';
import { player } from './mat';
import { hasCubes } from './resources';
import { applyReward } from './rewards';
import { deferLog } from './logQueue';
import type { Cube, GameState, PlayerId, SlotState } from './types';

const CUBES: Cube[] = ['coal', 'iron', 'coke', 'steel'];
const CUBE_LABEL: Record<Cube, string> = { coal: '煤', iron: '铁', coke: '焦炭', steel: '钢' };

export interface SalePick {
  marketId: string;
  slotIndex: number;
}

/** Empty connected market spaces that can take this cube, cheapest last so the player can choose. */
export function saleChoices(state: GameState, locationId: string, cube: Cube): Array<SalePick & { price: number; vp: number; name: string }> {
  const out: Array<SalePick & { price: number; vp: number; name: string }> = [];
  for (const market of state.markets) {
    const def = marketDef(market.id);
    if (!def || !def.cubes.includes(cube)) continue;
    if (!railConnected(state, locationId, def.locationId)) continue;
    columnSlots(market, market.id, cube).forEach((slot, slotIndex) => {
      if (slot.cube !== null) return;
      out.push({ marketId: market.id, slotIndex, price: def.price, vp: slot.vp, name: def.name });
    });
  }
  return out;
}

export function sellProducedToMarkets(
  state: GameState,
  playerId: PlayerId,
  slot: SlotState,
  order: SalePick[] = [],
): void {
  const p = player(state, playerId);
  const queue = [...order];
  for (const cube of CUBES) {
    while ((slot.cubes[cube] ?? 0) > 0) {
      const picked = takePicked(state, slot.locationId, cube, queue) ?? bestEmptyMarket(state, slot.locationId, cube);
      if (!picked) break;
      const spaces = columnSlots(picked.market, picked.marketId, cube);
      const empty = picked.slotIndex === undefined ? spaces.find((s) => s.cube === null) : spaces[picked.slotIndex];
      if (!empty || empty.cube !== null) break;
      empty.cube = cube;
      slot.cubes[cube] = (slot.cubes[cube] ?? 0) - 1;
      p.money += picked.price;
      const marketName = marketDef(picked.marketId)?.name ?? picked.marketId;
      const paid = `${playerTag(playerId)} 向${marketName}补充${CUBE_LABEL[cube]}，获得 $${picked.price}`;
      const awarded = cube === 'coke' ? 4 : 0;
      if (awarded > 0) p.vp += awarded;
      const points = awarded > 0 ? `，${playerTag(playerId)} 记焦炭分 ${awarded}` : '';
      deferLog(state, `${paid}${points}。`);
    }
  }
  maybeFlipDepleted(state, slot);
}

function takePicked(
  state: GameState,
  locationId: string,
  cube: Cube,
  queue: SalePick[],
): { market: GameState['markets'][number]; marketId: string; price: number; slotIndex: number } | null {
  const at = queue.findIndex((pick) => {
    const def = marketDef(pick.marketId);
    return def?.cubes.includes(cube) && railConnected(state, locationId, def.locationId);
  });
  if (at < 0) return null;
  const [pick] = queue.splice(at, 1);
  if (!pick) return null;
  const market = state.markets.find((entry) => entry.id === pick.marketId);
  const def = marketDef(pick.marketId);
  if (!market || !def) return null;
  return { market, marketId: pick.marketId, price: def.price, slotIndex: pick.slotIndex };
}

function columnSlots(market: GameState['markets'][number], marketId: string, cube: Cube) {
  const def = marketDef(marketId);
  if (!def) return [];
  const column = def.cubes.indexOf(cube);
  if (column < 0) return [];
  const per = market.slots.length / def.cubes.length;
  return market.slots.slice(column * per, (column + 1) * per);
}

function bestEmptyMarket(state: GameState, locationId: string, cube: Cube) {
  let best: { market: (typeof state.markets)[0]; marketId: string; price: number; vp: number; slotIndex?: number } | null = null;
  for (const m of state.markets) {
    const def = marketDef(m.id);
    if (!def || !def.cubes.includes(cube)) continue;
    if (!railConnected(state, locationId, def.locationId)) continue;
    const empty = columnSlots(m, m.id, cube).filter((s) => s.cube === null);
    if (empty.length === 0) continue;
    const vp = Math.max(...empty.map((s) => s.vp));
    if (!best || def.price > best.price || (def.price === best.price && vp > best.vp)) {
      best = { market: m, marketId: m.id, price: def.price, vp };
    }
  }
  return best;
}

export function maybeFlipDepleted(state: GameState, slot: SlotState): void {
  if (!slot.tileDefId || slot.flipped || hasCubes(slot.cubes)) return;
  const t = tile(slot.tileDefId);
  const produced = CUBES.some((c) => (t.produces[c] ?? 0) > 0) || (t.produces.oil ?? 0) > 0;
  if (!produced) return;
  slot.flipped = true;
  if (slot.owner !== null) {
    applyReward(state, slot.owner, t.flipReward);
    const where = location(slot.locationId)?.name ?? slot.locationId;
    deferLog(state, `${playerTag(slot.owner)} 的 ${where} ${tileName(t.id)} 资源售完，翻面，${describeReward(t.flipReward)}。`);
  }
}
