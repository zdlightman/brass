import { cardLabel, discardCard } from '../cards';
import { location, merchantTiles, pipeline, qualityRewards, rail, tile } from '../catalog';
import { railConnected } from '../graph';
import { player } from '../mat';
import { looseFieldOil, oilCityBarrels, takeOilBarrel } from '../oil';
import { describeReward, lineName, placeName, playerTag, tileName } from '../logText';
import { applyReward } from '../rewards';
import { deferLog } from '../logQueue';
import { logAction } from '../turn';
import type {
  Action,
  ActionResult,
  GameState,
  IndustryKind,
  LinkState,
  MerchantState,
  OilSource,
  PlayerId,
  SlotState,
} from '../types';

const KIND_LABEL: Partial<Record<IndustryKind, string>> = {
  kerosene: '煤油',
  manufacturing: '制造',
  automobile: '汽车',
};

export type SellOil = OilSource & { slotId: string };

/** Merchants on a rail connection whose tile shows this industry, gold or already red. */
export function merchantsForSale(state: GameState, locationId: string, kind: IndustryKind): MerchantState[] {
  return state.merchants.filter((merchant) => {
    if (!railConnected(state, locationId, merchant.locationId)) return false;
    return merchantSells(merchant, kind);
  });
}

/** Gold faces sell the industries printed on that tile. The $15 tile is the exception: after it flips, only cars. The other three keep the same goods and pay nothing on the red face. */
export function merchantSells(merchant: MerchantState, kind: IndustryKind): boolean {
  if (merchant.tileId === 'mer-15') {
    return merchant.faceUp ? kind === 'manufacturing' || kind === 'kerosene' : kind === 'automobile';
  }
  const def = merchantTiles.find((entry) => entry.id === merchant.tileId);
  return Boolean(def?.industries.includes(kind));
}

export function oilChoices(state: GameState, playerId: PlayerId, destLocations: string[]): OilSource[] {
  const out: OilSource[] = [];
  for (const link of state.links) {
    if (link.kind !== 'pipeline' || link.pipelineType === 'reserve') continue;
    const line = pipeline(link.lineId);
    if (!line || !destLocations.some((dest) => railConnected(state, dest, line.city))) continue;
    const field = state.oilfields.find((entry) => entry.id === line.oilfield);
    if (!field) continue;
    if (looseFieldOil(field) > 0) out.push({ kind: 'oilfield', oilfieldId: field.id, pipelineLinkId: link.id });
    if (oilCityBarrels(field) > 0) out.push({ kind: 'oilCity', oilfieldId: field.id, pipelineLinkId: link.id });
  }
  for (const link of state.links) {
    if (link.owner !== playerId || link.heavyType !== 'oilResource') continue;
    if ((link.cubes.oil ?? 0) <= 0) continue;
    const line = rail(link.lineId);
    if (!line) continue;
    if (destLocations.some((dest) => railConnected(state, dest, line.a) || railConnected(state, dest, line.b))) {
      out.push({ kind: 'heavyTrain', linkId: link.id });
    }
  }
  return out;
}

export function sellPreview(
  state: GameState,
  playerId: PlayerId,
  slotIds: string[],
  merchantLocationIds: string[] = [],
  oilSources: SellOil[] = [],
  whiskeyStars = 0,
): string {
  if (slotIds.length === 0) return '点自己未翻面的货物（制造、煤油、汽车），再点运送石油的管道。管道可以是别人的。制造 II 不需要石油。';
  const plan = planSell(state, playerId, slotIds, merchantLocationIds, oilSources);
  const parts: string[] = [];
  for (const slotId of slotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot?.tileDefId) continue;
    const def = tile(slot.tileDefId);
    const markets = merchantsForSale(state, slot.locationId, def.kind);
    const chosen = markets.filter((merchant) => merchantLocationIds.includes(merchant.locationId));
    const names = (chosen.length > 0 ? chosen : markets)
      .map((merchant) => {
        const name = location(merchant.locationId)?.name ?? merchant.locationId;
        return merchant.faceUp ? name : `${name}（红框，无首卖奖励）`;
      })
      .join('、');
    const label = `${KIND_LABEL[def.kind] ?? def.kind} ${def.level}`;
    parts.push(names ? `${label} → ${names}` : `${label} 没有连通的对应市场`);
  }
  const stars = starCount(state, slotIds) + whiskeyStars;
  const tail = plan.ok ? `品质星 ${stars}。` : previewError(plan.error);
  return `售卖 ${parts.join('；')}。${tail}`;
}

export function applySell(state: GameState, action: Extract<Action, { type: 'sell' }>): ActionResult {
  if (action.slotIds.length < 1) return { ok: false, error: 'Choose a good to sell.' };
  const plan = planSell(state, action.playerId, action.slotIds, action.merchantLocationIds, action.oilSources);
  if (!plan.ok) return plan;

  const p = player(state, action.playerId);
  const bonus = state.bonusSellPlayerId !== null && state.bonusSellPlayerId === action.playerId;
  const card = bonus ? null : discardCard(p, action.cardId);
  if (!bonus && !card) return { ok: false, error: 'Card is not in hand.' };

  for (const source of plan.oil) {
    if (source.kind === 'heavyTrain') {
      const link = state.links.find((entry) => entry.id === source.linkId);
      if (!link) return { ok: false, error: 'Oil train missing.' };
      link.cubes.oil = (link.cubes.oil ?? 0) - 1;
    } else {
      const field = state.oilfields.find((entry) => entry.id === source.oilfieldId);
      if (!field) return { ok: false, error: 'Oilfield missing.' };
      takeOilBarrel(state, field, source.kind === 'oilCity');
      const link = state.links.find((entry) => entry.id === source.pipelineLinkId);
      if (!link) return { ok: false, error: 'That pipeline is not on the board.' };
      payPipeline(state, link);
    }
  }

  const firstSale = plan.merchants.filter((merchant) => merchant.faceUp);
  const firstNotes: string[] = [];
  for (const merchant of firstSale) {
    const spec = merchantTiles.find((entry) => entry.id === merchant.tileId);
    if (spec) {
      applyReward(state, action.playerId, {
        money: spec.money,
        whiskey: spec.whiskey,
        incomeSpaces: spec.incomeSpaces,
        vp: spec.vp,
      });
      const where = location(merchant.locationId)?.name ?? merchant.locationId;
      const vpNote = spec.vp ? `，${playerTag(p.id)} 记首卖分 ${spec.vp}` : '';
      const paid = describeReward({ money: spec.money, incomeSpaces: spec.incomeSpaces, whiskey: spec.whiskey });
      const paidNote = paid === '没有现金或收入' ? '' : `，${paid}`;
      firstNotes.push(`首卖 ${where}${vpNote}${paidNote}`);
    }
    merchant.faceUp = false;
  }

  let stars = starCount(state, action.slotIds);
  if (action.whiskeyStars > 0) {
    if (p.whiskey < action.whiskeyStars) return { ok: false, error: 'Not enough whiskey.' };
    p.whiskey -= action.whiskeyStars;
    stars += action.whiskeyStars;
  }
  let qualityNote = '';
  if (action.qualityRewardId) {
    const reward = state.qualityRewards.find((entry) => entry.id === action.qualityRewardId);
    const spec = qualityRewards.find((entry) => entry.id === action.qualityRewardId);
    if (!reward || !spec || !reward.faceUp) return { ok: false, error: 'That quality reward is not available.' };
    if (stars < spec.stars) return { ok: false, error: 'Not enough quality stars.' };
    applyReward(state, action.playerId, {
      money: spec.money,
      whiskey: spec.whiskey,
      incomeSpaces: spec.incomeSpaces,
      vp: spec.vp,
    });
    reward.faceUp = false;
    qualityNote = `品质星 ${spec.stars} 星，${playerTag(p.id)} 记品质星分 ${spec.vp}。`;
  }

  for (const slot of plan.slots) {
    const def = tile(slot.tileDefId!);
    slot.flipped = true;
    applyReward(state, action.playerId, { ...def.flipReward, vp: 0 });
  }

  const flips = plan.slots.map((slot) => {
    const def = tile(slot.tileDefId!);
    return `${playerTag(action.playerId)} 在 ${placeName(slot.locationId)} 的 ${tileName(def.id)} 翻面，${describeReward(def.flipReward)}`;
  });
  const extras = [...firstNotes, qualityNote].filter(Boolean);
  logAction(
    state,
    `${playerTag(p.id)} 售卖 ${plan.slots.map((slot) => `${placeName(slot.locationId)} 的 ${tileName(slot.tileDefId!)}`).join('、')}（${card ? cardLabel(card) : '摩天楼附带'}）。${sellCostNote(action.whiskeyStars)}${extras.length ? `${extras.join('。')}。` : ''}${flips.join('；')}。`,
  );
  return { ok: true, state };
}

function previewError(error: string): string {
  if (error === 'Choose which merchants to sell to.') return '点一个市场，选这次卖给谁。';
  if (error === 'Choose which pipeline carries the oil.') return '点一条运送石油的管道。';
  return error;
}

function sellCostNote(whiskeyStars: number): string {
  return whiskeyStars > 0 ? `支付威士忌 ${whiskeyStars}。` : '';
}

function planSell(
  state: GameState,
  playerId: PlayerId,
  slotIds: string[],
  merchantLocationIds: string[],
  oilSources: SellOil[],
): { ok: true; slots: SlotState[]; merchants: MerchantState[]; oil: SellOil[] } | { ok: false; error: string } {
  const unique = new Set(slotIds);
  if (unique.size !== slotIds.length) return { ok: false, error: 'Each good can be sold once.' };
  const slots: SlotState[] = [];
  for (const slotId of slotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot?.tileDefId || slot.owner !== playerId || slot.flipped) {
      return { ok: false, error: 'That is not your unflipped industry.' };
    }
    const def = tile(slot.tileDefId);
    if (!def.sellable) return { ok: false, error: 'That industry is not sold to a merchant.' };
    if (merchantsForSale(state, slot.locationId, def.kind).length === 0) {
      return { ok: false, error: 'Need a connected merchant showing this industry.' };
    }
    slots.push(slot);
  }
  const merchants = planMerchants(state, slots, merchantLocationIds);
  if (!merchants.ok) return merchants;
  const oil = planOil(state, playerId, slots, oilSources);
  if (!oil.ok) return oil;
  return { ok: true, slots, merchants: merchants.merchants, oil: oil.oil };
}

function planMerchants(
  state: GameState,
  slots: SlotState[],
  merchantLocationIds: string[],
): { ok: true; merchants: MerchantState[] } | { ok: false; error: string } {
  if (merchantLocationIds.length === 0) {
    const picked = new Map<string, MerchantState>();
    for (const slot of slots) {
      const options = merchantsForSale(state, slot.locationId, tile(slot.tileDefId!).kind);
      if (options.length !== 1) return { ok: false, error: 'Choose which merchants to sell to.' };
      const only = options[0];
      if (only) picked.set(only.locationId, only);
    }
    return { ok: true, merchants: [...picked.values()] };
  }
  const selected: MerchantState[] = [];
  for (const locationId of merchantLocationIds) {
    const merchant = state.merchants.find((entry) => entry.locationId === locationId);
    if (!merchant) return { ok: false, error: 'That merchant is not available.' };
    selected.push(merchant);
  }
  for (const slot of slots) {
    const options = merchantsForSale(state, slot.locationId, tile(slot.tileDefId!).kind);
    if (!selected.some((merchant) => options.some((option) => option.locationId === merchant.locationId))) {
      return { ok: false, error: 'Each good needs a chosen merchant showing its industry.' };
    }
  }
  for (const merchant of selected) {
    const used = slots.some((slot) => {
      const kind = tile(slot.tileDefId!).kind;
      return merchantSells(merchant, kind) && railConnected(state, slot.locationId, merchant.locationId);
    });
    if (!used) return { ok: false, error: 'That merchant is not taking any of these goods.' };
  }
  return { ok: true, merchants: selected };
}

function planOil(
  state: GameState,
  playerId: PlayerId,
  slots: SlotState[],
  given: SellOil[],
): { ok: true; oil: SellOil[] } | { ok: false; error: string } {
  const used = new Map<string, number>();
  if (given.length === 0) {
    const picked: SellOil[] = [];
    for (const slot of slots) {
      const need = tile(slot.tileDefId!).oilToSell;
      const auto = autoOilForSlot(state, playerId, slot, need, used);
      if (!auto.ok) return auto;
      picked.push(...auto.oil);
    }
    return { ok: true, oil: picked };
  }
  for (const slot of slots) {
    const need = tile(slot.tileDefId!).oilToSell;
    const mine = given.filter((source) => source.slotId === slot.id);
    if (mine.length !== need) return { ok: false, error: `Need ${need} oil connected to ${slot.locationId}.` };
    for (const source of mine) {
      if (!oilChoices(state, playerId, [slot.locationId]).some((choice) => sameSource(choice, source))) {
        return { ok: false, error: 'That oil is not connected to this industry.' };
      }
      if (poolLeft(state, source, used) <= 0) return { ok: false, error: 'Not enough oil there.' };
      used.set(poolKey(source), (used.get(poolKey(source)) ?? 0) + 1);
    }
  }
  if (given.length !== slots.reduce((sum, slot) => sum + tile(slot.tileDefId!).oilToSell, 0)) {
    return { ok: false, error: 'Oil does not match the goods being sold.' };
  }
  return { ok: true, oil: given };
}

function autoOilForSlot(
  state: GameState,
  playerId: PlayerId,
  slot: SlotState,
  need: number,
  used: Map<string, number>,
): { ok: true; oil: SellOil[] } | { ok: false; error: string } {
  if (need === 0) return { ok: true, oil: [] };
  const choices = oilChoices(state, playerId, [slot.locationId]).filter((source) => poolLeft(state, source, used) > 0);
  const keys = [...new Set(choices.map(choiceKey))];
  if (keys.length === 0) return { ok: false, error: `Need ${need} oil connected to ${slot.locationId}.` };
  if (keys.length > 1) return { ok: false, error: 'Choose which pipeline carries the oil.' };
  const source = choices[0];
  if (!source || poolLeft(state, source, used) < need) {
    return { ok: false, error: `Need ${need} oil connected to ${slot.locationId}.` };
  }
  const oil: SellOil[] = [];
  for (let i = 0; i < need; i++) {
    oil.push({ ...source, slotId: slot.id });
    used.set(poolKey(source), (used.get(poolKey(source)) ?? 0) + 1);
  }
  return { ok: true, oil };
}

function starCount(state: GameState, slotIds: string[]): number {
  let stars = 0;
  for (const slotId of slotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (slot?.tileDefId) stars += tile(slot.tileDefId).stars;
  }
  return stars;
}

function poolKey(source: OilSource): string {
  return source.kind === 'heavyTrain' ? `heavy:${source.linkId}` : `${source.kind}:${source.oilfieldId}`;
}

function choiceKey(source: OilSource): string {
  return source.kind === 'heavyTrain' ? poolKey(source) : `${poolKey(source)}:${source.pipelineLinkId}`;
}

function poolLeft(state: GameState, source: OilSource, used: Map<string, number>): number {
  const spent = used.get(poolKey(source)) ?? 0;
  if (source.kind === 'heavyTrain') {
    const link = state.links.find((entry) => entry.id === source.linkId);
    return (link?.cubes.oil ?? 0) - spent;
  }
  const field = state.oilfields.find((entry) => entry.id === source.oilfieldId);
  if (!field) return 0;
  const have = source.kind === 'oilfield' ? looseFieldOil(field) : oilCityBarrels(field);
  return have - spent;
}

function sameSource(a: OilSource, b: OilSource): boolean {
  return choiceKey(a) === choiceKey(b);
}

export function payPipeline(state: GameState, link: LinkState): void {
  const owner = playerTag(link.owner);
  const where = lineName(link.lineId);
  if (link.pipelineType === 'income') {
    const spaces = link.pipelineIncome ?? 2;
    applyReward(state, link.owner, { incomeSpaces: spaces });
    deferLog(state, `${owner} 的管道 ${where} 送出石油，收入 +${spaces} 格。`);
  } else if (link.pipelineType === 'money') {
    applyReward(state, link.owner, { money: 10 });
    deferLog(state, `${owner} 的管道 ${where} 送出石油，现金 +$10。`);
  } else if (link.pipelineType === 'vp') {
    const points = link.pipelinePoints ?? 0;
    applyReward(state, link.owner, { vp: points });
    deferLog(state, `${owner} 的管道 ${where} 送出石油，${owner} 记管道分 ${points}。`);
  }
}
