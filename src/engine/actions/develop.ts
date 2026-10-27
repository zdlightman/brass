import { cardLabel, discardCard } from '../cards';
import { locationsInNetwork } from '../graph';
import { accessibleTileIds, player, removeMatTile } from '../mat';
import { consumeCubes, formatSpend, spendMoneyOf, planCubeSpend, type SpendStep } from '../resources';
import { tileName, playerTag } from '../logText';
import { logAction } from '../turn';
import type { Action, ActionResult, Cube, GameState } from '../types';

const METALS: Cube[] = ['iron', 'steel'];

/** Discard a card and remove 1 or 2 accessible mat tiles. Each costs one iron or one steel. */
export function applyDevelop(
  state: GameState,
  action: Extract<Action, { type: 'develop' }>,
): ActionResult {
  const tiles = action.tileDefIds;
  if (tiles.length < 1 || tiles.length > 2) {
    return { ok: false, error: 'Develop removes 1 or 2 industries.' };
  }
  const p = player(state, action.playerId);
  const open = accessibleTileIds(p.mat);
  const wanted = new Map<string, number>();
  for (const id of tiles) {
    if (!open.has(id)) return { ok: false, error: 'That industry is not accessible.' };
    wanted.set(id, (wanted.get(id) ?? 0) + 1);
  }
  for (const [id, count] of wanted) {
    const have = p.mat.filter((tile) => tile.defId === id && !tile.removed).length;
    if (have < count) return { ok: false, error: 'Not enough copies of that industry.' };
  }

  const card = discardCard(p, action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };

  const dest = [...locationsInNetwork(state, action.playerId)];
  const free = Math.min(p.pendingFreeDevelops, tiles.length);
  p.pendingFreeDevelops -= free;
  const paid = tiles.length - free;
  const spent: SpendStep[] = [];
  if (paid > 0) {
    if (action.sources.length === 0) {
      for (let n = 0; n < paid; n++) {
        const choice = cheapestMetal(state, action.playerId, dest);
        if (!choice) return { ok: false, error: 'Cannot pay an iron or steel to develop.' };
        const spentCubes = consumeCubes(state, action.playerId, { [choice]: 1 }, dest, []);
        if (!spentCubes.ok) return spentCubes;
        spent.push(...spentCubes.steps);
      }
    } else {
      if (action.sources.length !== paid) return { ok: false, error: 'Develop needs one iron or steel per industry.' };
      for (const source of action.sources) {
        const metal = metalOf(source, state);
        if (!metal) return { ok: false, error: 'Develop pays with iron or steel.' };
        const spentCubes = consumeCubes(state, action.playerId, { [metal]: 1 }, dest, [source]);
        if (!spentCubes.ok) return spentCubes;
        spent.push(...spentCubes.steps);
      }
    }
  }

  for (const id of tiles) {
    if (!removeMatTile(p, id)) return { ok: false, error: 'Industry was not on your mat.' };
  }
  const bits: string[] = [];
  if (free > 0) bits.push(`免费研发 ${free} 个，不消耗铁或钢`);
  if (spent.length) bits.push(formatSpend(state, spent));
  const cost = bits.length ? `${bits.join('，')}。` : '';
  logAction(state, `${playerTag(p.id)} 研发，从个人版图移除 ${tiles.map(tileName).join('、')}（${cardLabel(card)}）。${cost}`);
  return { ok: true, state };
}

/** The oilfield reward removes one accessible industry and does not spend a card or metal. */
export function applyOilDevelop(
  state: GameState,
  action: Extract<Action, { type: 'oilDevelop' }>,
): ActionResult {
  if (state.pendingOilDevelopPlayerId !== action.playerId) {
    return { ok: false, error: 'No free develop is waiting.' };
  }
  const p = player(state, action.playerId);
  if (!accessibleTileIds(p.mat).has(action.tileDefId)) {
    return { ok: false, error: 'That industry is not accessible.' };
  }
  if (!removeMatTile(p, action.tileDefId)) return { ok: false, error: 'Industry was not on your mat.' };
  logAction(state, `${playerTag(p.id)} 免费研发，从个人版图移除 ${tileName(action.tileDefId)}。`);
  return { ok: true, state };
}

export function declineOilDevelop(
  state: GameState,
  action: Extract<Action, { type: 'declineOilDevelop' }>,
): ActionResult {
  if (state.pendingOilDevelopPlayerId !== action.playerId) {
    return { ok: false, error: 'No free develop is waiting.' };
  }
  logAction(state, `${playerTag(action.playerId)} 跳过免费研发，没有移除产业。`);
  return { ok: true, state };
}

function cheapestMetal(state: GameState, playerId: Action['playerId'], dest: string[]): Cube | null {
  let best: { cube: Cube; cash: number } | null = null;
  for (const cube of METALS) {
    const plan = planCubeSpend(state, playerId, { [cube]: 1 }, dest);
    if (!plan.ok) continue;
    const cash = spendMoneyOf(plan.steps);
    if (!best || cash < best.cash) best = { cube, cash };
  }
  return best?.cube ?? null;
}

function metalOf(source: Extract<Action, { type: 'develop' }>['sources'][number], state: GameState): Cube | null {
  if ('cube' in source && (source.cube === 'iron' || source.cube === 'steel')) return source.cube;
  if (source.kind === 'industry') {
    const slot = state.slots.find((s) => s.id === source.slotId);
    if ((slot?.cubes.iron ?? 0) > 0) return 'iron';
    if ((slot?.cubes.steel ?? 0) > 0) return 'steel';
    return null;
  }
  if (source.kind === 'market') {
    const market = state.markets.find((m) => m.id === source.marketId);
    if (market?.slots.some((s) => s.cube === 'iron')) return 'iron';
    if (market?.slots.some((s) => s.cube === 'steel')) return 'steel';
    return null;
  }
  if (source.kind === 'heavyTrain') {
    const link = state.links.find((l) => l.id === source.linkId);
    if ((link?.cubes.iron ?? 0) > 0) return 'iron';
    if ((link?.cubes.steel ?? 0) > 0) return 'steel';
    return null;
  }
  if (source.kind === 'vanderbilt') return source.cube === 'steel' ? 'steel' : 'iron';
  return null;
}
