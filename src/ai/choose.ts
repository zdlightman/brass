import { industryCardMatches, slotAcceptsBuild, slotAcceptsUpgrade, oilCityFieldIds } from '../engine/actions/build';
import { destLocationsFor, legalNetworkPlacements, linkResourceCost } from '../engine/actions/network';
import { merchantSells, merchantsForSale, oilChoices } from '../engine/actions/sell';
import { looseFieldOil, oilCityBarrels } from '../engine/oil';
import { mulberry32, shuffle } from '../engine/rng';
import { applyAction } from '../engine/apply';
import { cardDef, mapData, market as marketDef, pipeline, rail, tile, location as locDef } from '../engine/catalog';
import { clone } from '../engine/clone';
import { locationLinkPoints, occupiedRailLineIds, railConnected } from '../engine/graph';
import { incomeLevelAt } from '../engine/income';
import { accessibleTileDefs, accessibleTileIds, player } from '../engine/mat';
import { industryChoiceGroups } from '../engine/resources';
import type { Action, Card, CubeSource, GameState, IndustryKind, OilSource, PlayerId, TileDef } from '../engine/types';
import { incomeAsOptionVp, moneyToVp, resourceFillMoney, roundsLeftApprox } from './valueUnits';

export type Role = 'economy' | 'box' | 'oil';

export const ROLE_ZH: Record<Role, string> = {
  economy: '经济流',
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
  const tiles = accessibleTileDefs(p);
  // 规则：产业卡不限时代建造（1箱等 era-1 卡在 2 时代照样能新建），
  // 只是已造出的 level 1 建筑会在 1 时代结束时被移除。引擎 build.ts 不按 era 过滤，这里也不再过滤。
  // 性能：buildRank 是纯函数（依赖 current/pid/style/built，不含 slot），同一 built 在多个 slot 会重复调用，
  // 这里按 built.id 缓存，避免 MCTS 大量展开时反复重算 buildRank（内部含 flowReady/builtCount 等昂贵 helper）。
  const rankCache = new Map<string, number>();
  const rankOf = (built: TileDef): number => {
    let r = rankCache.get(built.id);
    if (r === undefined) {
      r = buildRank(current, pid, style, built);
      rankCache.set(built.id, r);
    }
    return r;
  };
  const ranked: { action: Action; rank: number }[] = [];
  for (const card of p.hand) {
    for (const built of tiles) {
      if (built.kind === 'oilCity') {
        // 石油城：建在玩家已用管道连通的油田，只需油城/煤油产业卡，不校验位置卡
        const cd = cardDef(card.defId);
        if (cd.kind !== 'industry' || (cd.industry !== 'oilCity' && cd.industry !== 'kerosene')) continue;
        for (const fieldId of oilCityFieldIds(current, pid)) {
          const field = current.oilfields.find((f) => f.id === fieldId);
          if (!field || field.oilCitySlot?.tileDefId) continue;
          ranked.push({
            rank: rankOf(built),
            action: {
              type: 'build',
              playerId: pid,
              cardId: card.id,
              whiskeyWild: false,
              tileDefId: built.id,
              oilfieldId: fieldId,
              sources: [],
            },
          });
        }
        continue;
      }
      const slots = built.upgradeFrom
        ? current.slots.filter((slot) => slotAcceptsUpgrade(current, built.id, slot.id, pid))
        : current.slots.filter((slot) => slotAcceptsBuild(current, built.id, slot.id, pid));
      for (const slot of slots) {
        if (!cardCanBuild(card.defId, built, slot.locationId)) continue;
        ranked.push({
          rank: rankOf(built),
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
  // 硬红线：有己方收入/分管可选时，不优先用断管（储备管）送油。
  return oilChoices(current, pid, [slot.locationId])
    .filter((source) => oilLeft(current, source, used) > 0)
    .sort((a, b) => oilPipePriority(current, a) - oilPipePriority(current, b));
}

/** 越小越优先：收入/分管 > 钱管 > 重车 > 断管。 */
function oilPipePriority(current: GameState, source: OilSource): number {
  if (source.kind === 'heavyTrain') return 3;
  const link = current.links.find((entry) => entry.id === source.pipelineLinkId);
  if (!link) return 9;
  if (link.pipelineType === 'income' || link.pipelineType === 'vp') return 0;
  if (link.pipelineType === 'money') return 1;
  if (link.pipelineType === 'reserve') return 5;
  return 4;
}

/** 当前合法管线里是否还有非储备管可选（有则不应优先插断管）。 */
function hasNonReservePipeOption(state: GameState, pid: PlayerId): boolean {
  return legalNetworkPlacements(state, pid).some(
    (p) => p.kind === 'pipeline' && p.pipelineType && p.pipelineType !== 'reserve',
  );
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
  if (before.era === 2) return scoreEra2(before, after, pid, action, style);
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
  // 收入规则上不算分。scoreAction 里保留旧量级软先验（K≈0.55×4.5），只供贪心短视排序；
  // 真值 / 叶子用 evaluateState 的 VP 语言。勿把此处当成终局真理。
  const roundsLeft = roundsLeftApprox(before.era, before.round);
  const incomeGained = incomeLevelAt(to.incomeSpace) - incomeLevelAt(from.incomeSpace);
  const incomeSoft = incomeGained * Math.max(0, roundsLeft) * 0.55;
  // 煤开豁免（核心煤城克堡/巴里）：外部买铁造煤（煤开）是长线建筑，即使暂时卖不掉（filled=0）也保留价值
  //（煤开 > 贷开 > 管开）。只有克堡/巴里豁免外部买铁惩罚；其他城外部买铁造煤不划算。
  const coalBuild = action.type === 'build' && tile(action.tileDefId).kind === 'coal';
  // slotId 是槽位（如 'wilkes-barre-0'），城市 = 去掉末尾数字段（'wilkes-barre'）。
  const buildParts = action.type === 'build' && action.slotId ? String(action.slotId).split('-') : [];
  const buildCity = buildParts.length > 1 ? buildParts.slice(0, -1).join('-') : (buildParts[0] ?? undefined);
  const coreCoalBuild = coalBuild && isCoreCoalCity(buildCity);
  // 战术内部分量级：钱权保持约 0.35，与既有惩罚堆兼容；阶段软曲线留给 evaluateState。
  const moneyW = 0.35;
  let score = incomeSoft * 4.5 + (to.money - from.money) * moneyW + (to.vp - from.vp) * 2;
  // 收入为负时，"扭亏为盈"（动作后收入≥0，翻煤/补铁翻铁/抢卖翻产业/翻收入油田跨过零线）的动作一次性奖励，
  // 落实"关键是怎么提高收入"（前期扭亏，避免贷款续命收入越负）。
  // 只奖励过零的临界动作，不放大所有收入变化（避免过度追收入牺牲主线产业/VP 的副作用）。
  if (incomeLevelAt(from.incomeSpace) < 0 && incomeLevelAt(to.incomeSpace) >= 0) score += 45;
  score -= Math.max(0, looseSteel(after) - looseSteel(before) - 1) * 18;
  // ===== 资源经济（用户：动作价值要看花的资源值多少钱）=====
  // 补市场（向市场补充免费/储备资源）= 加速翻面自己建筑的额外收益（金钱上与用免费资源同价，但多翻面价值）。
  score += filled * 20;
  // 免费资源 = 市场最低补价（煤铁2、钢焦4）折成内部分；补市场另有 filled 翻面加速。
  const fillScore = (kind: 'coal' | 'iron' | 'coke' | 'steel', n: number, boost: number) =>
    n * (resourceFillMoney(kind) * moneyW + boost);
  score += fillScore('coal', freeCoal, 20);
  score += fillScore('iron', freeIron, 10) + fillScore('coke', freeCoke, 10);
  score += fillScore('steel', freeSteel, 6);
  score += (countOf(text, '购买') - boughtOutside) * 10;
  // 外部购买资源（花现金买高价资源）：初期（R1-4）重罚到"无补市场/翻面奖励则不可接受"
  //（铁1时代2-3块、常免费，$7外部买铁铺管是高价资源）；R5 起逐回合放宽（后期资源便宜、冲分可接受）。
  const buyPenalty = before.round <= 4 ? 110 : before.round <= 6 ? 60 : 25;
  if (!coreCoalBuild) score -= boughtOutside * buyPenalty;
  // 外部买煤/铁（开管、造煤油/焦炭用7块煤这种）初期加倍惩罚。
  const outsideCoalIron = countOf(text, '从外部购买煤') + countOf(text, '从外部购买铁');
  if (outsideCoalIron > 0 && !coreCoalBuild) score -= outsideCoalIron * (before.round < 5 ? 60 : 20);
  // 外部购买且无补市场（filled=0，纯高价消费、无赚钱/翻面奖励抵消）→ 初期不可接受，重罚；R7 起冲分阶段不罚。
  // 用户：外部买铁开管/造煤油用7块煤（无补市场）初期不可接受；但外部买铁"造煤"（煤开）是长线收入建筑，
  // 即使暂时卖不掉（filled=0）也保留价值（用户：煤开 > 贷开 > 管开，早期煤最重要）——豁免 -200（限克堡/巴里）。
  if (boughtOutside > 0 && filled === 0 && !coreCoalBuild) score -= before.round <= 4 ? 200 : before.round <= 6 ? 100 : 0;
  if (action.type === 'build') {
    const built = tile(action.tileDefId);
    const resource = built.kind === 'coal' || built.kind === 'coke' || built.kind === 'iron' || built.kind === 'steel';
    const mainLine = built.kind === 'manufacturing' || built.kind === 'kerosene';
    const card = from.hand.find((entry) => entry.id === action.cardId);
    const flying = card ? cardDef(card.defId).kind === 'location' : false;
    // 场上统一连接大量免费煤（freeSupply≥3）→ 再造煤厂产出翻不掉/卖不掉，压制（用户：别疯狂造煤厂造了翻不掉）。
    // 权重"恰好"：免费煤充足时用免费煤造产业更划算（煤是别人供的、直接消耗），市场缺煤（freeSupply 低）才值得造煤厂补市场。
    // 注意：freeSupply 含市场库存（market 煤柱），开局市场满煤 → coalSupply≥4 会重压煤开。
    // 克堡/巴里煤开减半此压制（用户：煤开 > 贷开 > 管开，早期煤最重要、市场满也值长线收入），
    // 但保留一半压制防"3人同城挤满煤开产出翻不掉"崩局（seed777 R1 全员挤巴里崩）；其他煤位全压。
    const coalSupply = freeSupply(before, 'coal');
    if (built.kind === 'coal') {
      const raw = coalSupply >= 4 ? 130 : coalSupply >= 3 ? 70 : 0;
      const penalty = coreCoalBuild ? Math.round(raw / 2) : raw;
      if (penalty > 0) score -= penalty;
    }
    if (built.kind === 'coal' && coalHoles >= 2) score += 110 + coalHoles * 6;
    if (built.kind === 'coal' && coalHoles >= 2 && filled > 0) score += 24;
    // 1时代早期（前4回合）：煤是最重要的长线收入建筑，早造早翻面早吃收入。
    // 用户指正：早期煤比产业开更重要——市场满格时也要给煤基础分，否则AI开局全去造产业。
    if (built.kind === 'coal' && before.round <= 4) {
      score += 55;
      if (coalHoles >= 1) score += 24;
    }
    // 用户指正：前期钱很贵、资源价值很高。外部买铁在无免费铁位置造煤（如哈里斯堡）不划算——
    // 造煤应优先用巴里/克堡的天然免费铁；但外部买铁"补市场造煤"（filled>0，赚9块）可做。
    // 只有"造溢出煤"（filled=0，市场不缺煤还买铁硬造）初期压，让 AI 优先免费铁位造煤或先做其他经济动作。
    if (built.kind === 'coal' && !coreCoalBuild && boughtOutside > 0 && filled === 0 && before.round <= 4) score -= 40;
    // 早期贷款+建造：消耗资源补市场（filled>0）→ 加速翻面自己建筑（或最多剩1资源），
    // 价值额外加"抵消贷款利息"（用户：向市场补充会得到加速翻面收益；贷款+建造能翻面则利息被抵消）。
    if (resource && before.round <= 4 && filled > 0) score += 20;
    // 非煤资源（铁/焦/钢）同源：场上免费同类资源充足 → 造同类资源建筑产出难翻，压制（用户：用免费资源更划算）。
    if (resource && built.kind !== 'coal') {
      const kindSupply = freeSupply(before, built.kind);
      if (kindSupply >= 4) score -= 80;
      else if (kindSupply >= 3) score -= 40;
    }
    if (resource && filled > 0 && built.kind !== 'coal') score += 12;
    if (resource && !coreCoalBuild && filled === 0 && !(built.kind === 'coal' && coalHoles >= 2)) score -= 12;
    // 产业权重早期抑制（用户：早期低、逐渐升高，至少前期压到1煤以下；前期产业权重太高→没人补煤→煤靠市场）。
    // 早期造产业（制造/煤油）净价值应低于造煤——产业锁钱、兑现晚；煤早翻早吃收入 + 压制 + 焦炭基底。
    // 只在"能造煤"时压产业（用户：有牌才造）——手牌有煤牌 且 场上还有空煤位（coalHoles>0，位置/缺口在）；
    // 手牌没牌或场上煤位已满（造不了煤）时不压，让 AI 走其他提收入路径（飞箱/造产业/铺管/开油田），避免空转崩盘（守护②手牌无煤保留飞箱）。
    // R1-2 最重、R3-4 中、R5-6 缓、R7+ 冲分放开。
    if (mainLine && from.hand.some((c) => cardDef(c.defId).industry === 'coal') && hasCoalSlot(before)) {
      if (before.round <= 2) score -= 100;
      else if (before.round <= 4) score -= 60;
      else if (before.round <= 6) score -= 25;
    }
    if (mainLine && boughtOutside > 0) score -= 70;
    if (mainLine && outsideCoalIron > 0 && before.round < 5) score -= 40;
    if (mainLine && flying) {
      // 飞箱门槛（用户指正）：飞箱的前提是能“首卖回正收入”——位置已连/一步内连到市场（hops≤1）才保留加分。
      // 早期（前4回合）离市场远（hops>1）且手牌有煤可造时，飞箱优先级低于先出煤（煤是长线收入，别开局锁飞箱）；
      // 手牌没有煤可造（只能飞箱）时保留飞箱加分；晚期飞箱正常。
      const hops = action.slotId ? linksToSellMarket(before, slotLocation(before, action.slotId), built.kind) : 8;
      const hasCoalCard = from.hand.some((c) => cardDef(c.defId).industry === 'coal');
      // 收入为负时，离市场很远（hops>2）的主线产业不该硬造——连不到市场=卖不掉，反扣分（用户：别卖不掉硬造）。
      // 收入正常（≥0）时晚期飞箱是合理冲分，不抑制（守护 round8 正常飞箱）。
      const hopsFarAndPoor = hops > 2 && incomeLevelAt(from.incomeSpace) < 0;
      // 用户指正：R1-R2 手牌有煤可造时，飞箱优先级应低于先造煤——先煤开巴里/克堡建立自己的煤路网，
      // 等有石油/蹭别人油路网再飞箱速卖；一动飞波士顿、自己 1 煤路网都没有是错的（守护②无煤牌时仍保留飞箱）。
      const earlyCoalFirst = before.round <= 2 && hasCoalCard;
      score += !earlyCoalFirst && hops <= 1 ? 28 : earlyCoalFirst ? -60 : before.round <= 4 && hasCoalCard ? -40 : hopsFarAndPoor ? -8 : 28;
    }
    if (mainLine && unfinished > 0) score += 36;
    // 集中售卖（用户核心指正）：造同流派产业且还能攒到 3 个一起卖 → 加分（鼓励继续造，别造一个卖一个）。
    if (mainLine) {
      const batch = batchPotential(after, pid, style);
      if (batch.canReach3) score += 70;
    }
    // 用户指正：1、2回合（round≤2）造煤/开油田/贷款/修路压收入这些经济动作的优先级，远高于造主线产业（尤其油流飞箱）。
    // 开局默认经济流，先造确定性收益的煤/开油田/贷款/修路为未来流派铺路，不锁主线硬造。
    // 油流（kerosene）飞箱重压：托莱多等飞箱造油无卡位价值，R1/R2 经济动作优先（用户核心指正：别开局飞箱造油）。
    // 箱流（manufacturing）不压：保留"手牌主线明确、早出产业卡位"（纽约/伯利恒箱先到先得、布法罗双修压制），
    // 且 economy 流本身造制造分低（造煤更高），只有起手明确 box（主线明晰）才 R1/R2 早出制造。
    // 早期造油（煤油）抑制：R1-R2 最重、R3-R4 中（用户：改煤/贷权重后 AI 又猛飞箱造油，早期应让位经济动作/造煤）。
    if (built.kind === 'kerosene') {
      if (before.round <= 2) score -= 90;
      else if (before.round <= 4) score -= 50;
    }
    if ((built.id === 'm1' || built.id === 'm2') && action.slotId) {
      const hops = linksToSellMarket(before, slotLocation(before, action.slotId), 'manufacturing');
      score -= hops * (built.id === 'm1' && flying ? 16 : 8);
      // 早期飞箱制造箱（用户：改煤/贷权重后 AI 又猛飞箱）——R1-R2 用位置卡飞箱造箱，
      // 让位给经济动作（开油田/贷款/修路/造煤）。
      // 有煤牌可造 → 重压（引导煤开建立煤路网）；无煤牌 → 温和压（无煤牌飞箱是无替代时的推进/提收入手段，
      // 防空转崩盘——seed66/seed2000 P3 无煤牌被重压后空转）。晚期/收入正常正常冲分。
      if (flying) {
        // 早期飞箱制造箱（用户：改煤/贷权重后 AI 又猛飞箱）——用位置卡飞箱造箱，让位经济动作。
        // 能煤开（手牌有煤牌 && 空煤位>0）→ 最重压，引导煤开建立煤路网；
        // 无煤可造 → 中压，引导开油田/贷款/修路（seed777 P3 曾从飞箱转向修路+开油田）。
        const canCoal = from.hand.some((c) => cardDef(c.defId).industry === 'coal') && hasCoalSlot(before);
        if (before.round <= 2) score -= canCoal ? 100 : 60;
        else if (before.round <= 4) score -= canCoal ? 70 : 40;
      }
    }
    // 煤油同样按"到卖油市场路数"扣分：连不到/太远（hops 大）时卖不掉，不该硬造（用户：别卖不掉硬造）。
    if ((built.id === 'k2' || built.id === 'k3') && action.slotId) {
      const hops = linksToSellMarket(before, slotLocation(before, action.slotId), 'kerosene');
      score -= hops * 8;
    }
    if (built.id === 'm2' && flying && boughtOutside > 0) {
      const late = eraLate(before.round);
      score -= 100 * (1 - late);
      score += 36 * late;
    }
    score += buildRank(before, pid, style, built);
  }
  const short = from.money < (style === 'oil' ? 11 : 12);
  const beforeDanger = billDanger(from.money, from.incomeSpace);
  const afterDanger = billDanger(to.money, to.incomeSpace);
  const lastAction = before.actionsTaken + 1 >= before.actionsAllowed;
  if (afterDanger > 0) {
    if (afterDanger < beforeDanger) score += 80;
    else score -= afterDanger >= 1000 ? (lastAction ? 900 : 450) : lastAction ? 520 : 280;
  } else if (beforeDanger > 0) score += 360;
  // 早期（round≤5）现金枯竭（动作后现金<5，无论收入）→ 重罚：把现金打光后，即使收入为正，下回合也没现金做动作，
  // 只能贷款续命（收入越负）或 pass（破产式崩）。引导 AI 优先贷款/补煤翻面/翻产业提收入，而非现金不足时硬造产业或铺贵路。
  // 晚期（round≥6）是冲分阶段，收入通常已高、现金低属正常，不重罚以免误伤末期飞箱/造产业。
  // 早期（round≤3）现金纪律更严：动作后现金不足 8 → 重罚（用户：前期钱很贵、资源价值很高，别连续烧钱到破产边缘；
  // 也避免 R2 把现金打到 <8 迫使 R3 贷款 -3、R4 无法回正而破产）。
  if (before.round <= 3 && to.money < 8) score -= 300;
  else if (before.round <= 5 && to.money < 5) score -= 200;
  if (action.type === 'loan') {
    const toLevel = incomeLevelAt(to.incomeSpace);
    const recover = !lastAction && toLevel < 0 && incomeCanRecover(after, pid, style) ? 70 : 0;
    const idle = short && unfinished > 0 && afterDanger === 0 ? 55 : short ? 16 : 6;
    // ===== 贷款价值体系（用户方法论）=====
    // 首贷几乎必做：1时代需约98块（122箱39 + 122煤27 + 炭12 + 双修），早期经济拿五六轮5块才省1贷，否则至少两贷。
    // 首贷/二贷/三贷动作价值差距巨大（首贷最值，可解锁煤开/双修/翻面提收入）。
    const loaned = before.log.filter((l) => l.text.includes('贷款') && l.text.includes(`P${pid + 1}`)).length;
    // 贷后能提收入（能真正煤开翻面）才是好贷；不能提收入时贷款危险（连环贷到破产）。
    // 经典"巴里-伯利恒-哈堡贷煤双"：手牌有煤可造且场上还有空煤位 → 次轮煤开翻面提收入回正。
    // 只认"能煤开"（最可靠的次轮回正）；incomeCanRecover（翻煤铁等）仅在 recover 里给低分，不给高分，
    // 避免乐观误判"贷后能回正"导致无煤时也贷多崩（seed99 P4 贷了却没真翻）。
    const canBuildCoal = from.hand.some((c) => cardDef(c.defId).industry === 'coal') && hasCoalSlot(before);
    const boostIncome = canBuildCoal;
    // 首贷基础分：能提收入时高（煤贷双是超优开局）；不能提收入时低（贷了也回不正，别无脑贷）。
    let loanBase: number;
    if (loaned === 0) loanBase = boostIncome ? 150 : 40;
    else if (loaned === 1) loanBase = boostIncome ? 90 : 20;
    else if (loaned === 2) loanBase = 30;
    else loanBase = -30;
    // 末动控顺位（用户：匹兹堡核心是控顺位）：自己沉底末动时，贷款+连动（贷轻铁焦抢首动）允许"控花钱连动"→ 小加分。
    const turnSteal = lastAction ? 30 : 0;
    score += loanBase + idle + recover + (boostIncome ? 90 : 0) + turnSteal;
    // 贷款纪律：时代1 贷完收入为负 → 防连环贷到破产。
    // 贷后能提收入（boostIncome/recover，煤贷双次轮回正）→ 大幅减轻；不能回正 → 重罚（自杀式连环贷）。
    if (toLevel < 0) {
      const net = boostIncome || recover;
      if (toLevel <= -2) score -= net ? 200 : 900;
      else score -= net ? 70 : 550;
    }
  }
  if (action.type === 'pass') score -= 800;
  if (action.type === 'develop') {
    const removed = action.tileDefIds;
    if (removed.some((id) => id === 'm1' || id === 'm2' || id === 'k2' || id === 'k3')) score -= 60;
    else if ((style === 'box' || style === 'economy') && removed.includes('i1') && builtCount(before, pid, 'm2') === 0) score += 8;
    else score -= 18;
  }
  if (action.type === 'sell') {
    // 集中售卖（用户核心指正）：不"造一个卖一个"。一次多卖每多一块 +40；凑到 ≥3 是目标（省动数+品质星）。
    // 单卖 1 个：若还能再攒到 3 个同流派一起卖，且收入无需紧急翻面提收入 → 单卖是浪费动数，重罚。
    // 若确实造不出更多（手牌不够/来不及）或收入急需要翻面 → 单卖合理（防卖不掉/救命）。
    const base = (unfinished > 0 ? 30 : 10) + Math.max(0, action.slotIds.length - 1) * 40;
    if (action.slotIds.length === 1) {
      const needFlip = incomeLevelAt(from.incomeSpace) < 0;
      const batch = batchPotential(before, pid, style);
      score += batch.canReach3 && !needFlip ? -170 : 25;
    } else {
      score += base + (action.slotIds.length >= 3 ? 100 : 0);
    }
  }
  if (action.type === 'network') {
    score += freeSteel > 0 ? 6 : 0;
    const late = before.round >= 5;
    // 场上有无未连接（未揭开）的新油田；场上油桶是否饱和（不缺油）。
    // 用户：管道早期价值高（开油田片/收入格）；但"没有新油田可开"时管道只是连接/运输（降），"不缺油"时也降。
    const hasNewField = before.oilfields.some((f) => !before.links.some((l) => l.kind === 'pipeline' && pipeline(l.lineId)?.oilfield === f.id));
    const oilSaturated = before.oilfields.reduce((s, f) => s + (f.oil ?? 0), 0) >= 6;
    for (const placement of action.placements) {
      const towardGoods = late && extendsUnsold(before, pid, placement.lineId);
      if (placement.kind === 'pipeline' && placement.pipelineType === 'income') {
        // 早期高（开油田片/收入格收益大）；无新油田可开 → 仅连接/运输，降；油饱和 → 不缺油，降。
        // 用户指正（多轮）：开管价值虚高——煤开 > 贷开 > 管开。AI 开局三家管开（有煤牌也管开）是错的。
        // 收入管早期降到煤开之下：能煤开时让位煤开；油路连不到市场的管（托莱多 Lima 这类连不回东部南部）
        // 其收入格终身价值兑现不了，打折（incomeBlocks 虚高是管开虚高的主因，pipeV 微调覆盖不了）。
        let pipeV = before.round <= 3 ? (style === 'oil' ? 14 : 5) : (style === 'oil' ? 12 : 3);
        if (!hasNewField) pipeV -= 10;
        if (oilSaturated) pipeV -= 8;
        // 能煤开（手牌有煤牌 && 空煤位）→ 早期收入管让位煤开（先造煤建煤路网，再管开是次选）。
        // 用户：煤开 > 贷开 > 管开——有煤牌能煤开时，早期开收入管是错误的（P4 有 ind-coal-7 仍管开克堡是反例）。
        const canCoal = from.hand.some((c) => cardDef(c.defId).industry === 'coal') && hasCoalSlot(before);
        if (canCoal && before.round <= 4) pipeV -= 80;
        // 油路连不到东部/南部主油市场（管线 city 到 Boston 步数大，托莱多 Lima/芝加哥这类西部油区）：
        // 收入格兑现不了/后续油流难卖 → 管道值降 + 该管收入格终身价值打折（用户：管开托莱多不可取，连不回东部南部）。
        // 克堡/巴里（核心煤城，管开可配合煤开）豁免——手牌无煤时管开克堡/巴里可接受（用户点名）。
        const pipeCity = pipeline(placement.lineId)?.city;
        const oilHopsEast = pipeCity ? linksToEastOil(before, pipeCity) : 8;
        if (oilHopsEast > 3 && !isCoreCoalCity(pipeCity)) {
          pipeV -= 35;
          score -= incomeSoft * 0.5;
        }
        score += pipeV;
      } else if (placement.kind === 'pipeline' && placement.pipelineType === 'reserve') {
        // 断管 = 储备管道。可用区里还能铺收入/钱/分管时，不优先选储备管。
        if (hasNonReservePipeOption(before, pid)) score -= 220;
        // 软先验：煤开 > 管开——有煤可造时早期让位煤开。
        const canCoalNow = from.hand.some((c) => cardDef(c.defId).industry === 'coal') && hasCoalSlot(before);
        if (canCoalNow && before.round <= 2) score -= 30;
      }
      if (placement.kind === 'lightTrain') {
        const points = roadPoints(before, placement.lineId);
        if (towardGoods) score += 40;
        else {
          score += points >= 5 ? points : -14;
          if (unfinished > 0) score -= 36;
          if (action.placements.indexOf(placement) === 1) score -= points >= 5 ? 0 : 24;
        }
      } else if (placement.kind !== 'pipeline') {
        const points = roadPoints(before, placement.lineId);
        if (placement.kind === 'heavyTrain') {
          // 低路分重车（用户指正）：只当"扭转收入"手段——收入负时避免一直吃 -3 利息，此时允许修；
          // 收入不低且无战略价值时（如布法罗-罗切斯特这种低分路）直接不修（重罚）。修路优先选高路分。
          const low = points <= 3;
          if (low && !towardGoods) score += incomeLevelAt(from.incomeSpace) < 0 ? 32 : -90;
          else {
            score += points;
            if (towardGoods) score += 40;
          }
        } else {
          score += points;
          if (towardGoods) score += 40;
        }
      }
      const line = rail(placement.lineId);
      if (line?.bonus?.freeDevelop && placement.kind !== 'lightTrain') score += 6;
      // 开油田鼓励：连到未揭开油田的铁路（1 时代也值得，油田连接给收入/免费开发/钱）；油田已全揭开则不再加。
      if (hasNewField && pipeline(placement.lineId)?.oil !== undefined) score += 10;
    }
    if (late) score += newlyReachableGoods(before, after, pid) * 80;
  }
  return score;
}

/**
 * 集中售卖前瞻（用户核心指正）：AI 不应"造一个卖一个"。
 * 判断当前能否再攒到 3 个同流派产业一起卖——省动数 + 配合威士忌争取品质星。
 * - 手牌（产业牌 + 可造该流派的地点牌）还够把总数造到 ≥3（如 3 煤油 / 3 制造）
 * - 现金 + 可贷足够造到 3 个（每个约 $12；已造 1 个则钱需求少 ~13）
 * - 时代还有余力（round ≤ 6，R7 后得抓紧卖，不再攒）
 * box 流攒制造、oil 流攒煤油；economy 流不干预（它本来就动态平衡每个动作）。
 */
function batchPotential(current: GameState, pid: PlayerId, style: Role): { unsold: number; canReach3: boolean } {
  const kind = style === 'box' ? 'manufacturing' : style === 'oil' ? 'kerosene' : null;
  if (!kind) return { unsold: 0, canReach3: false };
  const pl = player(current, pid);
  let unsold = 0;
  for (const slot of current.slots) {
    if (slot.owner !== pid || !slot.tileDefId) continue;
    let k: string | null = null;
    try {
      k = tile(slot.tileDefId).kind;
    } catch {
      k = null;
    }
    if (k === kind) unsold += 1;
  }
  // 手牌还能造该流派的数量：产业牌 + 能造该流派的地点牌
  let hand = 0;
  for (const card of pl.hand) {
    const def = cardDef(card.defId);
    if (def.kind === 'industry' && def.industry === kind) {
      hand += 1;
      continue;
    }
    if (def.kind === 'location' && def.locationId) {
      const loc = locDef(def.locationId);
      if (loc?.slots?.some((s) => s.allowed.includes(kind))) hand += 1;
    }
  }
  const need = Math.max(0, 3 - unsold);
  const moneyEnough = pl.money + 40 >= need * 12; // 现金 + 可贷额度，每个约 $12
  const canReach3 = unsold + hand >= 3 && need <= 3 && moneyEnough && current.round <= 6;
  return { unsold, canReach3 };
}

/** A second action this turn can lay income, flip a building, or sell back to a non-negative level. */
function incomeCanRecover(state: GameState, pid: PlayerId, style: Role): boolean {
  for (const action of candidates(state, pid, style)) {
    if (action.type === 'loan' || action.type === 'pass') continue;
    const result = applyAction(clone(state), action, { holdTurn: true });
    if (!result.ok) continue;
    if (incomeLevelAt(player(result.state, pid).incomeSpace) >= 0) return true;
  }
  return false;
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

/**
 * 场上是否存在空的可建煤位置（煤位 = 巴里/克堡等 allowed 含 coal 的 slot）。
 * 区别于 emptyCoal（市场煤缺口）："能否煤开"看"手牌有煤牌 && 有煤建筑空位"，不看市场缺口——
 * 开局煤市场满格（缺口 0）时仍应能煤开（用户：煤开 > 贷开 > 管开，早期煤最重要，即使市场满格也要开煤）。
 * 此前用 coalHoles(市场缺口)>0 判断能否煤开 → 开局满格为 0 → AI 有煤牌也误判"不能煤开" → 三家管开（用户指正）。
 */
function hasCoalSlot(current: GameState): boolean {
  for (const slot of current.slots) {
    if (slot.tileDefId) continue; // 空位
    const loc = locDef(slot.locationId);
    if (loc?.slots?.some((s) => s.allowed.includes('coal'))) return true;
  }
  return false;
}

/**
 * 场上 kind 资源的可用免费供给：所有资源建筑该 kind 产出 cube（未翻面剩余）+ 市场该 kind 库存。
 * 反映"场上统一连接里可免费拿到的同类资源"是否充足——充足时再造同类资源建筑，产出会翻不掉/卖不掉，
 * 不如直接用免费资源造产业（用户：AI 疯狂造煤厂、造出来又翻不掉，应压制）。
 */
function freeSupply(current: GameState, kind: string): number {
  let supply = 0;
  for (const slot of current.slots) {
    if (slot.tileDefId) supply += (slot.cubes as Record<string, number>)[kind] ?? 0;
  }
  for (const market of current.markets) {
    const def = marketDef(market.id);
    if (!def) continue;
    const column = def.cubes.indexOf(kind as never);
    if (column < 0) continue;
    const per = market.slots.length / def.cubes.length;
    for (let index = 0; index < per; index += 1) {
      const c = market.slots[column * per + index]?.cube;
      if (c === (kind as never)) supply += 1;
    }
  }
  return supply;
}

function mainRemaining(current: GameState, pid: PlayerId, style: Role): number {
  if (current.era === 2) return crownRemaining(current, pid, style);
  if (style === 'box') {
    return Math.max(0, 2 - builtCount(current, pid, 'm1')) + (builtCount(current, pid, 'm2') < 1 ? 1 : 0);
  }
  return Math.max(0, 2 - builtCount(current, pid, 'k2')) + (builtCount(current, pid, 'k3') < 1 ? 1 : 0);
}

/**
 * 2 时代长线目标（皇冠产业）剩余：
 * 每条流的自己的皇冠产业（oil 流 oilCity 石油城 / box 流 locomotive 重型机车厂）
 * + 共用的发电厂 polyphase。目标是把两个皇冠都造出来。
 */
function crownRemaining(current: GameState, pid: PlayerId, style: Role): number {
  let missing = 0;
  if (style === 'box') {
    if (builtCount(current, pid, 'locomotive') < 1) {
      // 重型机车厂需 m5 前置，缺前置也计入
      missing += 1 + (builtCount(current, pid, 'm5') < 2 ? 1 : 0);
    }
  } else {
    if (builtCount(current, pid, 'oilCity') < 1) {
      // 石油城需 k4（44 油）前置
      missing += 1 + (builtCount(current, pid, 'k4') < 1 ? 1 : 0);
    }
  }
  if (builtCount(current, pid, 'polyphase') < 1) missing += 1;
  return missing;
}

/** 2 时代建造倾向：严格按 mat 解锁链推进皇冠，抑制无脑造煤/炼钢/低价值产业。 */
function era2BuildRank(current: GameState, pid: PlayerId, style: Role, built: TileDef): number {
  const phase = builtCount(current, pid, 'polyphase');
  const c3 = builtCount(current, pid, 'c3');
  // 皇冠产业本身：发电厂 + 各自主线皇冠
  if (built.kind === 'polyphase') return phase ? 40 : 120;
  if (style === 'oil') {
    const oilCity = builtCount(current, pid, 'oilCity');
    const k4 = builtCount(current, pid, 'k4');
    const k3 = builtCount(current, pid, 'k3');
    if (built.kind === 'oilCity') return oilCity ? 40 : 130;
    if (built.id === 'k4' && oilCity < 1) return 92;                          // 44 油，石油城前置
    if (built.id === 'k3' && k4 < 1 && oilCity < 1) return k3 < 3 ? 46 : 12;  // 解锁 k4 需 mat 上 3 块 k3 全造/研
    if (built.kind === 'coal') return built.id === 'c3' && phase < 1 ? (c3 < 2 ? 40 : 10) : -30; // 只有 c3 通往发电厂
    return -20;                                                               // 2 时代其他产业不值得
  }
  // box 流
  const loco = builtCount(current, pid, 'locomotive');
  const m5 = builtCount(current, pid, 'm5');
  const m3 = builtCount(current, pid, 'm3');
  if (built.kind === 'locomotive') return loco ? 40 : 130;
  if (built.id === 'm5' && loco < 1) return 94;                               // 55 箱，重车厂前置
  if (built.id === 'm3' && m5 < 1 && loco < 1) return m3 < 2 ? 48 : 12;       // 解锁 m5 需 mat 上 2 块 m3
  if (built.kind === 'coal') return built.id === 'c3' && phase < 1 ? (c3 < 2 ? 42 : 10) : -30;
  return -20;
}

/** 2 时代整步评分：主项 + 皇冠推进 / 轻车抢高分路 / 煤降权 / develop 皇冠前置。 */
function scoreEra2(before: GameState, after: GameState, pid: PlayerId, action: Action, style: Role): number {
  const from = player(before, pid);
  const to = player(after, pid);
  const text = after.log.slice(before.log.length).map((entry) => entry.text).join(' ');
  const boughtOutside = countOf(text, '从外部购买');
  const freeCoal = countOf(text, '的免费煤');
  const freeIron = countOf(text, '的免费铁');
  const freeCoke = countOf(text, '的免费焦炭');
  const freeSteel = countOf(text, '的免费钢');
  const filled = marketStock(after) - marketStock(before);
  const locoBuilt = builtCount(before, pid, 'locomotive') > 0;
  let score = (to.incomeSpace - from.incomeSpace) * 6
    + (to.money - from.money) * 0.35
    + (to.vp - from.vp) * 3;
  const beforeDanger = billDanger(from.money, from.incomeSpace);
  const afterDanger = billDanger(to.money, to.incomeSpace);
  if (afterDanger > 0) {
    if (afterDanger < beforeDanger) score += 80;
    else score -= afterDanger >= 1000 ? 700 : 420;
  } else if (beforeDanger > 0) {
    score += 300;
  }
  // 2 时代补资源仍是核心：连路后满补 / 用免费资源帮翻面提收入，与 1 时代同权重。
  // 这对应用户要点"2时代初期有连路之后满补资源的机会要果断补"。
  score += filled * 20 + freeCoal * 28 + (freeIron + freeCoke) * 18 + freeSteel * 14;
  // 外部购买：2时代后期资源便宜可放宽，但初期（前3回合）仍稍压（用户：外部买铁开管初期不可接受）。
  score += (countOf(text, '购买') - boughtOutside) * 10 - boughtOutside * (before.round <= 3 ? 50 : 20);
  // 外部购买且无补市场（纯高价消费）初期重罚（2时代同源逻辑，较轻，后期不罚）。
  if (boughtOutside > 0 && filled === 0) score -= before.round <= 3 ? 120 : 0;
  if (action.type === 'build') {
    const built = tile(action.tileDefId);
    score += era2BuildRank(before, pid, style, built);
    // 2 时代：场上统一连接大量免费煤 → 再造煤厂产出翻不掉，压制（与 1 时代同源，较轻）。
    if (built.kind === 'coal') {
      const coalSupply = freeSupply(before, 'coal');
      if (coalSupply >= 4) score -= 90;
      else if (coalSupply >= 3) score -= 45;
    }
    // 2 时代初（前3回合）路线不明朗，确定性煤值得；巴里/克堡（天然铁、位置易被占）更优先。
    // 后期恢复皇冠链优先（era2BuildRank 已把后期普通煤降为负）。
    if (built.kind === 'coal' && before.round <= 3) {
      const loc = action.slotId ? slotLocation(before, action.slotId) : '';
      score += 44 + (loc === 'wilkes-barre' || loc === 'clarksburg' ? 18 : 0);
    }
    // 煤焦/铁焦满补（2焦补4，机会难得）——补资源时焦炭格外值。
    if (built.kind === 'coke' && filled > 0) score += 28;
    // 集中售卖：2时代造制造/煤油同流派且还能攒到 3 个一起卖 → 加分（别造一个卖一个，品质星更值）。
    if (built.kind === 'manufacturing' || built.kind === 'kerosene') {
      const batch = batchPotential(after, pid, style);
      if (batch.canReach3) score += 60;
    }
  } else if (action.type === 'develop') {
    // 研掉低阶产业，解锁皇冠链：box 流 m1/m2/m3/m4，oil 流 k2/k3
    const useful = style === 'box' || style === 'economy'
      ? action.tileDefIds.some((id) => id === 'm1' || id === 'm2' || id === 'm3' || id === 'm4')
      : action.tileDefIds.some((id) => id === 'k2' || id === 'k3');
    score += useful ? 55 : -25;
  } else if (action.type === 'network') {
    // 2 时代轻车性价比高，抢高分路；重车只有箱流（有重车厂）才划算；
    // 车头（重型机车厂）给每辆重车额外加成；威士忌重车 / 路面奖励的威士忌也值。
    score += countOf(text, '威士忌') * 18;
    for (const placement of action.placements) {
      if (placement.kind === 'lightTrain') {
        const points = roadPoints(before, placement.lineId);
        score += points >= 5 ? points + 34 : points - 8;
      } else if (placement.kind === 'heavyTrain') {
        const points = roadPoints(before, placement.lineId);
        // 重车只有箱流且有重车厂（车头加成）才划算；无车头时低分重车是亏（油流 -12；箱流无车头也压到 -8）。
        score += points + (style === 'box' ? (locoBuilt ? 26 : -8) : -12);
      } else if (placement.kind === 'pipeline') {
        // 通向油田的管道是石油城（皇冠）前置，2 时代应优先铺
        score += pipeline(placement.lineId)?.oil !== undefined ? 40 : 8;
      }
    }
  } else if (action.type === 'sell') {
    // 2时代同样该集中卖（品质星更值，1卖集中冲分）。单卖且还能攒到 3 个 → 重罚；否则正常。
    if (action.slotIds.length === 1) {
      const needFlip = incomeLevelAt(from.incomeSpace) < 0;
      const batch = batchPotential(before, pid, style);
      score += batch.canReach3 && !needFlip ? -150 : 24;
    } else {
      score += 24 + Math.max(0, action.slotIds.length - 1) * 30 + (action.slotIds.length >= 3 ? 90 : 0);
    }
    // 早推主线 / 一次多卖拿品质星，奖励冲分（用户要点6）
    score += countOf(text, '品质星') * 45;
  } else if (action.type === 'loan') {
    // 贷款降收入，长期有害：只在紧急（付不起账单）时才允许
    score += afterDanger > 0 ? 20 : -120;
  } else if (action.type === 'pass') {
    // pass 是最后手段（真人几乎从不 pass：市场空→连市场补市场，市场满→走主线消耗便宜资源，
    // 钱不够→贷款，贷后收入低→速下煤双修回正）。压到极低，让贷/双修/补市场/走主线优先。
    score -= 800;
  }
  return score;
}

function marketStock(current: GameState): number {
  return current.markets.reduce((sum, market) => sum + market.slots.filter((slot) => slot.cube).length, 0);
}

export function builtCount(current: GameState, pid: PlayerId, defId: string): number {
  return current.slots.filter((slot) => slot.owner === pid && slot.tileDefId === defId).length;
}

// 自己近期能否消耗钢（造制造/汽车/楼/火车头都耗钢）：手牌有可造这类产业卡 → 能消耗（补钢）。
// 用户指正：造铁/钢厂产的钢必须自己消化大部分，至多送 1 钢给下家。
function canConsumeSteel(current: GameState, pid: PlayerId): boolean {
  const pl = player(current, pid);
  const defs = accessibleTileDefs(pl);
  const kinds = new Set(defs.map((t) => t.kind));
  for (const card of pl.hand) {
    const def = cardDef(card.defId);
    if (def.kind !== 'industry') continue;
    const k = def.industry;
    if ((k === 'manufacturing' || k === 'automobile' || k === 'skyscraper' || k === 'locomotive') && kinds.has(k)) return true;
  }
  return false;
}

export function buildRank(current: GameState, pid: PlayerId, style: Role, built: TileDef): number {
  if (current.era === 2) return era2BuildRank(current, pid, style, built);
  const m1 = builtCount(current, pid, 'm1');
  const m2 = builtCount(current, pid, 'm2');
  const k2 = builtCount(current, pid, 'k2');
  const k3 = builtCount(current, pid, 'k3');
  let score = 0;
  if (built.kind === 'coal' || built.kind === 'coke') score += 38;
  if (built.kind === 'iron' || built.kind === 'steel') {
    score += style === 'oil' ? 12 : 30;
    // 用户指正：造铁/钢厂产的钢必须自己消化大部分，至多送 1 钢给下家；铁可稍送。
    // 补钢：自己下一动能消耗钢（手牌有可造制造）→ 本次产钢可被消化，加分。
    // 溢出：盘面自己已积压的钢 + 本次产钢，超过消化余量（≤1，留 1 钢可接受）→ 钢送下家，重罚。
    // 针对"下 4 铁送 5 个钢"这种连续造铁厂、自己不用钢、钢堆给下家的打法。
    const steelOut = built.produces?.steel ?? 0;
    if (steelOut > 0) {
      const consume = canConsumeSteel(current, pid);
      const mySteel = current.slots
        .filter((s) => s.owner === pid)
        .reduce((sum, s) => sum + (s.cubes.steel ?? 0), 0);
      const slack = mySteel + steelOut - (consume ? 2 : 1); // 自己能消化到剩 ≤1
      if (slack > 0) score -= slack * 40;   // 钢溢出送下家
      else if (consume) score += 18;         // 补钢：造的钢能被自己下一步消耗掉
    }
  }
  if (built.upgradeFrom) score += 6;
  // 1时代前4回合（开局阶段）压低“产业开”，让煤/补资源占优；过了开局期恢复原分。
  // 但若手牌足以开该流派（flowReady），则不压低——允许早期产业开卡关键位置（对应攻略的产业开）。
  const early = current.era === 1 && current.round <= 4;
  // 连续产业开纪律：flowReady 允许第一个产业开卡位；但若已造过同流派产业、现金不足以再支撑
  // “产业开 + 后续提收入动作”（<26），且收入仍未转正（≤0），则抑制后续产业开 → 转向煤/补收入/提收入。
  // 针对“起手连续 2 产业把现金耗光、收入 0、后期只能 pass”（本局 P3 的败因）。
  const pl = player(current, pid);
  const hasStyle = style === 'box' ? m1 + m2 : style === 'oil' ? k2 + k3 : 0;
  // 早期产业开抑制：只在"已造过同流派产业且现金不足且收入未转正"时生效（防止连续产业开现金枯竭崩）。
  // 第一次产业开不压（手牌主线明确可早出产卡位，flowReady 豁免）；若现金枯竭到极致由 scoreAction 的
  // to.money<5 重罚兜底。注意：不能无条件压（会误伤 seed101 P3 这种手牌 kerosene 明确、cash 少但该开主线
  // 的油流玩家——压了反而没替代、主线没推进而崩）。
  const cashTight = hasStyle >= 1 && pl.money < 26 && incomeLevelAt(pl.incomeSpace) <= 0;
  const suppress = early && (!flowReady(current, pid, style) || cashTight);
  if (style === 'box') {
    if (built.id === 'm1' && m1 < 2) score += suppress ? 42 : 72;
    if (built.id === 'm2' && m2 < 1) score += suppress ? 52 : 110;
    if (built.id === 's2' && m2 < 1) score += 26;
    if (built.id === 'i1' && m2 < 1) score += 10;
    if (built.id === 'm3' || built.kind === 'automobile' || built.kind === 'skyscraper' || built.kind === 'locomotive' || built.kind === 'kerosene' || built.kind === 'oilCity') {
      score -= 48;
    }
  }
  if (style === 'oil') {
    if (built.id === 'k2' && k2 < 2) score += suppress ? 44 : 76;
    if (built.id === 'k3' && k3 === 0) score += suppress ? 54 : 88;
    if (built.id === 'k3' && k3 === 1) score += suppress ? 24 : 36;
    if (built.kind === 'coal') score += 14;
    if (built.kind === 'manufacturing' || built.kind === 'automobile' || built.kind === 'skyscraper' || built.kind === 'locomotive' || built.id === 'k4' || built.kind === 'oilCity') {
      score -= 48;
    }
  }
  if (style === 'economy') {
    // 无流派（经济流）：不绑定箱/油目标——动态平衡每个动作的价值，没有必做的事情，分够都可以不做。
    // 制造/煤油给中性基础分（不偏、非必造），造得出/能连市场/有补资源价值才造；造不出或卖不掉不硬造。
    // 来不及造主线产业时，研发是灵活工具，可研掉不要的产业牌推主线（如三家玩油煤耗大、一直补煤没空造箱）。
    if (built.id === 'm1' && m1 < 2) score += suppress ? 20 : 40;
    if (built.id === 'm2' && m2 < 1) score += suppress ? 24 : 48;
    if (built.id === 'k2' && k2 < 2) score += suppress ? 16 : 36;
    if (built.id === 'k3' && k3 === 0) score += suppress ? 22 : 44;
    if (built.kind === 'automobile' || built.kind === 'skyscraper' || built.kind === 'locomotive' || built.id === 'oilCity') score -= 30; // 早期不押皇冠
  }
  return score;
}

/**
 * 读开局手牌，为每个流派（箱/油）评估可行性（阶段1：地点牌感知 + 市场连通）。
 * - 产业牌：制造→箱；煤油/石油城→油；煤焦铁钢→通用资源（两边各记一点，不偏向）。
 * - 地点牌：看该位置能造什么产业（location.slots[].allowed），并按“连到当前市场的步数”
 *   （linksToSellMarket，0=已连，8=够不到/未知）加权：越容易连到市场，对流派的支持越强。
 * 这样 AI 能回答用户要求的“手里地点牌对应什么位置、能不能支持流派、能不能连到市场”。
 */
export function handFlowScore(state: GameState, hand: Card[]): { box: number; oil: number } {
  let box = 0;
  let oil = 0;
  for (const card of hand) {
    const def = cardDef(card.defId);
    if (def.kind === 'industry' && def.industry) {
      if (def.industry === 'manufacturing') box += 30;
      else if (def.industry === 'kerosene' || def.industry === 'oilCity') oil += 42;
      else if (def.industry === 'coal' || def.industry === 'coke' || def.industry === 'iron' || def.industry === 'steel') {
        box += 4;
        oil += 4;
      }
    } else if (def.kind === 'location' && def.locationId) {
      const loc = locDef(def.locationId);
      if (!loc || !loc.slots || loc.slots.length === 0) continue;
      if (loc.slots.some((s) => s.allowed.includes('manufacturing'))) {
        const hops = linksToStableSellMarket(state, def.locationId, 'manufacturing');
        box += 20 + (8 - hops) * 3;
      }
      if (loc.slots.some((s) => s.allowed.includes('kerosene'))) {
        const hops = linksToStableSellMarket(state, def.locationId, 'kerosene');
        oil += 26 + (8 - hops) * 3;
      }
    }
  }
  return { box, oil };
}

/**
 * 判断玩家手牌是否“足以开某个流派”：有对应产业牌 + 有能 1 步内连到当前已知对应市场的
 * 地点牌。够则允许早期产业开抢位；不够则走煤/贷/管/路开、不急着锁流派。
 * 这对应攻略：人类多数选煤开/贷开/管开/路开，只在“地点牌全、主线明晰、能卡关键位置”时才产业开。
 */
export function flowReady(state: GameState, pid: PlayerId, style: Role): boolean {
  if (style === 'economy') return false; // 经济流（未定流派）不早出产业——转流派浪费移动+资源，等决定了再造对应产业
  let hasIndustry = false;
  let hasConnecting = false;
  for (const card of player(state, pid).hand) {
    const def = cardDef(card.defId);
    if (def.kind === 'industry' && def.industry) {
      if (style === 'box' && def.industry === 'manufacturing') hasIndustry = true;
      if (style === 'oil' && (def.industry === 'kerosene' || def.industry === 'oilCity')) hasIndustry = true;
    } else if (def.kind === 'location' && def.locationId) {
      const loc = locDef(def.locationId);
      if (!loc || !loc.slots) continue;
      if (style === 'box' && loc.slots.some((s) => s.allowed.includes('manufacturing'))) {
        if (linksToSellMarket(state, def.locationId, 'manufacturing') <= 1) hasConnecting = true;
      }
      if (style === 'oil' && loc.slots.some((s) => s.allowed.includes('kerosene'))) {
        if (linksToSellMarket(state, def.locationId, 'kerosene') <= 1) hasConnecting = true;
      }
    }
  }
  return hasIndustry && hasConnecting;
}

/**
 * 为每位玩家独立分派流派，不再强制“两家箱两家油”。
 * 起手读开局 8 张手牌（含地点牌位置与市场连通）：箱/油分差拉到很大（roleGap(1)）才直接定流派；
 * 大多数玩家起手走经济流（economy，不分箱油），等后续 relockRoles 随回合、看手牌+市场分差动态决定——
 * 不存在“开局全员箱、等油价值高再转油”的说法：转流派浪费移动和资源，造出第一个产业后就锁定流派。
 */
/** 手牌是否还有某流派的产业牌（制造→box，煤油/石油城→oil）。锁流派必须要有产业牌。 */
function styleHasIndustry(state: GameState, pid: PlayerId, style: Role): boolean {
  for (const card of player(state, pid).hand) {
    const def = cardDef(card.defId);
    if (def.kind !== 'industry') continue;
    if (style === 'box' && def.industry === 'manufacturing') return true;
    if (style === 'oil' && (def.industry === 'kerosene' || def.industry === 'oilCity')) return true;
  }
  return false;
}

export function assignRoles(current: GameState): Record<PlayerId, Role> {
  const roles = {} as Record<PlayerId, Role>;
  for (const entry of current.players) {
    const { box, oil } = handFlowScore(current, entry.hand);
    const gap = roleGap(1);
    // 锁流派必须手牌有对应产业牌（用户：一开始标签都是经济流/无流派，产业牌不支持就多走经济出煤铁）。
    // 纯地点牌（无任何产业牌）起手，即使箱/油分差大也不锁——避免"决定油但飞箱硬造、手牌却造不出"的崩局
    // （seed777 P3 起手 8 张全是地点牌却锁油，R2 飞箱造煤油把收入打到 -1，之后连环贷款崩）。
    const hasBox = styleHasIndustry(current, entry.id, 'box');
    const hasOil = styleHasIndustry(current, entry.id, 'oil');
    let r: Role = 'economy';
    if (hasOil && oil - box >= gap) r = 'oil';
    else if (hasBox && box - oil >= gap) r = 'box';
    roles[entry.id] = r;
  }
  return roles;
}

/**
 * 流派决定的“分差阈值”，随回合递减（回合越晚越果断——第四回合产业牌一张都没造就来不及造完三张）。
 * 起手 R1 分差需很大（30）才直接定流派——人类默认煤/贷/管/路开，不一开始锁流派；
 * 大多数玩家开局走经济流（economy），等到分差拉开（或后期来不及）才决定箱还是油。
 * R3 起按当前手牌+已翻开市场重估；R4 后阈值快速下降，后期快速决定以免来不及造主线。
 */
function roleGap(round: number): number {
  // 起手 R1/R2 分差需较大（50/35）才直接定流派——人类默认煤/贷/管/路开，绝大多数起手走经济流（无流派），
  // 先造煤、开油田、贷款、修路压收入，不一开始锁流派/飞箱造油（用户：1、2回合造煤/开油田/贷款/修路的优先级远高于造主线产业）。
  // 手牌分差极大（≥50/35）才提前定型；R3 起阈值骤降开始决定流派（第三回合左右一半煤油一半箱子），越晚越果断以免来不及造主线。
  if (round <= 1) return 50;
  if (round === 2) return 35;
  if (round === 3) return 16;
  if (round === 4) return 10;
  if (round === 5) return 5;
  return 2;
}

/** 已造出的产业类型集合，用于流派重锁的护栏（防止中途翻转造成孤立产业）。 */
function builtIndustries(current: GameState, pid: PlayerId): { mfg: boolean; kero: boolean } {
  let mfg = false;
  let kero = false;
  for (const slot of current.slots) {
    if (slot.owner !== pid || !slot.tileDefId) continue;
    let kind: string | null = null;
    try {
      kind = tile(slot.tileDefId).kind;
    } catch {
      kind = null;
    }
    if (kind === 'manufacturing' || kind === 'automobile' || kind === 'skyscraper' || kind === 'locomotive') mfg = true;
    if (kind === 'kerosene' || kind === 'oilCity') kero = true;
  }
  return { mfg, kero };
}

/**
 * 每回合的动态流派决定。起始标签是经济流（economy，无流派）：
 * - 已造出制造/汽车/楼/火车头 → 锁箱；已造出煤油/石油城 → 锁油（护栏，造出第一个产业就锁定流派）。
 * - 未造产业且已决定过流派（box/oil）→ 保持，不回退到经济流（决定后稳定，转流派浪费移动和资源）。
 * - 仍是经济流 → 按当前手牌+已翻开市场的箱/油分差决定：分差拉开到 roleGap（随回合递减）→ 定领先流派；
 *   分差接近 → 保持经济流，继续读牌；越到后期阈值越低，避免来不及造主线。
 * 这也补上开局市场未翻、连通信号弱的局限：到中局更多手牌/货架可见，油流才能被识别。
 */
export function relockRoles(current: GameState, prev: Record<PlayerId, Role>): Record<PlayerId, Role> {
  const roles = { ...prev };
  for (const entry of current.players) {
    const pid = entry.id;
    const { mfg, kero } = builtIndustries(current, pid);
    if (mfg) {
      roles[pid] = 'box';
      continue;
    }
    if (kero) {
      roles[pid] = 'oil';
      continue;
    }
    if (prev[pid] === 'box' || prev[pid] === 'oil') {
      // 已决定流派：手牌若还有对应产业牌 → 保留；若手牌已无对应产业牌且未造出对应产业 → 降级经济流，
      // 避免"决定油但手牌没油牌仍飞箱硬造"（用户：来不及可研掉/多走经济，不硬造造不出的流派）。
      if (styleHasIndustry(current, pid, prev[pid])) continue;
      roles[pid] = 'economy';
      continue;
    }
    const { box, oil } = handFlowScore(current, entry.hand);
    const gap = roleGap(current.round);
    // 锁流派同样要求手牌有对应产业牌；纯地点牌分差大也不锁，保持经济流（继续读牌/走经济）。
    const hasBox = styleHasIndustry(current, pid, 'box');
    const hasOil = styleHasIndustry(current, pid, 'oil');
    let r: Role = 'economy';
    if (hasOil && oil - box >= gap) r = 'oil';
    else if (hasBox && box - oil >= gap) r = 'box';
    roles[pid] = r;
    // 分差接近 → 保持经济流（economy，继续读牌）
  }
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

/** BFS：从 city 到任一目标市场的未铺铁路最少段数（已连=0，够不到/无目标=8）。 */
function minLinksTo(state: GameState, city: string, targets: string[]): number {
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

/**
 * 到东部/南部主油市场（Boston，mer-15 首卖市场所在地）的连接步数——油流最终要连东部南部卖油才有价值。
 * 区别于 linksToStableSellMarket（最近稳定油市）：伊兹桥稳定油市在极西（x80），托莱多近伊兹桥（2步）
 * 但连不回东部南部（到 Boston 6步）——用户：管开托莱多不可取，第一个建筑飞托莱多只有"双修连芝加哥/萨吉诺补煤"。
 * 油流终点判断应看"到东部南部主市场（Boston）"，而非最近稳定油市。
 */
function linksToEastOil(state: GameState, city: string): number {
  return minLinksTo(state, city, ['boston']);
}

/** 用户方法论：只有手牌一张"巴里克堡煤"都没有，才考虑管开克堡/巴里（核心煤城，管开可配合煤开）。
 *  托莱多等西部油区不是煤城，管开纯粹油路、连不回东部南部 → 不可取。 */
function isCoreCoalCity(city: string | undefined): boolean {
  return city === 'clarksburg' || city === 'wilkes-barre';
}

/** Unbuilt rail links between a city and the nearest merchant that currently buys this industry. Already-connected cities are 0. */
export function linksToSellMarket(state: GameState, city: string, kind: IndustryKind): number {
  const targets = state.merchants.filter((merchant) => merchantSells(merchant, kind)).map((merchant) => merchant.locationId);
  return minLinksTo(state, city, targets);
}

/**
 * 到“可长期稳定出售”市场的连接步数：排除 $15 首卖市场（只有一个人能卖，不能作为长期稳定的
 * 出售窗口），只看固定产业市场。已连=0，够不到/无稳定市场=8。
 * 用于流派可行性（handFlowScore）判断：决定走箱还是走油时，看的是“能不能长期连到稳定市场卖”
 * 而不是“首卖那一局刚好能卖到的最近位置”——例如托莱多到波士顿的油稳定市场很远、东部箱位离
 * 伊兹桥箱市场很远，这类城市牌的流派支持都应大幅调低。
 */
export function linksToStableSellMarket(state: GameState, city: string, kind: IndustryKind): number {
  const targets = state.merchants
    .filter((merchant) => merchant.tileId !== 'mer-15' && merchantSells(merchant, kind))
    .map((merchant) => merchant.locationId);
  return minLinksTo(state, city, targets);
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
  if (style === 'economy') {
    // 经济流（无流派）：最想留煤铁焦（走经济），产业牌中等保留（可能转流派），不要立刻丢。
    if (def.industry === 'coal' || def.industry === 'coke' || def.industry === 'iron' || def.industry === 'steel') return 5;
    if (def.industry === 'manufacturing' || def.industry === 'kerosene' || def.industry === 'oilCity') return 3;
    return 0;
  }
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

/** 玩家已拥有且已翻面（兑现）的建筑数。翻面 = 吃到翻转奖励/产出，是局面里"已实现价值"。 */
function flippedOwned(current: GameState, pid: PlayerId): number {
  let n = 0;
  for (const slot of current.slots) {
    if (slot.owner === pid && slot.tileDefId && slot.flipped) n += 1;
  }
  return n;
}

/**
 * 局面评估（期望 VP 语言，value-framework v3）。
 * 主轴：已有 VP + 现金折算 + 可兑现高档产业分；收入仅轻量期权；争第一用相对 VP。
 * 供 MCTS 叶子 / 前向尾部；与 scoreAction 战术内部分刻意分离，根选勿再异尺硬加。
 */
export function evaluateState(state: GameState, pid: PlayerId, style: Role): number {
  const p = player(state, pid);
  const round = state.round;
  const roundsLeft = roundsLeftApprox(state.era, round);
  const income = incomeLevelAt(p.incomeSpace);
  let s = 0;

  // 主轴：已有 VP + 钱
  s += p.vp;
  s += moneyToVp(p.money, state.era, round);

  // 收入：规则不算分；负收入按未来掉钱期权惩罚，正收入仅轻量期权
  if (income < 0) s += incomeAsOptionVp(income, roundsLeft, state.era, round, 0.5);
  else s += incomeAsOptionVp(income, roundsLeft, state.era, round, 0.15);
  const danger = billDanger(p.money, p.incomeSpace);
  if (danger >= 1000) s -= 40; // 对齐破产级扣分量级
  else if (danger > 0) s -= 8;

  // 可兑现产业分：已翻面按 tile.vp；未翻但连到市场按档次部分计入（高级产业哲学）
  let sellableGoods = 0;
  for (const slot of state.slots) {
    if (slot.owner !== pid || !slot.tileDefId) continue;
    const def = tile(slot.tileDefId);
    if (slot.flipped) {
      s += def.vp;
      continue;
    }
    if (!def.sellable) {
      // 煤：软先验煤开>西北空降。核心煤城（巴里/克堡）早期显著高于萨吉诺等，供 MCTS 叶子与贪心同向。
      if (def.kind === 'coal') {
        if (isCoreCoalCity(slot.locationId)) s += state.round <= 4 ? 12 : 5;
        else if (slot.locationId === 'saginaw' || slot.locationId === 'toledo') s += state.round <= 4 ? 0.5 : 2;
        else s += 2.5;
      }
      continue;
    }
    const canSell = merchantsForSale(state, slot.locationId, def.kind).length > 0;
    if (canSell) {
      sellableGoods += 1;
      s += def.vp * (def.vp >= 10 ? 0.55 : 0.35);
    } else {
      s -= def.vp >= 10 ? 2 : 1;
    }
  }
  s += sellableGoods * 0.5;
  s -= unsoldWithoutMarket(state, pid).length * 1.5;

  // 流派落地轻奖（特征，非主轴）
  if (styleHasIndustry(state, pid, style)) s += 2;

  // 手牌弹性：煤牌略抬（煤开软先验），其余很轻
  const handDefs = p.hand.map((c) => cardDef(c.defId));
  const coalCards = handDefs.filter((c) => c.kind === 'industry' && c.industry === 'coal').length;
  s += coalCards * 1.5 + handDefs.length * 0.15;

  // 争第一：相对最高对手 VP
  let bestOpp = -Infinity;
  for (const o of state.players) {
    if (o.id === pid) continue;
    bestOpp = Math.max(bestOpp, o.vp + moneyToVp(o.money, state.era, round) * 0.5);
  }
  if (Number.isFinite(bestOpp)) s += (p.vp - bestOpp) * 0.25;

  return s;
}

/**
 * #29 局面特征向量：从 evaluateState 的七组特征中提取原始数值向量，供 Python 价值网络作为 ML 输入。
 * 维度固定、不含加权和，标签 = 该玩家终局 vp（离线训练 V(s)≈终局回报）。
 */
export function featureVector(state: GameState, pid: PlayerId, style: Role): number[] {
  const p = player(state, pid);
  const round = state.round;
  const roundsLeft = 8 - round + (state.era === 1 ? 8 : 0);
  const income = incomeLevelAt(p.incomeSpace);
  const built = builtIndustries(state, pid);
  const coalBuilt = builtCount(state, pid, 'c1');
  let sellableGoods = 0;
  for (const slot of state.slots) {
    if (slot.owner !== pid || !slot.tileDefId || slot.flipped) continue;
    const def = tile(slot.tileDefId);
    if (!def.sellable) continue;
    if (merchantsForSale(state, slot.locationId, def.kind).length > 0) sellableGoods += 1;
  }
  const handDefs = p.hand.map((c) => cardDef(c.defId));
  const coalCards = handDefs.filter((c) => c.kind === 'industry' && c.industry === 'coal').length;
  const locCards = handDefs.filter((c) => c.kind === 'location').length;
  const indCards = handDefs.filter((c) => c.kind === 'industry').length;
  let oppIncome = 0;
  let oppCoal = 0;
  for (const o of state.players) {
    if (o.id === pid) continue;
    oppIncome += Math.max(0, incomeLevelAt(o.incomeSpace));
    oppCoal += builtCount(state, o.id, 'c1');
  }
  return [
    roundsLeft, // 0 A 时序
    p.money, // 1 B 现金
    Math.max(0, income), // 2 B 正收入
    Math.min(0, income), // 3 B 负收入
    billDanger(p.money, p.incomeSpace), // 4 B 还贷危机
    built.mfg ? 1 : 0, // 5 C 制造已建
    built.kero ? 1 : 0, // 6 C 煤油已建
    styleHasIndustry(state, pid, style) ? 1 : 0, // 7 C 流派产业已建
    coalBuilt, // 8 C 煤厂数
    flippedOwned(state, pid), // 9 C 已翻面
    sellableGoods, // 10 D 可卖商品
    unsoldWithoutMarket(state, pid).length, // 11 D 未连市场
    coalCards, // 12 E 手牌煤
    locCards, // 13 E 手牌位置
    indCards, // 14 E 手牌产业
    (4 - freeSupply(state, 'coal')) * 1.5, // 15 F 市场煤稀缺
    Math.max(0, income) * 8 - oppIncome, // 16 G 收入领先
    oppCoal, // 17 G 对手煤厂
  ];
}

/**
 * #24 线性 rollout：从 state 连续推进 depth 步（每步当前玩家各自选动作），
 * 累计"自己(pid)回合结束时"的局面期望（evaluateState 长线视角）。
 * rollout 策略用现有一步最优 chooseAiAction（scoreAction 保留全部用户校准的战术规则：
 * 煤开优先、外部买铁惩罚、产业抑制、飞箱门槛），避免粗糙局面分丢失战术判断。
 * 用途：评估一条动作序列的整体回报，识别"铺路→建厂→卖货"这类单步低分、长线联动。
 * 注：applyAction 内部已 clone(state)，调用方无需再 clone。
 */
function rolloutSteps(state: GameState, pid: PlayerId, roles: Record<PlayerId, Role>, depth: number): number {
  let s = state;
  let sum = 0;
  for (let i = 0; i < depth; i++) {
    if (s.over) {
      sum += evaluateState(s, pid, roles[pid]) * (depth - i);
      break;
    }
    const cpid = s.currentPlayerId;
    const act = chooseAiAction(s, cpid, roles);
    if (!act) break;
    const result = applyAction(s, act);
    if (!result.ok) break;
    s = result.state;
    if (cpid === pid) sum += evaluateState(s, pid, roles[pid]);
  }
  return sum;
}

/**
 * #24 有限深度前向：根动作即时分用 scoreAction（战术校准），
 * 再以 rollout 后续 depth 步累计 evaluateState（长线），以 base+tail 排序选动作。
 * 关键：战术选择由 scoreAction 主导（保住煤开>贷开>管开），evaluateState 只负责补足短视。
 * @param depth rollout 推进的步数（每步一个玩家行动；约等于自己行动 depth/4 次）
 * @param width 只展开 base 分最高的前 width 个根动作（控制算力）
 */
export function lookaheadChoose(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { depth?: number; width?: number } = {},
): Action | null {
  const depth = opts.depth ?? 5;
  const width = opts.width ?? 12;
  const ranked: { action: Action; total: number }[] = [];
  for (const action of candidates(state, pid, roles[pid])) {
    const result = applyAction(state, action);
    if (!result.ok) continue;
    const base = scoreAction(state, result.state, pid, action, roles[pid]);
    const tail = rolloutSteps(result.state, pid, roles, depth);
    ranked.push({ action, total: base + tail });
  }
  ranked.sort((a, b) => b.total - a.total);
  if (ranked.length <= width) return ranked[0]?.action ?? null;
  return ranked.slice(0, width)[0]?.action ?? null;
}

// ============ #25 确定化 MCTS 框架 ============
/**
 * #27 静态粗分（无需推演）：用于候选预筛，把"明显劣/弱动作"快速过滤，再对粗分靠前的 topM 个做精确 scoreAction 排序。
 * 保留战术主序（煤开 build > 收入管 network > develop > sell > loan > pass），不丢"煤开优先"倾向。
 */
function cheapActionScore(action: Action): number {
  switch (action.type) {
    case 'build': {
      if (!action.tileDefId || tile(action.tileDefId).kind !== 'coal') return 60;
      // 开局分支爆炸：粗筛先抬核心煤城，避免萨吉诺等空降煤挤掉巴里/克堡展开名额
      const parts = action.slotId ? String(action.slotId).split('-') : [];
      const city = parts.length > 1 ? parts.slice(0, -1).join('-') : parts[0];
      return isCoreCoalCity(city) ? 120 : 95;
    }
    case 'network':
      return 40;
    case 'develop':
      return 30;
    case 'sell':
      return 25;
    case 'loan':
      // 首贷几乎常做（哲学软先验）：粗筛必须留住 loan，否则时代1定锚/MCTS 根本比不到贷开
      return 70;
    case 'pass':
      return -30;
    default:
      return 0;
  }
}

/**
 * #28 对手建模：rollout/展开时，对"非决策玩家"的动作按 opponentStyle 偏置 scoreAction 分。
 * mirror=对手用同一策略（简易默认）；conservative=对手少激进建厂/少贷款；aggressive=对手更积极建厂。
 * 真·对手推断（猜测对手手牌）超出本步范围，此参数提供风格化建模接口。
 */
export type OpponentStyle = 'mirror' | 'conservative' | 'aggressive';

function styleScore(
  state: GameState,
  after: GameState,
  cpid: PlayerId,
  action: Action,
  role: Role,
  ctx?: { selfPid: PlayerId; opponentStyle?: OpponentStyle },
): number {
  const base = scoreAction(state, after, cpid, action, role);
  if (!ctx || ctx.selfPid === cpid || !ctx.opponentStyle || ctx.opponentStyle === 'mirror') return base;
  const kind = action.type === 'build' ? 'build' : action.type === 'loan' ? 'loan' : action.type === 'network' ? 'network' : 'other';
  if (ctx.opponentStyle === 'conservative') return base - (kind === 'build' ? 25 : kind === 'loan' ? 15 : 0);
  if (ctx.opponentStyle === 'aggressive') return base + (kind === 'build' ? 20 : 0);
  return base;
}

/**
 * 动作预排序剪枝：先按 cheapActionScore 静态粗筛取前 topM 个，再对 topM 做精确（可带对手风格偏置）即时分降序取前 k 个。
 * 保留战术校准（煤开优先等），同时把"全候选 × applyAction"压到"topM × applyAction"，是 MCTS 可控算力的关键。
 */
function topKActions(
  state: GameState,
  cpid: PlayerId,
  roles: Record<PlayerId, Role>,
  k: number,
  topM = 14,
  ctx?: { selfPid: PlayerId; opponentStyle?: OpponentStyle },
): Action[] {
  const cheap = candidates(state, cpid, roles[cpid])
    .map((action) => ({ action, c: cheapActionScore(action) }))
    .sort((a, b) => b.c - a.c)
    .slice(0, topM);
  const scored: { action: Action; s: number }[] = [];
  for (const { action } of cheap) {
    const result = applyAction(state, action);
    if (!result.ok) continue;
    scored.push({ action, s: styleScore(state, result.state, cpid, action, roles[cpid], ctx) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => x.action);
}

/** 根动作提案：供时代 1 定锚 / 离线探针复用同一套粗筛+scoreAction 排序。 */
export function proposeRootActions(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  topK = 6,
  topM = 14,
): Action[] {
  return topKActions(state, pid, roles, topK, topM, { selfPid: pid, opponentStyle: 'mirror' });
}

/** 合法贷款动作（若有）。绕过 scoreAction 排序，供定锚强制评估贷开。 */
export function pickLoanAction(state: GameState, pid: PlayerId, style: Role): Action | null {
  for (const action of candidates(state, pid, style)) {
    if (action.type !== 'loan') continue;
    const prepared = prepare(state, action);
    if (prepared) return prepared;
  }
  return null;
}

/** MCTS 树节点：持有局面快照、该局面轮到谁的候选动作、已展开子节点与 UCT 统计。 */
interface MctsNode {
  action: Action | null;
  state: GameState;
  cpid: PlayerId; // 该局面当前行动玩家（决定该节点展开哪些子动作）
  untried: Action[];
  children: MctsNode[];
  visits: number;
  value: number;
}

function ucbScore(node: MctsNode, parentVisits: number, C: number): number {
  if (node.visits === 0) return Infinity;
  return node.value / node.visits + C * Math.sqrt(Math.log(parentVisits + 1) / node.visits);
}

/**
 * #25 确定化 MCTS（单世界）：对 pid 的当前局面做有限迭代模拟，返回最优根动作。
 * - 选择：UCT 沿树下钻（未展开节点返回给 expand），沿路径收集节点。
 * - 展开：从该节点 top-k 候选弹出一个动作，applyAction 生成子节点。
 * - 模拟：从叶子用 scoreAction top-k 贪心 rollout 若干步，用 evaluateState(pid) 评估回报。
 * - 回传：把回报沿路径加回，更新各节点 visits/value。
 * 根选择：子树平均 evaluateState（与叶子同尺）；展开策略仍用 scoreAction。
 * 注：这是决策器【独立实现】，不替换 chooseAiAction。
 */
export function mctsChooseSingle(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { iterations?: number; rolloutDepth?: number; exploreC?: number; topK?: number; topM?: number; opponentStyle?: OpponentStyle } = {},
): Action | null {
  const iterations = opts.iterations ?? 200;
  const rolloutDepth = opts.rolloutDepth ?? 6;
  const exploreC = opts.exploreC ?? 1.4;
  const topK = opts.topK ?? 6;
  const topM = opts.topM ?? 14;
  const ctx = { selfPid: pid, opponentStyle: opts.opponentStyle ?? ('mirror' as OpponentStyle) };

  const root: MctsNode = {
    action: null,
    state: clone(state),
    cpid: state.currentPlayerId,
    untried: topKActions(state, state.currentPlayerId, roles, topK, topM, ctx),
    children: [],
    visits: 0,
    value: 0,
  };

  for (let i = 0; i < iterations; i++) {
    // 1) 选择 + 收集路径
    const path: MctsNode[] = [root];
    let node = root;
    while (node.untried.length === 0 && node.children.length > 0) {
      node = node.children.reduce((best, c) => (ucbScore(c, node.visits, exploreC) > ucbScore(best, node.visits, exploreC) ? c : best));
      path.push(node);
    }
    // 2) 展开
    let expanded = node;
    if (node.untried.length > 0) {
      const action = node.untried.shift()!;
      const result = applyAction(node.state, action);
      if (result.ok) {
        const child: MctsNode = {
          action,
          state: result.state,
          cpid: result.state.currentPlayerId,
          untried: topKActions(result.state, result.state.currentPlayerId, roles, topK, topM, ctx),
          children: [],
          visits: 0,
          value: 0,
        };
        node.children.push(child);
        expanded = child;
        path.push(child);
      }
    }
    // 3) 模拟
    const value = mctsRollout(expanded.state, pid, roles, rolloutDepth, topK, topM, ctx);
    // 4) 回传
    for (const n of path) {
      n.visits += 1;
      n.value += value;
    }
  }

  // 根选择：只用子树平均 evaluateState（与叶子同尺）。战术由展开/rollout 的 scoreAction 策略体现，禁止异尺硬加。
  let best: MctsNode | null = null;
  let bs = -Infinity;
  for (const c of root.children) {
    if (c.visits === 0) continue;
    const total = c.value / c.visits;
    if (total > bs) {
      bs = total;
      best = c;
    }
  }
  return best?.action ?? null;
}

/**
 * #26 不完全信息采样（确定化多世界）：Brass 里真实隐藏信息 = 对手手牌与牌库顺序，
 * 但现引擎信息公开且确定（AI 能看 deck 顺序，是超人类信息优势）。这里让 AI 忽略已知 deck 顺序，
 * 用不同随机种子重洗牌库生成 worlds 个"可能世界"，各世界独立 MCTS 决策，多数投票聚合根动作，
 * 模拟人类"不知下一张抽什么"的信息劣势。worlds=1 时退化为单世界 MCTS。
 */
export function mctsChoose(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  opts: { worlds?: number; iterations?: number; rolloutDepth?: number; exploreC?: number; topK?: number; topM?: number; opponentStyle?: OpponentStyle } = {},
): Action | null {
  const worlds = opts.worlds ?? 1;
  if (worlds <= 1) return mctsChooseSingle(state, pid, roles, opts);
  const perWorld = Math.max(1, Math.floor((opts.iterations ?? 200) / worlds));
  const counts = new Map<string, { action: Action; n: number }>();
  for (let w = 0; w < worlds; w++) {
    const world = resampleWorld(state, w + 1);
    const action = mctsChooseSingle(world, pid, roles, { ...opts, iterations: perWorld });
    if (!action) continue;
    const key = JSON.stringify(action);
    const cur = counts.get(key) ?? { action, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  let best: { action: Action; n: number } | null = null;
  for (const cur of counts.values()) {
    if (!best || cur.n > best.n) best = cur;
  }
  return best?.action ?? null;
}

/** 用新随机种子重洗牌库，生成一个"牌库顺序未知"的可能世界（盘面/手牌不变）。 */
function resampleWorld(state: GameState, worldSeed: number): GameState {
  const s = clone(state);
  const shuffled = shuffle(s.deck, mulberry32(0x9e3779b9 + worldSeed * 0x85ebca6b));
  s.deck = shuffled.items;
  s.rng = shuffled.rng; // 后续抽牌沿新 rng 推进
  return s;
}

/**
 * MCTS rollout：从给定局面连续 rolloutDepth 步，每步当前玩家用 topKActions（cheap 粗筛 + scoreAction 精确 topM）
 * 贪心选动作并推进，返回最终 evaluateState(pid)。精确 rollout 保证质量（保留战术时序），
 * topM 粗筛把每步精确 applyAction 控制在 topM 次以内。
 */
function mctsRollout(
  state: GameState,
  pid: PlayerId,
  roles: Record<PlayerId, Role>,
  depth: number,
  topK: number,
  topM = 14,
  ctx?: { selfPid: PlayerId; opponentStyle?: OpponentStyle },
): number {
  let s = state;
  for (let i = 0; i < depth; i++) {
    if (s.over) return evaluateState(s, pid, roles[pid]);
    const cpid = s.currentPlayerId;
    const acts = topKActions(s, cpid, roles, topK, topM, ctx);
    if (acts.length === 0) return evaluateState(s, pid, roles[pid]);
    // topKActions 已按 scoreAction 降序，取第一个即一步贪心最优
    const result = applyAction(s, acts[0]);
    if (!result.ok) return evaluateState(s, pid, roles[pid]);
    s = result.state;
  }
  return evaluateState(s, pid, roles[pid]);
}


