import { location, mapData, market as marketDef, tile } from './catalog';
import { railConnected } from './graph';
import { describeReward, lineName, placeName, playerTag, tileName } from './logText';
import { deferLog } from './logQueue';
import { applyReward } from './rewards';
import { spendMoney } from './turn';
import type { Cube, CubeSource, GameState, PlayerId } from './types';

const CUBE_ORDER: Cube[] = ['coal', 'iron', 'coke', 'steel'];

export function expandCubes(need: Partial<Record<Cube, number>>): Cube[] {
  const out: Cube[] = [];
  for (const cube of CUBE_ORDER) {
    const n = need[cube] ?? 0;
    for (let i = 0; i < n; i++) out.push(cube);
  }
  return out;
}

export type SpendStep =
  | { kind: 'industry'; cube: Cube; slotId: string; locationId: string }
  | { kind: 'market'; cube: Cube; marketId: string; price: number; name: string }
  | { kind: 'heavyTrain'; cube: Cube; linkId: string }
  | { kind: 'vanderbilt'; cube: Cube; price: number };

const CUBE_LABEL: Record<Cube, string> = { coal: '煤', iron: '铁', coke: '焦炭', steel: '钢' };

/** How an automatic build or link would pay for cubes. Industry on the connection is free and comes first. */
export function planCubeSpend(
  state: GameState,
  playerId: PlayerId,
  need: Partial<Record<Cube, number>>,
  destLocations: string[],
  forbidHeavyLinkId?: string,
): { ok: true; steps: SpendStep[] } | { ok: false; error: string } {
  const steps: SpendStep[] = [];
  const usedIndustry = new Map<string, number>();
  const usedMarket = new Map<string, number>();
  const usedHeavy = new Map<string, number>();
  for (const cube of expandCubes(need)) {
    const industry = industrySources(state, cube, destLocations, usedIndustry)[0];
    if (industry?.kind === 'industry') {
      const slot = state.slots.find((s) => s.id === industry.slotId);
      if (!slot) return { ok: false, error: `Cannot source ${cube}.` };
      steps.push({ kind: 'industry', cube, slotId: slot.id, locationId: slot.locationId });
      usedIndustry.set(slot.id, (usedIndustry.get(slot.id) ?? 0) + 1);
      continue;
    }
    const auto = autoPaidSource(state, playerId, cube, destLocations, usedMarket, usedHeavy, forbidHeavyLinkId);
    if (!auto) return { ok: false, error: `Cannot source ${cube} on a connected route.` };
    if (auto.kind === 'market') {
      const def = marketDef(auto.marketId);
      if (!def) return { ok: false, error: 'Market missing.' };
      steps.push({ kind: 'market', cube, marketId: auto.marketId, price: def.price, name: def.name });
      continue;
    }
    if (auto.kind === 'heavyTrain') {
      steps.push({ kind: 'heavyTrain', cube, linkId: auto.linkId });
      usedHeavy.set(auto.linkId, (usedHeavy.get(auto.linkId) ?? 0) + 1);
      continue;
    }
    if (auto.kind === 'vanderbilt') {
      steps.push({ kind: 'vanderbilt', cube, price: mapData.vanderbilt[cube] });
      continue;
    }
    return { ok: false, error: `Cannot source ${cube} on a connected route.` };
  }
  return { ok: true, steps };
}

export function spendMoneyOf(steps: SpendStep[]): number {
  return steps.reduce((sum, step) => sum + (step.kind === 'market' || step.kind === 'vanderbilt' ? step.price : 0), 0);
}

export function formatSpend(state: GameState, steps: SpendStep[]): string {
  return steps
    .map((step) => {
      const name = CUBE_LABEL[step.cube];
      if (step.kind === 'industry') {
        const slot = state.slots.find((entry) => entry.id === step.slotId);
        const where = placeName(step.locationId || slot?.locationId || '');
        const who = slot?.owner != null ? playerTag(slot.owner) : '无主';
        return `用 ${who} 在 ${where} 的免费${name}`;
      }
      if (step.kind === 'market') return `从${step.name}购买${name}，支付 $${step.price}`;
      if (step.kind === 'vanderbilt') return `从外部购买${name}，支付 $${step.price}`;
      const link = state.links.find((entry) => entry.id === step.linkId);
      const who = link ? playerTag(link.owner) : '';
      const where = link ? lineName(link.lineId) : '';
      return `用 ${who} 在 ${where} 重车上的${name}`;
    })
    .join('，');
}

export function consumeCubes(
  state: GameState,
  playerId: PlayerId,
  need: Partial<Record<Cube, number>>,
  destLocations: string[],
  given: CubeSource[],
  forbidHeavyLinkId?: string,
): { ok: true; steps: SpendStep[] } | { ok: false; error: string } {
  const cubes = expandCubes(need);
  if (given.length > 0 && given.length !== cubes.length) {
    return { ok: false, error: 'Wrong number of resource sources.' };
  }
  const usedIndustry = new Map<string, number>();
  const usedHeavy = new Map<string, number>();
  if (given.length === 0) {
    for (const cube of cubes) {
      const options = industrySources(state, cube, destLocations, usedIndustry);
      if (options.length > 1) return { ok: false, error: `Choose which connected ${cube} to use.` };
      const only = options[0];
      if (only?.kind === 'industry') usedIndustry.set(only.slotId, (usedIndustry.get(only.slotId) ?? 0) + 1);
    }
    usedIndustry.clear();
    const plan = planCubeSpend(state, playerId, need, destLocations, forbidHeavyLinkId);
    if (!plan.ok) return plan;
    for (const step of plan.steps) {
      const source: CubeSource =
        step.kind === 'industry'
          ? { kind: 'industry', slotId: step.slotId }
          : step.kind === 'market'
            ? { kind: 'market', marketId: step.marketId }
            : step.kind === 'heavyTrain'
              ? { kind: 'heavyTrain', linkId: step.linkId }
              : { kind: 'vanderbilt' };
      const taken = takeCube(state, playerId, step.cube, destLocations, source, usedIndustry, usedHeavy, forbidHeavyLinkId);
      if (!taken.ok) return taken;
    }
    return { ok: true, steps: plan.steps };
  }
  let gi = 0;
  const steps: SpendStep[] = [];
  for (const cube of cubes) {
    const industryOpts = industrySources(state, cube, destLocations, usedIndustry);
    const next = given[gi++];
    if (!next) return { ok: false, error: 'Missing resource source.' };
    if (industryOpts.length > 0 && next.kind !== 'industry') {
      return { ok: false, error: `Must take ${cube} from a connected industry.` };
    }
    const taken = takeCube(state, playerId, cube, destLocations, next, usedIndustry, usedHeavy, forbidHeavyLinkId);
    if (!taken.ok) return taken;
    steps.push(stepFromSource(state, cube, next));
  }
  return { ok: true, steps };
}

function stepFromSource(state: GameState, cube: Cube, source: CubeSource): SpendStep {
  if (source.kind === 'industry') {
    const slot = state.slots.find((s) => s.id === source.slotId);
    return { kind: 'industry', cube, slotId: source.slotId, locationId: slot?.locationId ?? '' };
  }
  if (source.kind === 'market') {
    const def = marketDef(source.marketId);
    return { kind: 'market', cube, marketId: source.marketId, price: def?.price ?? 0, name: def?.name ?? source.marketId };
  }
  if (source.kind === 'heavyTrain') return { kind: 'heavyTrain', cube, linkId: source.linkId };
  return { kind: 'vanderbilt', cube, price: mapData.vanderbilt[cube] };
}

export type IndustryOption = {
  slotId: string;
  locationId: string;
  owner: PlayerId | null;
  remaining: number;
};

/** Cubes that have more than one free connected industry. The player picks; paid sources stay closed. */
export function industryChoiceGroups(
  state: GameState,
  need: Partial<Record<Cube, number>>,
  destLocations: string[],
): { cube: Cube; options: IndustryOption[] }[] {
  const used = new Map<string, number>();
  const groups: { cube: Cube; options: IndustryOption[] }[] = [];
  for (const cube of expandCubes(need)) {
    const sources = industrySources(state, cube, destLocations, used);
    if (sources.length > 1) {
      groups.push({
        cube,
        options: sources.flatMap((source) => {
          if (source.kind !== 'industry') return [];
          const slot = state.slots.find((entry) => entry.id === source.slotId);
          if (!slot) return [];
          return [
            {
              slotId: slot.id,
              locationId: slot.locationId,
              owner: slot.owner,
              remaining: (slot.cubes[cube] ?? 0) - (used.get(slot.id) ?? 0),
            },
          ];
        }),
      });
      continue;
    }
    const only = sources[0];
    if (only?.kind === 'industry') used.set(only.slotId, (used.get(only.slotId) ?? 0) + 1);
  }
  return groups;
}

/** Fill every cube. Ambiguous free industries come from `picks`, in order. Paid sources are used only when no free industry can pay. */
export function fillCubeSources(
  state: GameState,
  playerId: PlayerId,
  need: Partial<Record<Cube, number>>,
  destLocations: string[],
  picks: CubeSource[],
  forbidHeavyLinkId?: string,
): CubeSource[] | null {
  const usedIndustry = new Map<string, number>();
  const usedMarket = new Map<string, number>();
  const usedHeavy = new Map<string, number>();
  const out: CubeSource[] = [];
  let pickIndex = 0;
  for (const cube of expandCubes(need)) {
    const options = industrySources(state, cube, destLocations, usedIndustry);
    if (options.length > 1) {
      const pick = picks[pickIndex];
      const chosen =
        pick?.kind === 'industry' ? options.find((option) => option.kind === 'industry' && option.slotId === pick.slotId) : undefined;
      if (!chosen || chosen.kind !== 'industry') return null;
      pickIndex += 1;
      out.push({ kind: 'industry', slotId: chosen.slotId });
      usedIndustry.set(chosen.slotId, (usedIndustry.get(chosen.slotId) ?? 0) + 1);
      continue;
    }
    const only = options[0];
    if (only?.kind === 'industry') {
      out.push(only);
      usedIndustry.set(only.slotId, (usedIndustry.get(only.slotId) ?? 0) + 1);
      continue;
    }
    const paid = autoPaidSource(state, playerId, cube, destLocations, usedMarket, usedHeavy, forbidHeavyLinkId);
    if (!paid) return null;
    out.push(paid);
    if (paid.kind === 'heavyTrain') usedHeavy.set(paid.linkId, (usedHeavy.get(paid.linkId) ?? 0) + 1);
  }
  return pickIndex === picks.length ? out : null;
}

export interface SpendChoice {
  ready: boolean;
  sources: CubeSource[];
  /** Buildings the player must click for the next free cube. */
  nextIndustrySlotIds: string[];
  /** Paid cubes that still use the cheapest market, or Vanderbilt when that market is short. */
  openPaidCubes: Cube[];
}

/**
 * Free industry cubes are mandatory. Paid cubes use an explicit pick when the player made one,
 * otherwise the cheapest connected market that still has stock, then Vanderbilt.
 */
export function resolveSpend(
  state: GameState,
  playerId: PlayerId,
  need: Partial<Record<Cube, number>>,
  destLocations: string[],
  picks: CubeSource[],
  forbidHeavyLinkId?: string,
): SpendChoice {
  const industryQueue = picks.filter((pick) => pick.kind === 'industry');
  const paidQueue = picks.filter(
    (pick): pick is Exclude<CubeSource, { kind: 'industry' | 'oilCity' }> =>
      pick.kind === 'market' || pick.kind === 'heavyTrain' || pick.kind === 'vanderbilt',
  );
  const usedIndustry = new Map<string, number>();
  const usedMarket = new Map<string, number>();
  const usedHeavy = new Map<string, number>();
  const usedPaid = new Set<number>();
  const sources: CubeSource[] = [];
  const openPaidCubes: Cube[] = [];
  let industryAt = 0;
  for (const cube of expandCubes(need)) {
    const options = industrySources(state, cube, destLocations, usedIndustry);
    if (options.length > 1) {
      const pick = industryQueue[industryAt];
      const chosen =
        pick?.kind === 'industry'
          ? options.find((option) => option.kind === 'industry' && option.slotId === pick.slotId)
          : undefined;
      if (!chosen || chosen.kind !== 'industry') {
        return {
          ready: false,
          sources,
          nextIndustrySlotIds: options.flatMap((option) => (option.kind === 'industry' ? [option.slotId] : [])),
          openPaidCubes: [],
        };
      }
      industryAt += 1;
      sources.push({ kind: 'industry', slotId: chosen.slotId, cube });
      usedIndustry.set(chosen.slotId, (usedIndustry.get(chosen.slotId) ?? 0) + 1);
      continue;
    }
    const only = options[0];
    if (only?.kind === 'industry') {
      sources.push({ ...only, cube });
      usedIndustry.set(only.slotId, (usedIndustry.get(only.slotId) ?? 0) + 1);
      continue;
    }
    const paidAt = paidQueue.findIndex((pick, index) => !usedPaid.has(index) && pick.cube === cube);
    const picked = paidAt >= 0 ? paidQueue[paidAt] : undefined;
    if (picked && paidSourceLegal(state, playerId, cube, destLocations, picked, usedMarket, usedHeavy, forbidHeavyLinkId)) {
      usedPaid.add(paidAt);
      sources.push({ ...picked, cube });
      notePaidUse(picked, cube, usedMarket, usedHeavy);
      continue;
    }
    const auto = autoPaidSource(state, playerId, cube, destLocations, usedMarket, usedHeavy, forbidHeavyLinkId);
    if (!auto) {
      return { ready: false, sources, nextIndustrySlotIds: [], openPaidCubes: [cube] };
    }
    sources.push(auto);
    openPaidCubes.push(cube);
  }
  return { ready: true, sources, nextIndustrySlotIds: [], openPaidCubes };
}

function notePaidUse(
  source: CubeSource,
  cube: Cube,
  usedMarket: Map<string, number>,
  usedHeavy: Map<string, number>,
): void {
  if (source.kind === 'market') {
    usedMarket.set(`${source.marketId}:${cube}`, (usedMarket.get(`${source.marketId}:${cube}`) ?? 0) + 1);
  }
  if (source.kind === 'heavyTrain') usedHeavy.set(source.linkId, (usedHeavy.get(source.linkId) ?? 0) + 1);
}

function paidSourceLegal(
  state: GameState,
  playerId: PlayerId,
  cube: Cube,
  destLocations: string[],
  source: CubeSource,
  usedMarket: Map<string, number>,
  usedHeavy: Map<string, number>,
  forbidHeavyLinkId?: string,
): boolean {
  if (source.kind === 'vanderbilt') return true;
  if (source.kind === 'market') {
    const def = marketDef(source.marketId);
    if (!def || !def.cubes.includes(cube)) return false;
    if (!connectedToAny(state, def.locationId, destLocations)) return false;
    return marketLeft(state, source.marketId, cube, usedMarket) > 0;
  }
  if (source.kind === 'heavyTrain') {
    if (source.linkId === forbidHeavyLinkId) return false;
    const link = state.links.find((entry) => entry.id === source.linkId);
    if (!link || link.owner !== playerId) return false;
    if ((link.cubes[cube] ?? 0) - (usedHeavy.get(link.id) ?? 0) <= 0) return false;
    const ends = mapData.railLines.find((rail) => rail.id === link.lineId);
    if (!ends) return false;
    return connectedToAny(state, ends.a, destLocations) || connectedToAny(state, ends.b, destLocations);
  }
  return false;
}

function industrySources(
  state: GameState,
  cube: Cube,
  destLocations: string[],
  used: Map<string, number>,
): CubeSource[] {
  const out: CubeSource[] = [];
  for (const slot of state.slots) {
    if (!slot.tileDefId) continue;
    const have = (slot.cubes[cube] ?? 0) - (used.get(slot.id) ?? 0);
    if (have <= 0) continue;
    if (!connectedToAny(state, slot.locationId, destLocations)) continue;
    out.push({ kind: 'industry', slotId: slot.id });
  }
  return out;
}

function marketLeft(state: GameState, marketId: string, cube: Cube, usedMarket: Map<string, number>): number {
  const market = state.markets.find((entry) => entry.id === marketId);
  const have = market?.slots.filter((slot) => slot.cube === cube).length ?? 0;
  return have - (usedMarket.get(`${marketId}:${cube}`) ?? 0);
}

/** Cheapest connected market that still has a cube, otherwise Vanderbilt. A heavy train's cube is never spent unless the player picks it. */
function autoPaidSource(
  state: GameState,
  playerId: PlayerId,
  cube: Cube,
  destLocations: string[],
  usedMarket: Map<string, number>,
  usedHeavy: Map<string, number>,
  forbidHeavyLinkId?: string,
): CubeSource | null {
  void playerId;
  void usedHeavy;
  void forbidHeavyLinkId;
  let best: { marketId: string; price: number } | null = null;
  for (const market of state.markets) {
    const def = marketDef(market.id);
    if (!def || !def.cubes.includes(cube)) continue;
    if (marketLeft(state, market.id, cube, usedMarket) <= 0) continue;
    if (!connectedToAny(state, def.locationId, destLocations)) continue;
    if (!best || def.price < best.price) best = { marketId: market.id, price: def.price };
  }
  if (best) {
    usedMarket.set(`${best.marketId}:${cube}`, (usedMarket.get(`${best.marketId}:${cube}`) ?? 0) + 1);
    return { kind: 'market', marketId: best.marketId, cube };
  }
  return { kind: 'vanderbilt', cube };
}

/** Connected places a cube can come from. Industry cubes, when any exist, are the only choices. */
export function cubeOptions(
  state: GameState,
  playerId: PlayerId,
  cube: Cube,
  destLocations: string[],
  forbidHeavyLinkId?: string,
): CubeSource[] {
  const industry = industrySources(state, cube, destLocations, new Map()).map((source) => ({ ...source, cube }));
  if (industry.length) return industry;
  const out: CubeSource[] = [];
  for (const link of state.links) {
    if (link.owner !== playerId || link.kind === 'pipeline' || link.id === forbidHeavyLinkId) continue;
    if ((link.cubes[cube] ?? 0) <= 0) continue;
    const ends = mapData.railLines.find((rail) => rail.id === link.lineId);
    if (!ends) continue;
    if (connectedToAny(state, ends.a, destLocations) || connectedToAny(state, ends.b, destLocations)) {
      out.push({ kind: 'heavyTrain', linkId: link.id, cube });
    }
  }
  for (const market of state.markets) {
    const def = marketDef(market.id);
    if (!def || !market.slots.some((slot) => slot.cube === cube)) continue;
    if (!connectedToAny(state, def.locationId, destLocations)) continue;
    out.push({ kind: 'market', marketId: market.id, cube });
  }
  out.push({ kind: 'vanderbilt', cube });
  return out;
}

function takeCube(
  state: GameState,
  playerId: PlayerId,
  cube: Cube,
  destLocations: string[],
  source: CubeSource,
  _usedIndustry: Map<string, number>,
  _usedHeavy: Map<string, number>,
  forbidHeavyLinkId?: string,
): { ok: true } | { ok: false; error: string } {
  if (source.kind === 'industry') {
    const slot = state.slots.find((s) => s.id === source.slotId);
    if (!slot?.tileDefId) return { ok: false, error: 'Industry source missing.' };
    // slot.cubes 由 takeCube 逐个扣减，是唯一权威；used 只在规划（不扣减）阶段用，这里不能再减 used，
    // 否则同一产业被选两次时会双记账误报 No cube。
    const have = (slot.cubes[cube] ?? 0);
    if (have <= 0) return { ok: false, error: `No ${cube} on that industry.` };
    if (!connectedToAny(state, slot.locationId, destLocations)) {
      return { ok: false, error: 'Industry is not connected.' };
    }
    slot.cubes[cube] = (slot.cubes[cube] ?? 0) - 1;
    if (!hasCubes(slot.cubes) && !slot.flipped && slot.tileDefId) {
      const built = tile(slot.tileDefId);
      const produced = ['coal', 'iron', 'coke', 'steel'].some((kind) => (built.produces[kind as Cube] ?? 0) > 0);
      if (produced) {
        slot.flipped = true;
        const ownerId = slot.owner ?? playerId;
        applyReward(state, ownerId, built.flipReward);
        const where = location(slot.locationId)?.name ?? slot.locationId;
        deferLog(state, `${playerTag(ownerId)} 的 ${where} ${tileName(built.id)} 资源用完，翻面，${describeReward(built.flipReward)}。`);
      }
    }
    return { ok: true };
  }
  if (source.kind === 'heavyTrain') {
    if (source.linkId === forbidHeavyLinkId) {
      return { ok: false, error: 'Cannot use steel from the heavy train being built.' };
    }
    const link = state.links.find((l) => l.id === source.linkId);
    if (!link || link.owner !== playerId) return { ok: false, error: 'Heavy train source missing.' };
    const ends = mapData.railLines.find((rail) => rail.id === link.lineId);
    if (!ends || !(connectedToAny(state, ends.a, destLocations) || connectedToAny(state, ends.b, destLocations))) {
      return { ok: false, error: 'Heavy train is not connected.' };
    }
    // 与产业同理：link.cubes 已逐个扣减，不再减 usedHeavy，避免同一重车被选多次时双记账。
    const have = (link.cubes[cube] ?? 0);
    if (have <= 0) return { ok: false, error: `No ${cube} on that train.` };
    link.cubes[cube] = (link.cubes[cube] ?? 0) - 1;
    return { ok: true };
  }
  if (source.kind === 'market') {
    const def = marketDef(source.marketId);
    const market = state.markets.find((m) => m.id === source.marketId);
    if (!def || !market) return { ok: false, error: 'Market missing.' };
    if (!connectedToAny(state, def.locationId, destLocations)) {
      return { ok: false, error: 'Market is not connected.' };
    }
    const slot = market.slots.find((s) => s.cube === cube);
    if (!slot) return { ok: false, error: `No ${cube} in that market.` };
    if (!spendMoney(state, playerId, def.price)) {
      return { ok: false, error: `Need $${def.price} for ${cube} at ${def.name}.` };
    }
    slot.cube = null;
    return { ok: true };
  }
  if (source.kind === 'vanderbilt') {
    const price = mapData.vanderbilt[cube];
    if (!spendMoney(state, playerId, price)) {
      return { ok: false, error: `Need $${price} for Vanderbilt ${cube}.` };
    }
    return { ok: true };
  }
  if (source.kind === 'oilCity') return { ok: false, error: 'Oil City is not a cube source.' };
  return { ok: false, error: 'Unknown cube source.' };
}

function connectedToAny(state: GameState, from: string, destLocations: string[]): boolean {
  return destLocations.some((d) => railConnected(state, from, d));
}

export function hasCubes(cubes: Partial<Record<string, number>>): boolean {
  return Object.values(cubes).some((n) => (n ?? 0) > 0);
}
