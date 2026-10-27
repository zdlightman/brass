import { industryCardMatches, slotAcceptsBuild, slotAcceptsUpgrade } from '../engine/actions/build';
import { destLocationsFor, legalNetworkPlacements, linkResourceCost } from '../engine/actions/network';
import { merchantSells, merchantsForSale, oilChoices } from '../engine/actions/sell';
import { looseFieldOil, oilCityBarrels } from '../engine/oil';
import { applyAction } from '../engine/apply';
import { cardDef, mapData, market as marketDef, pipeline, rail, tile } from '../engine/catalog';
import { clone } from '../engine/clone';
import { locationLinkPoints, occupiedRailLineIds, railConnected } from '../engine/graph';
import { incomeLevelAt } from '../engine/income';
import { accessibleTileDefs, accessibleTileIds, player } from '../engine/mat';
import { industryChoiceGroups } from '../engine/resources';
import type { Action, CubeSource, GameState, IndustryKind, OilSource, PlayerId, TileDef } from '../engine/types';

export type Role = 'box' | 'oil';

export const ROLE_ZH: Record<Role, string> = {
  box: '经济·箱',
  oil: '经济·油',
};

export function chooseAiAction(current: GameState, pid: PlayerId, roles: Record<PlayerId, Role>): Action | null {
  const style = roles[pid];
  if (current.pendingOilDevelopPlayerId === pid) return freeDevelop(current, pid, style);
  if (current.bonusSellPlayerId === pid) return sellOrDecline(current, pid, style, true);
  const ranked: { action: Action; score: number }[] = [];
  for (const action of candidates(current, pid, style)) {
    const result = applyAction(clone(current), action);
    if (!result.ok) continue;
    ranked.push({ action, score: scoreAction(current, result.state, pid, action, style) });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.action ?? null;
}

function candidates(current: GameState, pid: PlayerId, style: Role): Action[] {
  const discard = worstCard(current, pid, style);
  const actions: Action[] = [];
  if (discard) {
    actions.push({ type: 'pass', playerId: pid, cardId: discard });
    actions.push({ type: 'loan', playerId: pid, cardId: discard });
    actions.push({ type: 'develop', playerId: pid, cardId: discard, tileDefIds: developIds(current, pid, style), sources: [] });
  }
  actions.push(...buildCandidates(current, pid, style));
  actions.push(...networkCandidates(current, pid, discard));
  actions.push(...sellCandidates(current, pid, discard));
  return actions.filter((action) => (action.type === 'develop' ? action.tileDefIds.length > 0 : true));
}

function buildCandidates(current: GameState, pid: PlayerId, style: Role): Action[] {
  const p = player(current, pid);
  const tiles = accessibleTileDefs(p).filter((entry) => entry.era === 'any' || entry.era === current.era);
  const ranked: { action: Action; rank: number }[] = [];
  for (const card of p.hand) {
    for (const built of tiles) {
      if (built.kind === 'oilCity') continue;
      const slots = built.upgradeFrom
        ? current.slots.filter((slot) => slotAcceptsUpgrade(current, built.id, slot.id, pid))
        : current.slots.filter((slot) => slotAcceptsBuild(current, built.id, slot.id, pid));
      for (const slot of slots) {
        if (!cardCanBuild(card.defId, built, slot.locationId)) continue;
        ranked.push({
          rank: buildRank(current, pid, style, built),
          action: {
            type: 'build',
            playerId: pid,
            cardId: card.id,
            whiskeyWild: false,
            tileDefId: built.id,
            slotId: slot.id,
            sources: [],
          },
        });
      }
    }
  }
  ranked.sort((a, b) => b.rank - a.rank);
  const picked: Action[] = [];
  for (const entry of ranked.slice(0, 32)) {
    const ready = prepare(current, entry.action);
    if (ready) picked.push(ready);
  }
  return picked;
}

function networkCandidates(current: GameState, pid: PlayerId, discard: string | null): Action[] {
  if (!discard) return [];
  const legal = legalNetworkPlacements(current, pid);
  const singles = legal
    .map((placement) =>
      prepare(current, {
        type: 'network',
        playerId: pid,
        cardId: discard,
        placements: [placement],
      }),
    )
    .filter((action): action is Action => action !== null);
  const paired: Action[] = [];
  for (const first of singles.slice(0, 8)) {
    if (first.type !== 'network') continue;
    const base = first.placements[0];
    if (!base) continue;
    for (const extra of legal) {
      if (extra.lineId === base.lineId) continue;
      if (!worthSecond(current, pid, extra.lineId, extra.kind)) continue;
      const both = prepare(current, { ...first, placements: [base, extra] });
      if (both) paired.push(both);
      if (paired.length >= 6) break;
    }
    if (paired.length >= 6) break;
  }
  return [...singles, ...paired];
}

function sellCandidates(current: GameState, pid: PlayerId, discard: string | null): Action[] {
  const goods = current.slots.filter((slot) => {
    if (slot.owner !== pid || !slot.tileDefId || slot.flipped) return false;
    return tile(slot.tileDefId).sellable;
  });
  const actions: Action[] = [];
  const seen = new Set<string>();
  for (let mask = (1 << goods.length) - 1; mask >= 1; mask -= 1) {
    const slotIds = goods.filter((_, index) => mask & (1 << index)).map((slot) => slot.id);
    const oilSources = assignSellOil(current, pid, slotIds);
    if (!oilSources) continue;
    const merchantLocationIds = [
      ...new Set(
        slotIds.flatMap((slotId) => {
          const slot = current.slots.find((entry) => entry.id === slotId);
          if (!slot?.tileDefId) return [];
          const [merchant] = merchantsForSale(current, slot.locationId, tile(slot.tileDefId).kind);
          return merchant ? [merchant.locationId] : [];
        }),
      ),
    ];
    const ready = prepare(current, {
      type: 'sell',
      playerId: pid,
      cardId: discard ?? '',
      slotIds,
      merchantLocationIds,
      oilSources,
      whiskeyStars: 0,
    });
    if (!ready || ready.type !== 'sell') continue;
    const key = [...ready.slotIds].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push(ready);
  }
  return actions;
}

/** One sell action spends one barrel per good. Barrels on different pipes are shared across that action. */
function assignSellOil(
  current: GameState,
  pid: PlayerId,
  slotIds: string[],
): Array<OilSource & { slotId: string }> | null {
  const pending = slotIds.flatMap((slotId) => {
    const slot = current.slots.find((entry) => entry.id === slotId);
    const need = slot?.tileDefId ? tile(slot.tileDefId).oilToSell : 0;
    return Array.from({ length: need }, () => slotId);
  });
  const used = new Map<string, number>();
  const oil: Array<OilSource & { slotId: string }> = [];
  const left = pending.slice();
  while (left.length) {
    left.sort((a, b) => openOil(current, pid, a, used).length - openOil(current, pid, b, used).length);
    const slotId = left[0];
    if (!slotId) return null;
    const source = openOil(current, pid, slotId, used)[0];
    if (!source) return null;
    oil.push({ ...source, slotId });
    const key = oilPoolKey(source);
    used.set(key, (used.get(key) ?? 0) + 1);
    left.shift();
  }
  return oil;
}

function openOil(current: GameState, pid: PlayerId, slotId: string, used: Map<string, number>): OilSource[] {
  const slot = current.slots.find((entry) => entry.id === slotId);
  if (!slot) return [];
  return oilChoices(current, pid, [slot.locationId]).filter((source) => oilLeft(current, source, used) > 0);
}

function oilPoolKey(source: OilSource): string {
  return source.kind === 'heavyTrain' ? `heavy:${source.linkId}` : `${source.kind}:${source.oilfieldId}`;
}

function oilLeft(current: GameState, source: OilSource, used: Map<string, number>): number {
  const spent = used.get(oilPoolKey(source)) ?? 0;
  if (source.kind === 'heavyTrain') {
    const link = current.links.find((entry) => entry.id === source.linkId);
    return (link?.cubes.oil ?? 0) - spent;
  }
  const field = current.oilfields.find((entry) => entry.id === source.oilfieldId);
  if (!field) return 0;
  const have = source.kind === 'oilfield' ? looseFieldOil(field) : oilCityBarrels(field);
  return have - spent;
}

function sellOrDecline(current: GameState, pid: PlayerId, style: Role, bonus: boolean): Action {
  const found = sellCandidates(current, pid, bonus ? '' : worstCard(current, pid, style));
  return found[0] ?? { type: 'declineSell', playerId: pid };
}

function prepare(current: GameState, action: Action): Action | null {
  let next = action;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = applyAction(clone(current), next);
    if (result.ok) return next;
    const repaired = repair(current, next, result.error);
    if (!repaired) return null;
    next = repaired;
  }
  return null;
}

function repair(current: GameState, action: Action, error: string): Action | null {
  if (action.type === 'build' && error.includes('connected') && action.slotId) {
    const built = tile(action.tileDefId);
    if (error.includes('oil')) {
      const [source] = oilChoices(current, action.playerId, [slotLocation(current, action.slotId)]);
      return source ? { ...action, oilSource: source } : null;
    }
    const groups = industryChoiceGroups(
      current,
      { coal: built.cost.coal, iron: built.cost.iron, coke: built.cost.coke, steel: built.cost.steel },
      [slotLocation(current, action.slotId)],
    );
    if (!groups.length) return null;
    return { ...action, sources: groups.map((group) => preferIndustry(current, action.playerId, group.options)) };
  }
  if (action.type === 'network' && error.includes('Choose which connected')) {
    const placements = action.placements.map((placement) => {
      if (placement.sources.length > 0) return placement;
      const groups = industryChoiceGroups(current, linkResourceCost(placement.kind), destLocationsFor(placement));
      if (!groups.length) return placement;
      return {
        ...placement,
        sources: groups.map((group) => preferIndustry(current, action.playerId, group.options)),
      };
    });
    return { ...action, placements };
  }
  if (action.type === 'develop' && error.includes('Choose which connected')) {
    const groups = industryChoiceGroups(current, { iron: 1 }, []);
    const steel = industryChoiceGroups(current, { steel: 1 }, []);
    const options = groups[0]?.options.length ? groups : steel;
    const group = options[0];
    if (!group) return null;
    return { ...action, sources: [preferIndustry(current, action.playerId, group.options)] };
  }
  if (action.type === 'sell' && error.includes('Choose which merchants')) {
    const ids: string[] = [];
    for (const slotId of action.slotIds) {
      const slot = current.slots.find((entry) => entry.id === slotId);
      if (!slot?.tileDefId) continue;
      const [merchant] = merchantsForSale(current, slot.locationId, tile(slot.tileDefId).kind);
      if (merchant) ids.push(merchant.locationId);
    }
    return ids.length ? { ...action, merchantLocationIds: [...new Set(ids)] } : null;
  }
  if (action.type === 'sell' && error.includes('pipeline')) {
    const oilSources = action.oilSources.slice();
    for (const slotId of action.slotIds) {
      const slot = current.slots.find((entry) => entry.id === slotId);
      if (!slot?.tileDefId) continue;
      const need = tile(slot.tileDefId).oilToSell;
      const [source] = oilChoices(current, action.playerId, [slot.locationId]);
      if (!source) return null;
      for (let n = oilSources.filter((entry) => entry.slotId === slotId).length; n < need; n++) {
        oilSources.push({ ...source, slotId });
      }
    }
    return { ...action, oilSources };
  }
  return null;
}

function scoreAction(before: GameState, after: GameState, pid: PlayerId, action: Action, style: Role): number {
  const from = player(before, pid);
  const to = player(after, pid);
  const text = after.log.slice(before.log.length).map((entry) => entry.text).join(' ');
  const boughtOutside = countOf(text, '从外部购买');
  const freeCoal = countOf(text, '的免费煤');
  const freeIron = countOf(text, '的免费铁');
  const freeCoke = countOf(text, '的免费焦炭');
  const freeSteel = countOf(text, '的免费钢');
  const filled = marketStock(after) - marketStock(before);
  const coalHoles = emptyCoal(before);
  const unfinished = mainRemaining(before, pid, style);
  let score = (to.incomeSpace - from.incomeSpace) * 8 + (to.money - from.money) * 0.35 + (to.vp - from.vp) * 2;
  score -= Math.max(0, looseSteel(after) - looseSteel(before) - 1) * 18;
  score += filled * 20;
  score += (freeCoal + freeIron + freeCoke) * 6;
  score += freeSteel * 14;
  score += (countOf(text, '购买') - boughtOutside) * 10;
  score -= boughtOutside * 40;
  if (action.type === 'build') {
    const built = tile(action.tileDefId);
    const resource = built.kind === 'coal' || built.kind === 'coke' || built.kind === 'iron' || built.kind === 'steel';
    const mainLine = built.kind === 'manufacturing' || built.kind === 'kerosene';
    const card = from.hand.find((entry) => entry.id === action.cardId);
    const flying = card ? cardDef(card.defId).kind === 'location' : false;
    if (built.kind === 'coal' && coalHoles >= 2) score += 110 + coalHoles * 6;
    if (built.kind === 'coal' && coalHoles >= 2 && filled > 0) score += 24;
    if (resource && filled > 0 && built.kind !== 'coal') score += 12;
    if (resource && filled === 0 && !(built.kind === 'coal' && coalHoles >= 2)) score -= 12;
    if (mainLine && boughtOutside > 0) score -= 70;
    if (mainLine && flying) score += 28;
    if (mainLine && unfinished > 0) score += 36;
    if ((built.id === 'm1' || built.id === 'm2') && action.slotId) {
      const hops = linksToSellMarket(before, slotLocation(before, action.slotId), 'manufacturing');
      score -= hops * (built.id === 'm1' && flying ? 16 : 8);
    }
    if (built.id === 'm2' && flying && boughtOutside > 0) {
      const late = eraLate(before.round);
      score -= 100 * (1 - late);
      score += 36 * late;
    }
    score += buildRank(before, pid, style, built);
  }
  const short = from.money < (style === 'box' ? 12 : 11);
  const beforeDanger = billDanger(from.money, from.incomeSpace);
  const afterDanger = billDanger(to.money, to.incomeSpace);
  const lastAction = before.actionsTaken + 1 >= before.actionsAllowed;
  if (afterDanger > 0) {
    if (afterDanger < beforeDanger) score += 80;
    else score -= afterDanger >= 1000 ? (lastAction ? 900 : 450) : lastAction ? 520 : 280;
  } else if (beforeDanger > 0) score += 360;
  if (action.type === 'loan') score += short && unfinished > 0 && afterDanger === 0 ? 55 : short ? 16 : -28;
  if (action.type === 'pass') score -= 40;
  if (action.type === 'develop') {
    const removed = action.tileDefIds;
    if (removed.some((id) => id === 'm1' || id === 'm2' || id === 'k2' || id === 'k3')) score -= 60;
    else if (style === 'box' && removed.includes('i1') && builtCount(before, pid, 'm2') === 0) score += 8;
    else score -= 18;
  }
  if (action.type === 'sell') score += (unfinished > 0 ? 30 : 10) + Math.max(0, action.slotIds.length - 1) * 40;
  if (action.type === 'network') {
    score += freeSteel > 0 ? 6 : 0;
    const late = before.round >= 5;
    for (const placement of action.placements) {
      const towardGoods = late && extendsUnsold(before, pid, placement.lineId);
      if (placement.kind === 'pipeline' && placement.pipelineType === 'income') score += style === 'oil' ? 22 : 10;
      if (placement.kind === 'lightTrain') {
        const points = roadPoints(before, placement.lineId);
        if (towardGoods) score += 40;
        else {
          score += points >= 5 ? points : -28;
          if (unfinished > 0) score -= 36;
          if (action.placements.indexOf(placement) === 1) score -= 24;
        }
      } else if (placement.kind !== 'pipeline') {
        score += roadPoints(before, placement.lineId);
        if (towardGoods) score += 40;
      }
      const line = rail(placement.lineId);
      if (line?.bonus?.freeDevelop && placement.kind !== 'lightTrain') score += 6;
    }
    if (late) score += newlyReachableGoods(before, after, pid) * 80;
  }
  return score;
}

export function countOf(text: string, piece: string): number {
  return text.split(piece).length - 1;
}

function emptyCoal(current: GameState): number {
  let empty = 0;
  for (const market of current.markets) {
    const def = marketDef(market.id);
    if (!def) continue;
    const column = def.cubes.indexOf('coal');
    if (column < 0) continue;
    const per = market.slots.length / def.cubes.length;
    for (let index = 0; index < per; index += 1) {
      if (!market.slots[column * per + index]?.cube) empty += 1;
    }
  }
  return empty;
}

function mainRemaining(current: GameState, pid: PlayerId, style: Role): number {
  if (style === 'box') {
    return Math.max(0, 2 - builtCount(current, pid, 'm1')) + (builtCount(current, pid, 'm2') < 1 ? 1 : 0);
  }
  return Math.max(0, 2 - builtCount(current, pid, 'k2')) + (builtCount(current, pid, 'k3') < 1 ? 1 : 0);
}

function marketStock(current: GameState): number {
  return current.markets.reduce((sum, market) => sum + market.slots.filter((slot) => slot.cube).length, 0);
}

export function builtCount(current: GameState, pid: PlayerId, defId: string): number {
  return current.slots.filter((slot) => slot.owner === pid && slot.tileDefId === defId).length;
}

function buildRank(current: GameState, pid: PlayerId, style: Role, built: TileDef): number {
  const m1 = builtCount(current, pid, 'm1');
  const m2 = builtCount(current, pid, 'm2');
  const k2 = builtCount(current, pid, 'k2');
  const k3 = builtCount(current, pid, 'k3');
  let score = 0;
  if (built.kind === 'coal' || built.kind === 'coke') score += 30;
  if (built.kind === 'iron' || built.kind === 'steel') score += style === 'box' ? 24 : 6;
  if (built.upgradeFrom) score += 6;
  if (style === 'box') {
    if (built.id === 'm1' && m1 < 2) score += 72;
    if (built.id === 'm2' && m2 < 1) score += 86;
    if (built.id === 's2' && m2 < 1) score += 26;
    if (built.id === 'i1' && m2 < 1) score += 10;
    if (built.id === 'm3' || built.kind === 'automobile' || built.kind === 'skyscraper' || built.kind === 'locomotive' || built.kind === 'kerosene' || built.kind === 'oilCity') {
      score -= 48;
    }
  }
  if (style === 'oil') {
    if (built.id === 'k2' && k2 < 2) score += 76;
    if (built.id === 'k3' && k3 === 0) score += 88;
    if (built.id === 'k3' && k3 === 1) score += 36;
    if (built.kind === 'coal') score += 14;
    if (built.kind === 'manufacturing' || built.kind === 'automobile' || built.kind === 'skyscraper' || built.kind === 'locomotive' || built.id === 'k4' || built.kind === 'oilCity') {
      score -= 48;
    }
  }
  return score;
}

export function assignRoles(current: GameState): Record<PlayerId, Role> {
  const ranked = current.players.map((entry) => {
    let box = 0;
    let oil = 0;
    for (const card of entry.hand) {
      const def = cardDef(card.defId);
      if (def.kind !== 'industry' || !def.industry) continue;
      if (def.industry === 'manufacturing') box += 3;
      if (def.industry === 'coal' || def.industry === 'coke' || def.industry === 'iron' || def.industry === 'steel') box += 1;
      if (def.industry === 'kerosene' || def.industry === 'oilCity') oil += 3;
    }
    return { id: entry.id, delta: box - oil };
  });
  ranked.sort((a, b) => b.delta - a.delta || a.id - b.id);
  const roles = { 0: 'oil', 1: 'oil', 2: 'oil', 3: 'oil' } as Record<PlayerId, Role>;
  for (const [index, entry] of ranked.entries()) roles[entry.id] = index < 2 ? 'box' : 'oil';
  return roles;
}

function freeDevelop(current: GameState, pid: PlayerId, style: Role): Action {
  const open = accessibleTileIds(player(current, pid).mat);
  const order = style === 'box' ? ['k2', 'a1'] : ['m1', 'i1', 'a1'];
  const tileDefId = order.find((id) => open.has(id));
  return tileDefId ? { type: 'oilDevelop', playerId: pid, tileDefId } : { type: 'declineOilDevelop', playerId: pid };
}

function developIds(current: GameState, pid: PlayerId, style: Role): string[] {
  const open = accessibleTileIds(player(current, pid).mat);
  if (style === 'box' && open.has('i1') && builtCount(current, pid, 'm1') >= 2 && builtCount(current, pid, 'm2') === 0 && builtCount(current, pid, 's2') === 0) {
    return ['i1'];
  }
  return [];
}

/** 0 through round 4, then rises to 1 by round 8. */
function eraLate(round: number): number {
  if (round < 5) return 0;
  return Math.min(1, (round - 4) / 4);
}

/** Unbuilt rail links between a city and the nearest merchant that currently buys this industry. Already-connected cities are 0. */
export function linksToSellMarket(state: GameState, city: string, kind: IndustryKind): number {
  const targets = state.merchants.filter((merchant) => merchantSells(merchant, kind)).map((merchant) => merchant.locationId);
  if (targets.length === 0) return 8;
  if (targets.some((id) => railConnected(state, city, id))) return 0;
  const occupied = occupiedRailLineIds(state);
  const next = new Map<string, { to: string; cost: number }[]>();
  for (const line of mapData.railLines) {
    const cost = occupied.has(line.id) ? 0 : 1;
    for (const [from, to] of [
      [line.a, line.b],
      [line.b, line.a],
    ] as const) {
      const list = next.get(from) ?? [];
      list.push({ to, cost });
      next.set(from, list);
    }
  }
  const dist = new Map<string, number>([[city, 0]]);
  const queue = [city];
  const goal = new Set(targets);
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const soFar = dist.get(current) ?? 0;
    if (goal.has(current)) return Math.min(8, soFar);
    for (const edge of next.get(current) ?? []) {
      const candidate = soFar + edge.cost;
      if (candidate >= (dist.get(edge.to) ?? 99)) continue;
      dist.set(edge.to, candidate);
      if (edge.cost === 0) queue.unshift(edge.to);
      else queue.push(edge.to);
    }
  }
  return 8;
}

function billDanger(money: number, space: number): number {
  const due = Math.max(0, -incomeLevelAt(space));
  if (due === 0) return 0;
  const left = money - due;
  if (left < 0) return 1000 - left;
  if (left < due) return 400 + (due - left);
  return 0;
}

function unsoldWithoutMarket(current: GameState, pid: PlayerId): string[] {
  const cities: string[] = [];
  for (const slot of current.slots) {
    if (slot.owner !== pid || !slot.tileDefId || slot.flipped) continue;
    const def = tile(slot.tileDefId);
    if (!def.sellable) continue;
    if (merchantsForSale(current, slot.locationId, def.kind).length > 0) continue;
    cities.push(slot.locationId);
  }
  return cities;
}

function extendsUnsold(current: GameState, pid: PlayerId, lineId: string): boolean {
  const line = rail(lineId);
  if (!line) return false;
  return unsoldWithoutMarket(current, pid).some((city) => {
    const touchesA = railConnected(current, city, line.a);
    const touchesB = railConnected(current, city, line.b);
    return touchesA !== touchesB;
  });
}

function newlyReachableGoods(before: GameState, after: GameState, pid: PlayerId): number {
  let opened = 0;
  for (const slot of before.slots) {
    if (slot.owner !== pid || !slot.tileDefId || slot.flipped) continue;
    const def = tile(slot.tileDefId);
    if (!def.sellable) continue;
    const blocked = merchantsForSale(before, slot.locationId, def.kind).length === 0;
    const open = merchantsForSale(after, slot.locationId, def.kind).length > 0;
    if (blocked && open) opened += 1;
  }
  return opened;
}

function worthSecond(current: GameState, pid: PlayerId, lineId: string, kind: string): boolean {
  if (kind === 'pipeline') {
    const line = pipeline(lineId);
    return line?.oil !== undefined;
  }
  if (current.round >= 5 && extendsUnsold(current, pid, lineId)) return true;
  return roadPoints(current, lineId) >= 5;
}

function roadPoints(current: GameState, lineId: string): number {
  const line = rail(lineId);
  if (!line) return 0;
  return locationLinkPoints(current, line.a) + locationLinkPoints(current, line.b);
}

function worstCard(current: GameState, pid: PlayerId, style: Role): string | null {
  const hand = player(current, pid).hand;
  if (hand.length === 0) return null;
  return hand
    .map((card) => ({ id: card.id, keep: keepScore(card.defId, style) }))
    .sort((a, b) => a.keep - b.keep)[0]!.id;
}

function keepScore(defId: string, style: Role): number {
  const def = cardDef(defId);
  if (def.kind === 'location') return 4;
  if (def.kind !== 'industry' || !def.industry) return 1;
  if (style === 'box') {
    if (def.industry === 'manufacturing') return 6;
    if (def.industry === 'coal' || def.industry === 'coke' || def.industry === 'iron' || def.industry === 'steel') return 5;
    return 0;
  }
  if (def.industry === 'kerosene' || def.industry === 'oilCity') return 6;
  if (def.industry === 'coal' || def.industry === 'coke') return 5;
  return 0;
}

function cardCanBuild(defId: string, built: TileDef, locationId: string): boolean {
  const def = cardDef(defId);
  if (def.kind === 'location') return def.locationId === locationId;
  if (def.kind === 'industry') return industryCardMatches(def.industry, built);
  return false;
}

function preferIndustry(current: GameState, pid: PlayerId, options: { slotId: string; owner: PlayerId | null }[]): CubeSource {
  const own = options.find((option) => option.owner === pid);
  const slot = current.slots.find((entry) => entry.id === (own ?? options[0])?.slotId);
  return { kind: 'industry', slotId: slot?.id ?? options[0]!.slotId };
}

function slotLocation(current: GameState, slotId: string): string {
  return current.slots.find((slot) => slot.id === slotId)?.locationId ?? '';
}

function looseSteel(current: GameState): number {
  const onSlots = current.slots.reduce((sum, slot) => sum + (slot.cubes.steel ?? 0), 0);
  const onMarkets = current.markets.reduce(
    (sum, market) => sum + market.slots.filter((slot) => slot.cube === 'steel').length,
    0,
  );
  return onSlots + onMarkets;
}

