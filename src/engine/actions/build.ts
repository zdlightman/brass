import { oilChoices, payPipeline } from './sell';
import { cardLabel, discardCard } from '../cards';
import { describeReward, lineName, placeName, playerTag, tileName } from '../logText';
import { cardDef, location, mapData, pipeline, tile } from '../catalog';
import { eraPoints } from '../era';
import { inNetwork, playerHasBoardPresence } from '../graph';
import { decreaseIncomeLevels } from '../income';
import { accessibleTileDefs, player, removeMatTile } from '../mat';
import { sellProducedToMarkets, type SalePick } from '../markets';
import { takeOilBarrel } from '../oil';
import { consumeCubes, formatSpend, planCubeSpend, spendMoneyOf, type SpendStep } from '../resources';
import { applyReward } from '../rewards';
import { logAction, spendMoney } from '../turn';
import type {
  Action,
  ActionResult,
  CubeSource,
  GameState,
  IndustryKind,
  OilSource,
  PlayerId,
  SlotState,
  TileDef,
} from '../types';

export function applyBuild(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
): ActionResult {
  pendingSpend = [];
  pendingOilNote = '';
  const p = player(state, action.playerId);
  const t = tile(action.tileDefId);
  if (!accessibleTileDefs(p).some((x) => x.id === t.id)) {
    return { ok: false, error: 'That industry is not accessible.' };
  }
  if (t.era !== 'any' && t.era !== state.era) {
    return { ok: false, error: `That industry can only be built in era ${t.era}.` };
  }
  if (action.whiskeyWild) {
    if (p.whiskey < 1) return { ok: false, error: 'Need whiskey to wild a card.' };
  }

  if (t.kind === 'oilCity') {
    const built = buildOilCity(state, action, t);
    if (!built.ok) return built;
  } else {
    const built = buildOnSlot(state, action, t);
    if (!built.ok) return built;
  }

  if (action.whiskeyWild) p.whiskey -= 1;
  const card = discardCard(p, action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };
  if (!removeMatTile(p, t.id)) return { ok: false, error: 'Industry was not on your mat.' };
  const spent = pendingSpend.length ? `，${formatSpend(state, pendingSpend)}` : '';
  const oilNote = pendingOilNote ? `，${pendingOilNote}` : '';
  pendingOilNote = '';
  const income = t.cost.incomeSpaces ? `，收入 -${t.cost.incomeSpaces}` : '';
  const flippedNote = t.alreadyFlipped ? `。建成即翻面，${describeReward(t.flipReward)}` : '';
  const builtSlot = action.slotId ? state.slots.find((slot) => slot.id === action.slotId) : undefined;
  const where = builtSlot ? placeName(builtSlot.locationId) : action.oilfieldId ? placeName(action.oilfieldId) : '';
  logAction(state, `${playerTag(p.id)} 在 ${where} 建造 ${tileName(t.id)}（${cardLabel(card)}）。造价 $${t.cost.money}${income}${spent}${oilNote}${flippedNote}。`);
  return { ok: true, state };
}

function buildOnSlot(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
): ActionResult {
  const playerId = action.playerId;
  if (t.upgradeFrom) {
    return upgradeIndustry(state, action, t);
  }
  if (!action.slotId) return { ok: false, error: 'Choose a space to build.' };
  const slot = state.slots.find((s) => s.id === action.slotId);
  if (!slot || slot.tileDefId) return { ok: false, error: 'That space is not empty.' };
  const loc = location(slot.locationId);
  const slotDef = loc?.slots.find((s) => s.id === slot.id);
  if (!loc || !slotDef) return { ok: false, error: 'Unknown space.' };
  const problem = freshSlotError(state, action, t, slot);
  if (problem) return { ok: false, error: problem };

  const paid = payBuildCost(state, playerId, t, [slot.locationId], action.sources, action.oilSource);
  if (!paid.ok) return paid;

  occupySlot(state, slot, playerId, t, action.sales);
  return { ok: true, state };
}

function upgradeIndustry(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
): ActionResult {
  if (!action.slotId) return { ok: false, error: 'Choose the industry to upgrade.' };
  const slot = state.slots.find((s) => s.id === action.slotId);
  if (!slot?.tileDefId || slot.owner !== action.playerId) {
    return { ok: false, error: 'Upgrade must replace your industry.' };
  }
  if (!slot.flipped) return { ok: false, error: 'Can only upgrade a flipped industry.' };
  const old = tile(slot.tileDefId);
  if (old.kind !== t.upgradeFrom && old.family !== t.upgradeFrom) {
    return { ok: false, error: `Must upgrade a ${t.upgradeFrom} industry.` };
  }
  const allowed = cardAllowsBuild(state, action, t, slot.locationId);
  if (!allowed.ok) return allowed;
  const paid = payBuildCost(state, action.playerId, t, [slot.locationId], action.sources, action.oilSource);
  if (!paid.ok) return paid;
  const gained = eraPoints(state, action.playerId, old);
  player(state, action.playerId).vp += gained;
  logAction(
    state,
    `${playerTag(action.playerId)} 升级替换 ${placeName(slot.locationId)} 的 ${tileName(old.id)}，${playerTag(action.playerId)} 记产业分 ${gained}。`,
  );
  occupySlot(state, slot, action.playerId, t, action.sales);
  return { ok: true, state };
}

function buildOilCity(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
): ActionResult {
  if (!action.oilfieldId) return { ok: false, error: 'Choose an oilfield for Oil City.' };
  const field = state.oilfields.find((o) => o.id === action.oilfieldId);
  if (!field) return { ok: false, error: 'Unknown oilfield.' };
  if (field.oilCitySlot?.tileDefId) return { ok: false, error: 'Oil City already built here.' };
  if (!oilfieldHasPipeline(state, action.playerId, field.id)) {
    return { ok: false, error: 'Need a pipeline connection to this oilfield.' };
  }
  const cities = mapData.pipelineLines.filter((x) => x.oilfield === field.id).map((x) => x.city);
  const held = player(state, action.playerId).hand.find((c) => c.id === action.cardId);
  if (!held) return { ok: false, error: 'Card is not in hand.' };
  const card = cardDef(held.defId);
  const industryOk =
    action.whiskeyWild ||
    (card.kind === 'industry' && (card.industry === 'oilCity' || card.industry === 'kerosene'));
  if (!industryOk) {
    return { ok: false, error: 'Need an Oil City / kerosene card (or whiskey).' };
  }
  if (!action.whiskeyWild && card.kind === 'industry') {
    const presence = playerHasBoardPresence(state, action.playerId);
    if (presence && !cities.some((c) => inNetwork(state, action.playerId, c))) {
      return { ok: false, error: 'Oil City must be in your network.' };
    }
  }
  const paid = payBuildCost(state, action.playerId, t, cities, action.sources, action.oilSource);
  if (!paid.ok) return paid;
  const oil = field.oil + (t.produces.oil ?? 0);
  field.oil = 0;
  field.oilCitySlot = {
    id: `oilcity-${field.id}`,
    locationId: field.id,
    tileDefId: t.id,
    owner: action.playerId,
    flipped: false,
    cubes: { oil },
  };
  return { ok: true, state };
}

function occupySlot(state: GameState, slot: SlotState, playerId: PlayerId, t: TileDef, sales?: SalePick[]): void {
  slot.tileDefId = t.id;
  slot.owner = playerId;
  slot.flipped = t.alreadyFlipped;
  slot.cubes = { ...t.produces };
  if (!t.alreadyFlipped) sellProducedToMarkets(state, playerId, slot, sales);
  if (t.alreadyFlipped) applyReward(state, playerId, t.flipReward);
  if (t.flipReward.bonusSell) state.bonusSellPlayerId = playerId;
}

function payBuildCost(
  state: GameState,
  playerId: PlayerId,
  t: TileDef,
  dest: string[],
  sources: CubeSource[],
  oilSource: OilSource | undefined,
): ActionResult {
  const p = player(state, playerId);
  const nextIncome = t.cost.incomeSpaces
    ? decreaseIncomeLevels(p.incomeSpace, t.cost.incomeSpaces)
    : p.incomeSpace;
  if (nextIncome === null) return { ok: false, error: 'Income cannot drop below -10.' };
  if (!spendMoney(state, playerId, t.cost.money)) {
    return { ok: false, error: `Need $${t.cost.money} to build.` };
  }
  p.incomeSpace = nextIncome;
  const cubes = consumeCubes(
    state,
    playerId,
    { coal: t.cost.coal, iron: t.cost.iron, coke: t.cost.coke, steel: t.cost.steel },
    dest,
    sources,
  );
  if (!cubes.ok) return cubes;
  if ((t.cost.oil ?? 0) > 0) {
    const oil = consumeBuildOil(state, playerId, dest, oilSource);
    if (!oil.ok) return oil;
  }
  pendingSpend = cubes.steps;
  return { ok: true, state };
}

function consumeBuildOil(
  state: GameState,
  playerId: PlayerId,
  dest: string[],
  chosen: OilSource | undefined,
): ActionResult {
  const choices = oilChoices(state, playerId, dest);
  if (chosen && !choices.some((choice) => sameOil(choice, chosen))) {
    return { ok: false, error: 'That oil is not connected.' };
  }
  const pick = chosen ?? (choices.length === 1 ? choices[0] : undefined);
  if (!pick) {
    return {
      ok: false,
      error: choices.length ? 'Choose which connected oil to use.' : 'Cannot source oil on a connected route.',
    };
  }
  if (pick.kind === 'heavyTrain') {
    const link = state.links.find((entry) => entry.id === pick.linkId);
    if (!link || (link.cubes.oil ?? 0) < 1) return { ok: false, error: 'Oil train missing.' };
    link.cubes.oil = (link.cubes.oil ?? 0) - 1;
    pendingOilNote = `用 ${playerTag(link.owner)} 在 ${lineName(link.lineId)} 重车上的 1 桶石油`;
    return { ok: true, state };
  }
  const field = state.oilfields.find((entry) => entry.id === pick.oilfieldId);
  if (!field) return { ok: false, error: 'Oilfield missing.' };
  takeOilBarrel(state, field, pick.kind === 'oilCity');
  const link = state.links.find((entry) => entry.id === pick.pipelineLinkId);
  if (!link) return { ok: false, error: 'That pipeline is not on the board.' };
  pendingOilNote = `用 ${placeName(field.id)} 经 ${lineName(link.lineId)} 的 1 桶石油`;
  payPipeline(state, link);
  return { ok: true, state };
}

function sameOil(a: OilSource, b: OilSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'heavyTrain' && b.kind === 'heavyTrain') return a.linkId === b.linkId;
  if (a.kind !== 'heavyTrain' && b.kind !== 'heavyTrain') {
    return a.oilfieldId === b.oilfieldId && a.pipelineLinkId === b.pipelineLinkId;
  }
  return false;
}

let pendingSpend: SpendStep[] = [];
let pendingOilNote = '';

function cardAllowsBuild(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
  locationId: string,
): ActionResult {
  const p = player(state, action.playerId);
  const card = p.hand.find((c) => c.id === action.cardId);
  if (!card) return { ok: false, error: 'Card is not in hand.' };
  const def = cardDef(card.defId);
  const locOk = t.upgradeFrom ? true : tileAllowedInLocation(locationId, t);
  if (!locOk) return { ok: false, error: 'This industry cannot be built in that location.' };
  const presence = playerHasBoardPresence(state, action.playerId);
  const networkOk = !presence || inNetwork(state, action.playerId, locationId);

  if (action.whiskeyWild) return { ok: true, state };
  if (def.kind === 'location') {
    if (def.locationId !== locationId) return { ok: false, error: 'Location card must match the city.' };
    return { ok: true, state };
  }
  if (def.kind === 'industry') {
    if (!industryCardMatches(def.industry, t)) {
      return { ok: false, error: 'Industry card does not match this tile.' };
    }
    if (!networkOk) return { ok: false, error: 'Industry cards must be built in your network.' };
    return { ok: true, state };
  }
  return { ok: false, error: 'Unknown card.' };
}

/** Lowest accessible tile an industry card can build right now. Null for location cards. */
export function defaultIndustryTile(state: GameState, playerId: PlayerId, cardId: string): string | null {
  const p = player(state, playerId);
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) return null;
  const def = cardDef(card.defId);
  if (def.kind !== 'industry' || !def.industry) return null;
  const matches = accessibleTileDefs(p).filter((t) => {
    if (!industryCardMatches(def.industry, t)) return false;
    if (t.era !== 'any' && t.era !== state.era) return false;
    if (t.upgradeFrom) return false;
    return true;
  });
  matches.sort((a, b) => a.level - b.level);
  return matches[0]?.id ?? null;
}

/**
 * BGA industry cards are four combined types. The face does not pick one industry:
 * coalMineCoke, manufacturerCarTrain, keroseneOil, bessemerSkyscraper.
 */
const INDUSTRY_CARD_KINDS: Partial<Record<IndustryKind, IndustryKind[]>> = {
  coal: ['coal', 'coke', 'polyphase'],
  coke: ['coal', 'coke', 'polyphase'],
  manufacturing: ['manufacturing', 'automobile', 'locomotive'],
  automobile: ['manufacturing', 'automobile', 'locomotive'],
  locomotive: ['manufacturing', 'automobile', 'locomotive'],
  kerosene: ['kerosene', 'oilCity'],
  oilCity: ['kerosene', 'oilCity'],
  iron: ['iron', 'steel', 'skyscraper'],
  steel: ['iron', 'steel', 'skyscraper'],
  skyscraper: ['iron', 'steel', 'skyscraper'],
};

export function industryCardMatches(cardIndustry: IndustryKind | undefined, t: TileDef): boolean {
  if (!cardIndustry) return false;
  const kinds = INDUSTRY_CARD_KINDS[cardIndustry];
  return kinds ? kinds.includes(t.kind) : cardIndustry === t.kind;
}

function tileAllowedInLocation(locationId: string, t: TileDef): boolean {
  const loc = location(locationId);
  if (!loc) return false;
  return loc.slots.some((s) => allowsIndustry(s.allowed, t));
}

function allowsIndustry(allowed: IndustryKind[], t: TileDef): boolean {
  return allowed.includes(t.kind) || allowed.includes(t.family);
}

/** Empty space that can hold this industry. Location cards ignore the player's network, so this check does too. */
export function slotAcceptsBuild(
  state: GameState,
  tileDefId: string,
  slotId: string,
  playerId: PlayerId,
): boolean {
  const t = tileOrNull(tileDefId);
  if (!t || t.kind === 'oilCity' || t.upgradeFrom) return false;
  const slot = state.slots.find((entry) => entry.id === slotId);
  if (!slot || slot.tileDefId) return false;
  const loc = location(slot.locationId);
  const slotDef = loc?.slots.find((entry) => entry.id === slot.id);
  if (!loc || !slotDef || !allowsIndustry(slotDef.allowed, t)) return false;
  if (playerAlreadyBuiltHere(state, slot.locationId, playerId)) return false;
  if (mustUseNarrowerSlot(state, slot.locationId, t, slotDef.allowed)) return false;
  const forced = exclusiveEmptySlot(state, slot.locationId, t);
  if (forced && forced.id !== slot.id) return false;
  return true;
}

/** Upgrade tiles replace the player's own industry, and it must already be flipped. */
export function slotAcceptsUpgrade(
  state: GameState,
  tileDefId: string,
  slotId: string,
  playerId: PlayerId,
): boolean {
  const t = tileOrNull(tileDefId);
  if (!t?.upgradeFrom) return false;
  const slot = state.slots.find((entry) => entry.id === slotId);
  if (!slot?.tileDefId || slot.owner !== playerId || !slot.flipped) return false;
  const old = tileOrNull(slot.tileDefId);
  if (!old) return false;
  return old.kind === t.upgradeFrom || old.family === t.upgradeFrom;
}

/** True when an empty, more specific space in the same city should be used first. */
export function slotNeedsDedicatedSpace(state: GameState, tileDefId: string, slotId: string): boolean {
  const t = tileOrNull(tileDefId);
  const slot = state.slots.find((entry) => entry.id === slotId);
  const loc = slot ? location(slot.locationId) : undefined;
  const slotDef = loc?.slots.find((entry) => entry.id === slotId);
  if (!t || !slot || !slotDef || slot.tileDefId || !allowsIndustry(slotDef.allowed, t)) return false;
  if (mustUseNarrowerSlot(state, slot.locationId, t, slotDef.allowed)) return true;
  const forced = exclusiveEmptySlot(state, slot.locationId, t);
  return Boolean(forced && forced.id !== slot.id);
}
function playerAlreadyBuiltHere(state: GameState, locationId: string, playerId: PlayerId): boolean {
  if (state.era !== 1) return false;
  return state.slots.some(
    (slot) => slot.locationId === locationId && slot.owner === playerId && Boolean(slot.tileDefId),
  );
}

/** Why this tile cannot be placed here, before money and cubes are spent. Null means the space is legal. */
export function buildPlacementError(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
): string | null {
  const t = tileOrNull(action.tileDefId);
  if (!t) return 'Unknown industry.';
  const p = player(state, action.playerId);
  if (!accessibleTileDefs(p).some((x) => x.id === t.id)) return 'That industry is not accessible.';
  if (t.era !== 'any' && t.era !== state.era) return `That industry can only be built in era ${t.era}.`;
  if (action.whiskeyWild && p.whiskey < 1) return 'Need whiskey to wild a card.';
  if (t.kind === 'oilCity') {
    if (!action.oilfieldId) return 'Choose an oilfield for Oil City.';
    const field = state.oilfields.find((entry) => entry.id === action.oilfieldId);
    if (!field) return 'Unknown oilfield.';
    if (field.oilCitySlot?.tileDefId) return 'Oil City already built here.';
    if (!oilfieldHasPipeline(state, action.playerId, field.id)) {
      return 'Need a pipeline connection to this oilfield.';
    }
    const cities = mapData.pipelineLines.filter((entry) => entry.oilfield === field.id).map((entry) => entry.city);
    return resourcePlanError(state, action, t, cities);
  }
  if (t.upgradeFrom) {
    if (!action.slotId) return 'Choose the industry to upgrade.';
    if (!slotAcceptsUpgrade(state, t.id, action.slotId, action.playerId)) {
      return 'Can only upgrade a flipped industry.';
    }
    const slot = state.slots.find((entry) => entry.id === action.slotId);
    if (!slot) return 'Unknown space.';
    const allowed = cardAllowsBuild(state, action, t, slot.locationId);
    if (!allowed.ok) return allowed.error;
    return resourcePlanError(state, action, t, [slot.locationId]);
  }
  if (!action.slotId) return 'Choose a space to build.';
  const slot = state.slots.find((s) => s.id === action.slotId);
  if (!slot) return 'Unknown space.';
  return freshSlotError(state, action, t, slot);
}

function tileOrNull(id: string): TileDef | null {
  try {
    return tile(id);
  } catch {
    return null;
  }
}

function freshSlotError(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
  slot: SlotState,
): string | null {
  if (slot.tileDefId) return 'That space is not empty.';
  const loc = location(slot.locationId);
  const slotDef = loc?.slots.find((s) => s.id === slot.id);
  if (!loc || !slotDef) return 'Unknown space.';
  if (!allowsIndustry(slotDef.allowed, t)) return 'That space does not allow this industry.';
  if (playerAlreadyBuiltHere(state, slot.locationId, action.playerId)) {
    return 'Era 1: you already have an industry in this city.';
  }
  const forced = exclusiveEmptySlot(state, slot.locationId, t);
  if ((forced && forced.id !== slot.id) || mustUseNarrowerSlot(state, slot.locationId, t, slotDef.allowed)) {
    return `Must build ${t.kind} on the exclusive space.`;
  }
  const allowed = cardAllowsBuild(state, action, t, slot.locationId);
  if (!allowed.ok) return allowed.error;
  return resourcePlanError(state, action, t, [slot.locationId]);
}

function resourcePlanError(
  state: GameState,
  action: Extract<Action, { type: 'build' }>,
  t: TileDef,
  dest: string[],
): string | null {
  const p = player(state, action.playerId);
  if (t.cost.incomeSpaces && decreaseIncomeLevels(p.incomeSpace, t.cost.incomeSpaces) === null) {
    return 'Income cannot drop below -10.';
  }
  const oilNeed = t.cost.oil ?? 0;
  if (oilNeed > 0) {
    const choices = oilChoices(state, action.playerId, dest);
    if (action.oilSource && !choices.some((choice) => sameOil(choice, action.oilSource!))) {
      return 'That oil is not connected.';
    }
    if (choices.length === 0) return 'Cannot source oil on a connected route.';
    if (!action.oilSource && choices.length > 1) return 'Choose which connected oil to use.';
  }
  const spend = planCubeSpend(
    state,
    action.playerId,
    { coal: t.cost.coal, iron: t.cost.iron, coke: t.cost.coke, steel: t.cost.steel },
    dest,
  );
  if (!spend.ok) return spend.error;
  const due = t.cost.money + spendMoneyOf(spend.steps);
  if (p.money < due) return `Need $${due} to build.`;
  return null;
}

function exclusiveEmptySlot(state: GameState, locationId: string, t: TileDef): SlotState | null {
  const loc = location(locationId);
  if (!loc) return null;
  for (const def of loc.slots) {
    if (def.exclusive !== t.kind && def.exclusive !== t.family) continue;
    const slot = state.slots.find((s) => s.id === def.id);
    if (slot && !slot.tileDefId) return slot;
  }
  return null;
}

/** A single-icon space is a proper subset of a two-icon space that also accepts the tile. */
function mustUseNarrowerSlot(
  state: GameState,
  locationId: string,
  t: TileDef,
  allowed: IndustryKind[],
): boolean {
  const loc = location(locationId);
  if (!loc) return false;
  for (const def of loc.slots) {
    if (!isProperSubset(def.allowed, allowed) || !allowsIndustry(def.allowed, t)) continue;
    const slot = state.slots.find((entry) => entry.id === def.id);
    if (slot && !slot.tileDefId) return true;
  }
  return false;
}

function isProperSubset(narrow: IndustryKind[], wide: IndustryKind[]): boolean {
  return narrow.length < wide.length && narrow.every((kind) => wide.includes(kind));
}

export function oilCityFieldIds(state: GameState, playerId: PlayerId): string[] {
  return state.oilfields
    .filter((field) => !field.oilCitySlot?.tileDefId && oilfieldHasPipeline(state, playerId, field.id))
    .map((field) => field.id);
}

function oilfieldHasPipeline(state: GameState, playerId: PlayerId, oilfieldId: string): boolean {
  for (const link of state.links) {
    if (link.kind !== 'pipeline') continue;
    const line = pipeline(link.lineId);
    if (line?.oilfield !== oilfieldId) continue;
    if (link.owner === playerId || inNetwork(state, playerId, line.city)) return true;
  }
  return false;
}

export function pickSlotForTile(state: GameState, locationId: string, t: TileDef): string | null {
  const forced = exclusiveEmptySlot(state, locationId, t);
  if (forced) return forced.id;
  const loc = location(locationId);
  if (!loc) return null;
  for (const def of loc.slots) {
    if (!allowsIndustry(def.allowed, t)) continue;
    if (mustUseNarrowerSlot(state, locationId, t, def.allowed)) continue;
    const slot = state.slots.find((s) => s.id === def.id);
    if (slot && !slot.tileDefId) return slot.id;
  }
  return null;
}

const RESOURCE_LABEL = { coal: '煤', iron: '铁', coke: '焦', steel: '钢' } as const;

/** Printed cost until a city is chosen; then cash includes that city's resource price. */
export function buildQuote(
  state: GameState,
  playerId: PlayerId,
  tileId: string,
  slotId: string | null,
): { cost: string; income: string } | null {
  const t = tileOrNull(tileId);
  if (!t) return null;
  const incomeParts: string[] = [];
  if (t.flipReward.money) incomeParts.push(`$${t.flipReward.money}`);
  if (t.flipReward.incomeSpaces) incomeParts.push(`+${t.flipReward.incomeSpaces}`);
  if (t.flipReward.whiskey) incomeParts.push(`威士忌 ${t.flipReward.whiskey}`);
  if (t.flipReward.doubleIncome) incomeParts.push('当前收入×2');
  if (t.flipReward.freeDevelops) incomeParts.push(`免费研发 ${t.flipReward.freeDevelops}`);
  const income = incomeParts.length ? `收益 ${incomeParts.join(' ')}` : '收益 0';

  const slot = slotId ? state.slots.find((s) => s.id === slotId) : undefined;
  if (slot) {
    const plan = planCubeSpend(
      state,
      playerId,
      { coal: t.cost.coal, iron: t.cost.iron, coke: t.cost.coke, steel: t.cost.steel },
      [slot.locationId],
    );
    if (plan.ok) return { cost: decorateCost(t, `造价 $${t.cost.money + spendMoneyOf(plan.steps)}`), income };
  }

  const resources = (Object.keys(RESOURCE_LABEL) as Array<keyof typeof RESOURCE_LABEL>)
    .filter((cube) => t.cost[cube] > 0)
    .map((cube) => (t.cost[cube] > 1 ? `${RESOURCE_LABEL[cube]}${t.cost[cube]}` : RESOURCE_LABEL[cube]))
    .join('+');
  if (resources && t.cost.money > 0) return { cost: decorateCost(t, `造价 $${t.cost.money}+${resources}`), income };
  if (resources) return { cost: decorateCost(t, `造价 ${resources}`), income };
  return { cost: decorateCost(t, `造价 $${t.cost.money}`), income };
}

function decorateCost(t: TileDef, cost: string): string {
  const extra: string[] = [];
  if (t.cost.oil) extra.push(t.cost.oil > 1 ? `油${t.cost.oil}` : '油');
  if (t.cost.incomeSpaces) extra.push(`收入 -${t.cost.incomeSpaces}`);
  return extra.length ? `${cost}，${extra.join('，')}` : cost;
}
