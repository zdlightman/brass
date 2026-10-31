import { useEffect, useMemo, useRef, useState } from 'react';
import { applyAction, createGame, loadGame, saveGame } from '../engine';
import { assignRoles, chooseAiAction, mctsChoose, relockRoles, type Role } from '../ai/choose';
import { era1AnchorChoose } from '../ai/era1Anchor';
import { finalAnchorChoose } from '../ai/finalAnchor';
import { recordActionObs } from '../ai/observe';
import { clone } from '../engine/clone';
import { confirmPendingTurn, finishAction } from '../engine/turn';
import { oilCityFieldIds, slotAcceptsBuild, slotAcceptsUpgrade, slotNeedsDedicatedSpace } from '../engine/actions/build';
import { destLocationsFor, linkResourceCost } from '../engine/actions/network';
import { merchantsForSale, oilChoices, sellPreview } from '../engine/actions/sell';
import { mapData, tile } from '../engine/catalog';
import { looseFieldOil, oilCityBarrels } from '../engine/oil';
import { restartAfterOil, undoLastStep } from '../engine/turnHistory';
import { linkAdjacentToNetwork, locationsInNetwork, playerHasBoardPresence, railConnected } from '../engine/graph';
import { resolveSpend } from '../engine/resources';
import type {
  Action,
  Cube,
  CubeSource,
  GameState,
  HeavyTrainType,
  NetworkPlacement,
  OilSource,
  PipelineType,
  PlayerId,
} from '../engine/types';
import { Board } from './Board';
import { PlayerPanel, type ActionKind } from './PlayerPanel';
import { QualityTray } from './QualityTray';

type Tool =
  | { kind: 'lightTrain' }
  | { kind: 'heavyTrain'; heavyType: HeavyTrainType }
  | { kind: 'pipeline'; pipelineType: PipelineType; points?: number };

type TurnStep = { before: GameState; revealedOilfield: boolean; secondLink: boolean; unfinished: boolean };

type PickStep =
  | { kind: 'tile'; id: string }
  | { kind: 'slot'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'develop'; id: string }
  | { kind: 'good'; id: string }
  | { kind: 'merchant'; id: string }
  | { kind: 'oilfield'; id: string }
  | { kind: 'resource'; id: string };

const ROLE_KEY = 'brass-pittsburgh-ai-roles-v7';
const MODE_KEY = 'brass-pittsburgh-control-v7';
const BRAIN_KEY = 'brass-pittsburgh-ai-brain-v1';

type AiBrain = 'greedy' | 'mcts' | 'era1';

const AI_BRAINS: AiBrain[] = ['greedy', 'mcts', 'era1'];
const AI_BRAIN_LABEL: Record<AiBrain, string> = {
  greedy: '贪心',
  mcts: 'MCTS',
  era1: '定锚(慢)',
};

function loadHotseat(): boolean {
  return localStorage.getItem(MODE_KEY) === 'hotseat';
}

function storeHotseat(hotseat: boolean): void {
  localStorage.setItem(MODE_KEY, hotseat ? 'hotseat' : 'ai');
}

function loadAiBrain(): AiBrain {
  const raw = localStorage.getItem(BRAIN_KEY);
  if (raw === 'mcts' || raw === 'era1' || raw === 'greedy') return raw;
  return 'greedy';
}

function storeAiBrain(brain: AiBrain): void {
  localStorage.setItem(BRAIN_KEY, brain);
}

function nextAiBrain(brain: AiBrain): AiBrain {
  return AI_BRAINS[(AI_BRAINS.indexOf(brain) + 1) % AI_BRAINS.length]!;
}

function loadRoles(game: GameState): Record<PlayerId, Role> {
  try {
    const raw = localStorage.getItem(ROLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<PlayerId, Role>>;
      if (parsed[0] && parsed[1] && parsed[2] && parsed[3]) {
        return { 0: parsed[0], 1: parsed[1], 2: parsed[2], 3: parsed[3] };
      }
    }
  } catch {
    /* The saved roles are unreadable, so the opening hands decide them. */
  }
  return storeRoles(assignRoles(game));
}

function storeRoles(roles: Record<PlayerId, Role>): Record<PlayerId, Role> {
  localStorage.setItem(ROLE_KEY, JSON.stringify(roles));
  return roles;
}

function bootGame(): { game: GameState; roles: Record<PlayerId, Role> } {
  const loaded = loadGame();
  if (loaded) return { game: loaded, roles: loadRoles(loaded) };
  const game = createGame(randomSeed());
  return { game, roles: storeRoles(assignRoles(game)) };
}

const opening = bootGame();

function aiActor(game: GameState, hotseat: boolean): PlayerId | null {
  if (hotseat) return null;
  if (game.pendingOilDevelopPlayerId !== null) {
    return game.pendingOilDevelopPlayerId === 0 ? null : game.pendingOilDevelopPlayerId;
  }
  if (game.bonusSellPlayerId !== null) {
    return game.bonusSellPlayerId === 0 ? null : game.bonusSellPlayerId;
  }
  if (game.currentPlayerId === 0) return null;
  return game.currentPlayerId;
}

export function App() {
  const [state, setState] = useState<GameState>(opening.game);
  const [hotseat, setHotseat] = useState(loadHotseat);
  const [aiBrain, setAiBrain] = useState<AiBrain>(loadAiBrain);
  const [aiRoles, setAiRoles] = useState<Record<PlayerId, Role>>(opening.roles);
  const [thinking, setThinking] = useState(false);
  const [thinkDraft, setThinkDraft] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<NetworkPlacement[]>([]);
  const [tool, setTool] = useState<Tool>({ kind: 'lightTrain' });
  const [buildTileId, setBuildTileId] = useState<string | null>(null);
  const [developTiles, setDevelopTiles] = useState<string[]>([]);
  const [sellSlotIds, setSellSlotIds] = useState<string[]>([]);
  const [sellMerchantIds, setSellMerchantIds] = useState<string[]>([]);
  const [sellOil, setSellOil] = useState<Array<OilSource & { slotId: string }>>([]);
  const [sellWhiskeyStars, setSellWhiskeyStars] = useState(0);
  const [sellQualityId, setSellQualityId] = useState<string | null>(null);
  const [industryPicks, setIndustryPicks] = useState<CubeSource[]>([]);
  const [salePicks, setSalePicks] = useState<Array<{ marketId: string; slotIndex: number }>>([]);
  const [buildSlotId, setBuildSlotId] = useState<string | null>(null);
  const [buildOilfieldId, setBuildOilfieldId] = useState<string | null>(null);
  const [buildOilSource, setBuildOilSource] = useState<OilSource | null>(null);
  const [whiskeyWild, setWhiskeyWild] = useState(false);
  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [resourcePending, setResourcePending] = useState<Action | null>(null);
  const [steps, setSteps] = useState<PickStep[]>([]);
  const [secondLink, setSecondLink] = useState(false);
  const [history, setHistory] = useState<TurnStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveGame(state);
  }, [state]);

  const logSaved = useRef(false);
  useEffect(() => {
    if (!state.over) {
      logSaved.current = false;
      return;
    }
    if (logSaved.current) return;
    logSaved.current = true;
    const text = state.log.map((entry) => entry.text).join('\n');
    void fetch('/api/game-log', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
  }, [state.over, state.log]);

  const current = state.players[state.currentPlayerId];
  const spend = useMemo(() => {
    if ((actionKind === 'network' || secondLink) && draft[0]) {
      return { need: linkResourceCost(draft[0].kind), dest: destLocationsFor(draft[0]) };
    }
    if (actionKind === 'build' && buildTileId) {
      const built = tile(buildTileId);
      const need = { coal: built.cost.coal, iron: built.cost.iron, coke: built.cost.coke, steel: built.cost.steel };
      if (built.kind === 'oilCity') {
        if (!buildOilfieldId) return null;
        const dest = mapData.pipelineLines.filter((line) => line.oilfield === buildOilfieldId).map((line) => line.city);
        return { need, dest };
      }
      if (!buildSlotId) return null;
      const slot = state.slots.find((entry) => entry.id === buildSlotId);
      if (!slot) return null;
      return { need, dest: [slot.locationId] };
    }
    return null;
  }, [actionKind, secondLink, draft, buildTileId, buildSlotId, buildOilfieldId, state]);
  const choice = spend
    ? resolveSpend(state, state.currentPlayerId, spend.need, spend.dest, industryPicks)
    : null;
  const filledSources = choice?.ready ? choice.sources : null;
  // —— 资源消耗阶段（第二步）：动作目标与牌已在 resourcePending 里锁定，这里只算这次要付的资源和缺口。
  const resourceNeed = useMemo(() => {
    const action = resourcePending;
    if (!action) return null;
    if (action.type === 'build') {
      const built = tile(action.tileDefId);
      const need = { coal: built.cost.coal, iron: built.cost.iron, coke: built.cost.coke, steel: built.cost.steel };
      if (built.kind === 'oilCity') {
        const dest = action.oilfieldId
          ? mapData.pipelineLines.filter((line) => line.oilfield === action.oilfieldId).map((line) => line.city)
          : [];
        return { need, dest };
      }
      const slot = state.slots.find((entry) => entry.id === action.slotId);
      return { need, dest: slot ? [slot.locationId] : [] };
    }
    if (action.type === 'network') {
      const placement = draft[0];
      if (!placement) return null;
      return { need: linkResourceCost(placement.kind), dest: destLocationsFor(placement) };
    }
    if (action.type === 'develop') {
      const p = state.players[action.playerId];
      const free = Math.min(p.pendingFreeDevelops, action.tileDefIds.length);
      const paid = Math.max(0, action.tileDefIds.length - free);
      if (paid === 0) return null; // 免费研发不进资源阶段
      // 研发消耗铁或钢（每种研发 1 个），来源只要连到自己的路网即可。
      return { need: null, dest: [...locationsInNetwork(state, action.playerId)], developPaid: paid };
    }
    return null;
  }, [resourcePending, draft, state]);
  const isDevelopStep = resourceNeed?.need == null && resourceNeed?.developPaid != null;
  const developPicks = isDevelopStep
    ? industryPicks.filter((pick) => pick.kind === 'market' || pick.kind === 'industry' || pick.kind === 'heavyTrain' || pick.kind === 'vanderbilt')
    : [];
  const resourceChoice = resourceNeed && !isDevelopStep
    ? resolveSpend(state, state.currentPlayerId, resourceNeed.need!, resourceNeed.dest, industryPicks)
    : null;
  const resourceReady = isDevelopStep ? developPicks.length >= (resourceNeed?.developPaid ?? 0) : resourceChoice?.ready === true;
  const developResourceSlots = useMemo(() => {
    if (!isDevelopStep || !resourceNeed) return [];
    const dest = resourceNeed.dest;
    const out: string[] = [];
    for (const slot of state.slots) {
      if (!slot.tileDefId) continue;
      if ((slot.cubes.iron ?? 0) > 0 || (slot.cubes.steel ?? 0) > 0) {
        if (dest.some((d) => railConnected(state, slot.locationId, d))) out.push(slot.id);
      }
    }
    return out;
  }, [isDevelopStep, resourceNeed, state]);
  const CUBE_ZH: Record<Cube, string> = { coal: '煤', iron: '铁', coke: '焦炭', steel: '钢' };
  const resourceStep = useMemo(() => {
    if (!resourcePending) return null;
    const action = resourcePending;
    let label: string;
    let picked: string;
    let missing: string;
    if (isDevelopStep) {
      const paid = resourceNeed?.developPaid ?? 0;
      label = `研发：消耗 ${paid} 个铁/钢（点连到路网的铁/钢来源）`;
      picked = developPicks.length > 0 ? `已选 ${developPicks.length}/${paid}；` : `已选 0/${paid}；`;
      missing = developPicks.length < paid ? `还需 ${paid - developPicks.length} 个铁/钢（可用范德比尔特补齐）` : '铁/钢来源已够，可确认消耗。';
    } else {
      label =
        action.type === 'build'
          ? '建造：消耗资源（点版图建筑/市场/重车选来源，选满后确认）'
          : action.type === 'network'
            ? '连接：消耗资源（点钢/煤来源）'
            : '消耗资源';
      picked = industryPicks.length > 0 ? `已选 ${industryPicks.length} 个来源；` : '尚未选来源；';
      if (resourceChoice) {
        const open = resourceChoice.openPaidCubes;
        if (resourceChoice.ready) {
          missing =
            open.length > 0
              ? `已选齐（缺额 ${open.map((c) => CUBE_ZH[c]).join('、')} 将自动用最便宜市场/范德比尔特补齐），可确认。`
              : '资源来源已选齐，可确认消耗。';
        } else if (resourceChoice.nextIndustrySlotIds.length > 0) {
          missing = '先点版图上带免费资源的建筑（这些免费资源必须用掉）。';
        } else {
          missing = open.length > 0 ? `还差 ${open.map((c) => CUBE_ZH[c]).join('、')}` : '资源来源未齐。';
        }
      } else {
        missing = '';
      }
    }
    return { label, picked, missing, ready: resourceReady };
  }, [isDevelopStep, resourcePending, resourceChoice, resourceNeed, industryPicks, developPicks, resourceReady]);
  const developPaid =
    actionKind === 'develop'
      ? Math.max(0, developTiles.length - Math.min(current?.pendingFreeDevelops ?? 0, developTiles.length))
      : 0;
  const developReady = developPaid === 0 || industryPicks.length === 0 || industryPicks.length === developPaid;
  const sourcesReady = (!choice || choice.ready) && developReady;

  function clearPicks() {
    setSelectedCardId(null);
    setDraft([]);
    setBuildTileId(null);
    setDevelopTiles([]);
    setSellSlotIds([]);
    setSellMerchantIds([]);
    setSellOil([]);
    setSellWhiskeyStars(0);
    setSellQualityId(null);
    setBuildSlotId(null);
    setBuildOilfieldId(null);
    setBuildOilSource(null);
    setIndustryPicks([]);
    setSalePicks([]);
    setWhiskeyWild(false);
  }

  function noteStep(step: PickStep) {
    setSteps((current) => [...current, step]);
  }

  function dropStep(kind: PickStep['kind'], id: string) {
    setSteps((current) => {
      const index = current.findLastIndex((step) => step.kind === kind && step.id === id);
      if (index < 0) return current;
      return current.filter((_, entry) => entry !== index);
    });
  }

  function chooseAction(kind: ActionKind) {
    if (secondLink || state.pendingConfirm || state.pendingOilDevelopPlayerId !== null || state.eraScoreHeld) return;
    setActionKind((currentKind) => (currentKind === kind ? null : kind));
    setSteps([]);
    clearPicks();
    setError(null);
  }

  function undoStep() {
    const last = steps[steps.length - 1];
    if (!last) {
      undoCommitted();
      return;
    }
    if (resourcePending && last.kind !== 'resource') setResourcePending(null);
    setSteps((current) => current.slice(0, -1));
    if (last.kind === 'tile') setBuildTileId((id) => (id === last.id ? null : id));
    if (last.kind === 'slot') setBuildSlotId((id) => (id === last.id ? null : id));
    if (last.kind === 'line') setDraft((currentDraft) => currentDraft.filter((placement) => placement.lineId !== last.id));
    if (last.kind === 'develop') {
      setDevelopTiles((currentTiles) => {
        const index = currentTiles.lastIndexOf(last.id);
        if (index < 0) return currentTiles;
        return currentTiles.filter((_, entry) => entry !== index);
      });
    }
    if (last.kind === 'good') {
      setSellSlotIds((currentIds) => currentIds.filter((id) => id !== last.id));
      setSellOil([]);
      setSellQualityId(null);
    }
    if (last.kind === 'merchant') {
      setSellMerchantIds((currentIds) => currentIds.filter((id) => id !== last.id));
    }
    if (last.kind === 'oilfield') setBuildOilfieldId((id) => (id === last.id ? null : id));
    if (last.kind === 'resource') setIndustryPicks((currentPicks) => currentPicks.slice(0, -1));
    setError(null);
  }

  function restartAction() {
    setActionKind(null);
    setSecondLink(false);
    setResourcePending(null);
    setSteps([]);
    clearPicks();
    setError(null);
  }

  function remember(before: GameState, after: GameState, unfinished = false, duringSecond = false) {
    const revealedOilfield = after.oilfields.some(
      (field) => field.revealed && !before.oilfields.some((old) => old.id === field.id && old.revealed),
    );
    setHistory((current) => [
      ...current,
      { before, revealedOilfield, secondLink: duringSecond, unfinished },
    ]);
  }

  function undoCommitted() {
    const last = history[history.length - 1];
    if (!last) return;
    const decision = undoLastStep(last);
    if (decision.blocked) {
      setError('不能撤销');
      return;
    }
    setHistory((current) => current.slice(0, -1));
    setState(last.before);
    setSteps([]);
    clearPicks();
    setError(null);
    if (decision.secondLink) {
      setActionKind('network');
      setSecondLink(true);
    } else {
      setActionKind(null);
      setSecondLink(false);
    }
  }

  function restartTurn() {
    if (history.length === 0) {
      restartAction();
      return;
    }
    const { keep, askSecond } = restartAfterOil(history);
    let restore = history[0]!.before;
    if (keep > 0) {
      const revealed = history[keep - 1];
      restore = history[keep]?.before ?? (revealed ? clone(state) : restore);
    }
    setHistory((current) => current.slice(0, keep));
    setState(restore);
    setSteps([]);
    clearPicks();
    if (askSecond) {
      setActionKind('network');
      setSecondLink(true);
      setError('未知油田已经翻开，回到是否双修第二条连接。');
      return;
    }
    setActionKind(null);
    setSecondLink(false);
    setError(keep > 0 ? '未知油田已经翻开，回合退回到翻开之后。' : null);
  }

  function play(action: Action, holdTurn = false): boolean {
    const result = applyAction(state, action, { holdTurn, manualConfirm: true });
    if (!result.ok) {
      setError(result.error === 'Choose which merchants to sell to.' ? '点一个市场，选这次卖给谁。' : result.error);
      return false;
    }
    // 热座对局（人类 vs AI）同样记录行动者决策瞬间的自观，供对局记录导出与分析。
    recordActionObs(state, result.state, action.playerId, aiRoles[action.playerId], action.type);
    remember(state, result.state, holdTurn, action.type === 'network' && Boolean(action.secondLink) || (secondLink && (action.type === 'oilDevelop' || action.type === 'declineOilDevelop')));
    setError(null);
    clearPicks();
    setSteps([]);
    const keepSecondLink =
      (holdTurn && action.type === 'network') ||
      (secondLink &&
        (action.type === 'oilDevelop' || action.type === 'declineOilDevelop') &&
        result.state.actionsTaken === state.actionsTaken &&
        !result.state.pendingConfirm);
    if (keepSecondLink) {
      setSecondLink(true);
      setActionKind('network');
    } else {
      setSecondLink(false);
      setActionKind(null);
    }
    setState(result.state);
    return true;
  }

  // —— 两步交互：动作阶段（选目标+牌）与资源消耗阶段分开。
  // 点牌提交时先走到这里：build/develop/network 需要付费资源则进入资源阶段，其余直接执行。
  function proposeAction(action: Action, holdTurn = false) {
    if (needsResourceStep(action)) {
      setError(null);
      setResourcePending(action);
      return;
    }
    play(action, holdTurn);
  }

  function needsResourceStep(action: Action): boolean {
    if (action.type === 'build') {
      const built = tile(action.tileDefId);
      return built.cost.coal + built.cost.iron + built.cost.coke + built.cost.steel > 0;
    }
    if (action.type === 'develop') {
      const p = state.players[action.playerId];
      const free = Math.min(p.pendingFreeDevelops, action.tileDefIds.length);
      return action.tileDefIds.length - free > 0;
    }
    if (action.type === 'network') return true;
    return false;
  }

  // 资源阶段：确认消耗资源（缺口由 resolveSpend 自动用最便宜市场 / 范德比尔特补齐）。
  function confirmResource() {
    if (!resourcePending) return;
    const pending = resourcePending;
    if (isDevelopStep) {
      if (developPicks.length < (resourceNeed?.developPaid ?? 0) || pending.type !== 'develop') return;
      const ok = play({ ...pending, sources: developPicks.slice(0, resourceNeed!.developPaid!) }, false);
      if (ok) setResourcePending(null);
      return;
    }
    if (!resourceChoice?.ready) return;
    const sources = resourceChoice.sources;
    if (pending.type === 'build' || pending.type === 'develop') {
      const ok = play({ ...pending, sources }, false);
      if (ok) setResourcePending(null);
    } else if (pending.type === 'network') {
      const placement = draft[0];
      if (!placement) return;
      const ok = play({ ...pending, placements: [{ ...placement, sources }] }, true);
      if (ok) setResourcePending(null);
    }
  }

  function cancelResource() {
    setResourcePending(null);
    clearPicks();
    setError(null);
  }

  // 范德比尔特补齐：缺口一次全部用外部购买填上，然后可直接确认。
  function buyOutsideAll() {
    if (isDevelopStep) {
      const need = (resourceNeed?.developPaid ?? 0) - developPicks.length;
      for (let i = 0; i < need; i += 1) addResourcePick({ kind: 'vanderbilt', cube: 'iron' });
      return;
    }
    if (!resourceChoice) return;
    const open = resourceChoice.openPaidCubes;
    if (open.length === 0) return;
    for (const cube of open) addResourcePick({ kind: 'vanderbilt', cube });
  }

  function exportLog() {
    const text = state.log.map((entry) => entry.text).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `brass-log-${Date.now()}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function passSecond() {
    const next = clone(state);
    finishAction(next, true);
    remember(state, next, false, true);
    setSecondLink(false);
    setActionKind(null);
    setSteps([]);
    clearPicks();
    setError(null);
    setState(next);
  }

  function confirmSecond() {
    const placement = draft[0];
    if (!placement || !sourcesReady) return;
    play({
      type: 'network',
      playerId: state.currentPlayerId,
      cardId: '',
      placements: [{ ...placement, sources: filledSources ?? [] }],
      secondLink: true,
    });
  }

  function confirmTurn() {
    const next = clone(state);
    const draft = thinkDraft.trim();
    if (!hotseat && state.currentPlayerId === 0 && draft) {
      next.log.push({ text: `[think] P1 第${state.round}回合思路：${draft}` });
    }
    confirmPendingTurn(next);
    setThinkDraft('');
    setHistory([]);
    setSecondLink(false);
    setActionKind(null);
    setSteps([]);
    clearPicks();
    setError(null);
    setState(next);
  }

  function stepAi() {
    if (thinking || state.over || state.eraScoreHeld) return;
    if (!hotseat && state.pendingConfirm && state.currentPlayerId !== 0) {
      confirmTurn();
      return;
    }
    const actor = aiActor(state, hotseat);
    if (actor === null) return;
    setThinking(true);
    window.setTimeout(() => {
      try {
        // 流派重估：每回合动态——按当前手牌+已翻开货架算箱/油分差，差距拉开才定、接近保持经济流，随回合阈值递减（见 relockRoles）。
        const roles = storeRoles(relockRoles(state, aiRoles));
        setAiRoles(roles);
        // 默认贪心；MCTS 浅层长线；定锚：时代1→计分锚，时代2→终局 VP 锚（均很慢）。
        const action =
          aiBrain === 'mcts'
            ? mctsChoose(state, actor, roles, { iterations: 16, rolloutDepth: 2, topK: 4, topM: 8 }) ??
              chooseAiAction(state, actor, roles)
            : aiBrain === 'era1'
              ? (state.era === 2
                  ? finalAnchorChoose(state, actor, roles, { width: 3 })
                  : era1AnchorChoose(state, actor, roles, { width: 4 })) ??
                chooseAiAction(state, actor, roles)
              : chooseAiAction(state, actor, roles);
        if (!action) {
          setError(`P${actor + 1} 没有合法动作。`);
          return;
        }
        play(action, false);
      } finally {
        setThinking(false);
      }
    }, 0);
  }

  function selectTile(tileDefId: string) {
    if (actionKind === 'develop') {
      const copies =
        state.players[state.currentPlayerId]?.mat.filter((entry) => entry.defId === tileDefId && !entry.removed).length ?? 0;
      const chosen = developTiles.filter((id) => id === tileDefId).length;
      if (chosen < copies && developTiles.length < 2) {
        noteStep({ kind: 'develop', id: tileDefId });
        setDevelopTiles([...developTiles, tileDefId]);
      } else if (chosen > 0) {
        dropStep('develop', tileDefId);
        const index = developTiles.lastIndexOf(tileDefId);
        setDevelopTiles(developTiles.filter((_, entry) => entry !== index));
      } else if (developTiles[0]) {
        dropStep('develop', developTiles[0]);
        noteStep({ kind: 'develop', id: tileDefId });
        setDevelopTiles([...developTiles.slice(1), tileDefId]);
      }
      setBuildTileId(null);
      setError(null);
      return;
    }
    if (actionKind !== 'build') return;
    if (buildTileId === tileDefId) {
      dropStep('tile', tileDefId);
      setBuildTileId(null);
    } else {
      if (buildTileId) dropStep('tile', buildTileId);
      noteStep({ kind: 'tile', id: tileDefId });
      setBuildTileId(tileDefId);
      const slotStillFits =
        buildSlotId &&
        (slotAcceptsBuild(state, tileDefId, buildSlotId, state.currentPlayerId) ||
          slotAcceptsUpgrade(state, tileDefId, buildSlotId, state.currentPlayerId));
      if (buildSlotId && !slotStillFits) {
        dropStep('slot', buildSlotId);
        setBuildSlotId(null);
      }
      setBuildOilSource(null);
    }
    setDevelopTiles([]);
    setIndustryPicks([]);
    setSalePicks([]);
    setError(null);
  }

  function sellingNow() {
    return (
      actionKind === 'sell' ||
      (state.bonusSellPlayerId !== null && state.bonusSellPlayerId === state.currentPlayerId)
    );
  }

  function addResourcePick(source: CubeSource) {
    noteStep({ kind: 'resource', id: `${source.kind}-${industryPicks.length}` });
    setIndustryPicks((currentPicks) => [...currentPicks, source]);
    setError(null);
  }

  function clickOilfield(oilfieldId: string) {
    if (resourcePending) return;
    if (state.over || actionKind !== 'build' || !buildTileId || tile(buildTileId).kind !== 'oilCity') return;
    if (!oilCityFieldIds(state, state.currentPlayerId).includes(oilfieldId)) {
      setError('石油城要造在你已经用管道连上的油田上。');
      return;
    }
    setError(null);
    if (buildOilfieldId === oilfieldId) {
      dropStep('oilfield', oilfieldId);
      setBuildOilfieldId(null);
      return;
    }
    if (buildOilfieldId) dropStep('oilfield', buildOilfieldId);
    noteStep({ kind: 'oilfield', id: oilfieldId });
    setBuildOilfieldId(oilfieldId);
    setIndustryPicks([]);
  }

  function clickMarket(marketId: string, cube: Cube) {
    // —— 资源消耗阶段：市场只作选资源来源。
    if (resourcePending) {
      if (isDevelopStep && (cube === 'iron' || cube === 'steel') && resourceNeed) {
        if (developPicks.length >= (resourceNeed.developPaid ?? 0)) return;
        const def = mapData.markets.find((entry) => entry.id === marketId);
        if (!def || !def.cubes.includes(cube)) return;
        if (!resourceNeed.dest.some((dest) => railConnected(state, def.locationId, dest))) {
          setError('这个市场没有连到你的路网。');
          return;
        }
        const already = industryPicks.filter(
          (pick) => pick.kind === 'market' && pick.marketId === marketId && pick.cube === cube,
        ).length;
        const have = state.markets.find((entry) => entry.id === marketId)?.slots.filter((slot) => slot.cube === cube).length ?? 0;
        if (already >= have) {
          setError('这个市场里这种资源已经选完了。');
          return;
        }
        addResourcePick({ kind: 'market', marketId, cube });
        return;
      }
      if (resourceChoice?.openPaidCubes.includes(cube) && resourceNeed) {
        const def = mapData.markets.find((entry) => entry.id === marketId);
        if (!def || !def.cubes.includes(cube)) return;
        if (!resourceNeed.dest.some((dest) => railConnected(state, def.locationId, dest))) {
          setError('这个市场没有连到这次要付资源的地方。');
          return;
        }
        const already = industryPicks.filter(
          (pick) => pick.kind === 'market' && pick.marketId === marketId && pick.cube === cube,
        ).length;
        const have = state.markets.find((entry) => entry.id === marketId)?.slots.filter((slot) => slot.cube === cube).length ?? 0;
        if (already >= have) {
          setError('这个市场里这种资源已经选完了。');
          return;
        }
        const legal = resolveSpend(state, state.currentPlayerId, resourceNeed.need!, resourceNeed.dest, [
          ...industryPicks,
          { kind: 'market', marketId, cube },
        ]);
        if (!legal.sources.some((source) => source.kind === 'market' && source.marketId === marketId && source.cube === cube)) {
          setError('这个市场没有连到这次要付资源的地方。');
          return;
        }
        addResourcePick({ kind: 'market', marketId, cube });
      }
      return;
    }
    if (actionKind === 'develop' && (cube === 'iron' || cube === 'steel')) {
      if (industryPicks.length >= developPaid) return;
      const def = mapData.markets.find((entry) => entry.id === marketId);
      const network = locationsInNetwork(state, state.currentPlayerId);
      if (!def || ![...network].some((place) => railConnected(state, def.locationId, place))) {
        setError('这个市场没有连到你的路网。');
        return;
      }
      addResourcePick({ kind: 'market', marketId, cube });
      return;
    }
    if (!choice || state.over) return;
    if (choice.nextIndustrySlotIds.length > 0) {
      setError('先点版图上还有免费资源的建筑。免费资源必须用掉。');
      return;
    }
    if (!choice.openPaidCubes.includes(cube)) return;
    const def = mapData.markets.find((entry) => entry.id === marketId);
    if (!def || !spend || !def.cubes.includes(cube)) return;
    if (!spend.dest.some((dest) => railConnected(state, def.locationId, dest))) {
      setError('这个市场没有连到这次要付资源的地方。');
      return;
    }
    const already = industryPicks.filter((pick) => pick.kind === 'market' && pick.marketId === marketId && pick.cube === cube).length;
    const have = state.markets.find((entry) => entry.id === marketId)?.slots.filter((slot) => slot.cube === cube).length ?? 0;
    if (already >= have) {
      setError('这个市场里这种资源已经选完了。');
      return;
    }
    const legal = resolveSpend(state, state.currentPlayerId, spend.need, spend.dest, [
      ...industryPicks,
      { kind: 'market', marketId, cube },
    ]);
    if (!legal.sources.some((source) => source.kind === 'market' && source.marketId === marketId && source.cube === cube)) {
      setError('这个市场没有连到这次要付资源的地方。');
      return;
    }
    addResourcePick({ kind: 'market', marketId, cube });
  }

  function clickSlot(slotId: string) {
    if (state.over || !current) return;
    // —— 资源消耗阶段：点击版图产业只当作"选资源来源"，绝不再当作建造/研发槽位。
    if (resourcePending) {
      if (isDevelopStep && resourceNeed) {
        if (developPicks.length >= (resourceNeed.developPaid ?? 0)) return;
        const built = state.slots.find((entry) => entry.id === slotId);
        const cube = built
          ? (built.cubes.iron ?? 0) > 0 ? 'iron' : (built.cubes.steel ?? 0) > 0 ? 'steel' : null
          : null;
        if (built && cube) {
          if (!resourceNeed.dest.some((dest) => railConnected(state, built.locationId, dest))) return;
          const already = industryPicks.filter(
            (pick) => pick.kind === 'industry' && pick.slotId === slotId && pick.cube === cube,
          ).length;
          if ((built.cubes[cube] ?? 0) > already) addResourcePick({ kind: 'industry', slotId, cube });
        }
        return;
      }
      if (resourceChoice?.nextIndustrySlotIds.includes(slotId)) {
        addResourcePick({ kind: 'industry', slotId });
      }
      return;
    }
    if (actionKind === 'develop' && industryPicks.length < developPaid) {
      const built = state.slots.find((entry) => entry.id === slotId);
      const cube = (built?.cubes.iron ?? 0) > 0 ? 'iron' : (built?.cubes.steel ?? 0) > 0 ? 'steel' : null;
      if (built && cube) {
        addResourcePick({ kind: 'industry', slotId, cube });
        return;
      }
    }
    if (choice?.nextIndustrySlotIds.includes(slotId)) {
      addResourcePick({ kind: 'industry', slotId });
      return;
    }
    if (sellingNow()) {
      const occupied = state.slots.find((slot) => slot.id === slotId);
      if (occupied?.tileDefId && occupied.owner === state.currentPlayerId && !occupied.flipped) {
        const built = tile(occupied.tileDefId);
        if (built.sellable) {
          setSellSlotIds((currentIds) => {
            if (currentIds.includes(slotId)) {
              dropStep('good', slotId);
              return currentIds.filter((id) => id !== slotId);
            }
            noteStep({ kind: 'good', id: slotId });
            return [...currentIds, slotId];
          });
          setSellOil([]);
          setSellQualityId(null);
          setError(null);
        }
      }
      return;
    }
    if (actionKind !== 'build') return;
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot) return;
    if (slot.tileDefId) {
      if (buildTileId && slotAcceptsUpgrade(state, buildTileId, slotId, state.currentPlayerId)) {
        setError(null);
        if (buildSlotId && buildSlotId !== slotId) dropStep('slot', buildSlotId);
        if (buildSlotId !== slotId) noteStep({ kind: 'slot', id: slotId });
        setBuildSlotId(buildSlotId === slotId ? null : slotId);
        if (buildSlotId === slotId) dropStep('slot', slotId);
        setBuildOilSource(null);
        setIndustryPicks([]);
        setSalePicks([]);
        return;
      }
      if (buildTileId && tile(buildTileId).upgradeFrom) {
        setError('只能盖在开工时已经翻面的对应产业上。这座还没翻面，或者类型不对。');
      }
      return;
    }
    if (buildTileId && tile(buildTileId).upgradeFrom) {
      setError('这块产业只能盖在开工时已经翻面的对应建筑上，不能放进空位。');
      return;
    }
    if (buildTileId && !slotAcceptsBuild(state, buildTileId, slotId, state.currentPlayerId)) {
      const ownIndustry =
        state.era === 1 &&
        state.slots.some(
          (entry) => entry.locationId === slot.locationId && entry.owner === state.currentPlayerId && entry.tileDefId,
        );
      setError(
        ownIndustry
          ? '第一纪元同一玩家在一座城市只能有一座建筑。'
          : slotNeedsDedicatedSpace(state, buildTileId, slotId)
            ? '这座城里还有专用空位，要先造在那里。'
            : '这个空位不能造这块产业。地点牌可以造这座城里对得上的空位，不用接到自己的路网。',
      );
      return;
    }
    setError(null);
    if (buildSlotId === slotId) {
      dropStep('slot', slotId);
      setBuildSlotId(null);
    } else {
      if (buildSlotId) dropStep('slot', buildSlotId);
      noteStep({ kind: 'slot', id: slotId });
      setBuildSlotId(slotId);
    }
    setBuildOilSource(null);
    setIndustryPicks([]);
    setSalePicks([]);
  }

  const legalSlotIds = useMemo(() => {
    if (actionKind !== 'build' || state.over) return [];
    return state.slots
      .filter((slot) => {
        if (!buildTileId) return !slot.tileDefId;
        if (tile(buildTileId).upgradeFrom) {
          return slotAcceptsUpgrade(state, buildTileId, slot.id, state.currentPlayerId);
        }
        return !slot.tileDefId && slotAcceptsBuild(state, buildTileId, slot.id, state.currentPlayerId);
      })
      .map((slot) => slot.id);
  }, [state, actionKind, buildTileId]);

  function clickLine(lineId: string) {
    if (sellingNow()) {
      assignPipelineOil(lineId);
      return;
    }
    // —— 资源消耗阶段：点击自己的重车只作选重车储备资源来源。
    if (resourcePending) {
      if (isDevelopStep && resourceNeed) {
        if (developPicks.length >= (resourceNeed.developPaid ?? 0)) return;
        const link = state.links.find((entry) => entry.lineId === lineId && entry.owner === state.currentPlayerId);
        const cube = link ? (link.cubes.iron ?? 0) > 0 ? 'iron' : (link.cubes.steel ?? 0) > 0 ? 'steel' : null : null;
        if (link && cube) {
          const already = industryPicks.filter(
            (pick) => pick.kind === 'heavyTrain' && pick.linkId === link.id && pick.cube === cube,
          ).length;
          if ((link.cubes[cube] ?? 0) > already) addResourcePick({ kind: 'heavyTrain', linkId: link.id, cube });
        }
        return;
      }
      if (resourceChoice && resourceNeed) {
        const link = state.links.find((entry) => entry.lineId === lineId && entry.owner === state.currentPlayerId);
        const cube = link ? resourceChoice.openPaidCubes.find((kind) => (link.cubes[kind] ?? 0) > 0) : undefined;
        if (link && cube) {
          const already = industryPicks.filter(
            (pick) => pick.kind === 'heavyTrain' && pick.linkId === link.id && pick.cube === cube,
          ).length;
          if ((link.cubes[cube] ?? 0) > already) {
            const legal = resolveSpend(state, state.currentPlayerId, resourceNeed.need!, resourceNeed.dest, [
              ...industryPicks,
              { kind: 'heavyTrain', linkId: link.id, cube },
            ]);
            if (legal.sources.some((source) => source.kind === 'heavyTrain' && source.linkId === link.id)) {
              addResourcePick({ kind: 'heavyTrain', linkId: link.id, cube });
            }
          }
        }
      }
      return;
    }
    if (choice && spend && choice.nextIndustrySlotIds.length === 0) {
      const link = state.links.find((entry) => entry.lineId === lineId && entry.owner === state.currentPlayerId);
      const cube = link ? choice.openPaidCubes.find((kind) => (link.cubes[kind] ?? 0) > 0) : undefined;
      if (link && cube) {
        const already = industryPicks.filter((pick) => pick.kind === 'heavyTrain' && pick.linkId === link.id && pick.cube === cube).length;
        if ((link.cubes[cube] ?? 0) <= already) return;
        const legal = resolveSpend(state, state.currentPlayerId, spend.need, spend.dest, [
          ...industryPicks,
          { kind: 'heavyTrain', linkId: link.id, cube },
        ]);
        if (legal.sources.some((source) => source.kind === 'heavyTrain' && source.linkId === link.id)) {
          addResourcePick({ kind: 'heavyTrain', linkId: link.id, cube });
          return;
        }
      }
    }
    if (actionKind === 'build' && !state.over && buildTileId && (tile(buildTileId).cost.oil ?? 0) > 0) {
      assignBuildOil(lineId);
      return;
    }
    if (actionKind !== 'network' || state.over) return;
    const pipelineLine = lineId.startsWith('p-');
    if (pipelineLine && tool.kind !== 'pipeline') return;
    if (!pipelineLine && tool.kind === 'pipeline') return;
    const kind = pipelineLine ? 'pipeline' : 'rail';
    if (
      playerHasBoardPresence(state, state.currentPlayerId) &&
      !linkAdjacentToNetwork(state, state.currentPlayerId, lineId, kind)
    ) {
      setError('这条连接没有接到你的路网。你自己管道所在的油田可以作为下一条管道的起点。');
      return;
    }
    setError(null);
    let replaceLinkId: string | undefined;
    if (tool.kind === 'heavyTrain' && tool.heavyType === 'replacement') {
      const target = state.links.find(
        (entry) => entry.lineId === lineId && entry.kind === 'lightTrain' && entry.owner !== state.currentPlayerId,
      );
      if (!target) {
        setError('这条线路上没有可以替换的对手轻车。');
        return;
      }
      replaceLinkId = target.id;
    }
    setDraft((currentDraft) => {
      if (currentDraft.some((placement) => placement.lineId === lineId)) {
        dropStep('line', lineId);
        return [];
      }
      if (currentDraft[0]) dropStep('line', currentDraft[0].lineId);
      noteStep({ kind: 'line', id: lineId });
      const placement: NetworkPlacement = pipelineLine
        ? {
            lineId,
            kind: 'pipeline',
            pipelineType: tool.kind === 'pipeline' ? tool.pipelineType : undefined,
            points: tool.kind === 'pipeline' ? tool.points : undefined,
            sources: [],
          }
        : {
            lineId,
            kind: tool.kind === 'heavyTrain' ? 'heavyTrain' : 'lightTrain',
            heavyType: tool.kind === 'heavyTrain' ? tool.heavyType : undefined,
            replaceLinkId,
            sources: [],
          };
      return [placement];
    });
    setIndustryPicks([]);
  }

  function assignBuildOil(lineId: string) {
    if (!buildTileId || !(tile(buildTileId).cost.oil ?? 0)) return;
    const slot = state.slots.find((entry) => entry.id === buildSlotId);
    if (!slot) {
      setError('先选定建造的位置，再点运送石油的管道。');
      return;
    }
    const links = state.links.filter((entry) => entry.lineId === lineId);
    if (links.length === 0) {
      setError('这条管道还没有铺设，不能运送石油。');
      return;
    }
    const match = oilChoices(state, state.currentPlayerId, [slot.locationId]).find((source) =>
      links.some(
        (link) =>
          (source.kind === 'heavyTrain' && source.linkId === link.id) ||
          (source.kind !== 'heavyTrain' && source.pipelineLinkId === link.id),
      ),
    );
    if (!match) {
      setError('这条管道接不到建造地点的油。');
      return;
    }
    setBuildOilSource(match);
    setError(null);
  }

  function assignPipelineOil(lineId: string) {
    const link = state.links.find((entry) => entry.lineId === lineId);
    if (!link || (link.kind !== 'pipeline' && link.heavyType !== 'oilResource')) {
      setError('点已经铺好、而且还有油的管道，或你自己的油重车。');
      return;
    }
    const slotId = sellSlotIds.find((id) => {
      const built = state.slots.find((entry) => entry.id === id);
      const need = built?.tileDefId ? tile(built.tileDefId).oilToSell : 0;
      return sellOil.filter((source) => source.slotId === id).length < need;
    });
    if (!slotId) {
      setError('先点要出售的未翻面货物。一件货物的石油选满后，再点下一件。');
      return;
    }
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot) return;
    const match = oilChoices(state, state.currentPlayerId, [slot.locationId]).find((source) => {
      const same =
        source.kind === 'heavyTrain' ? source.linkId === link.id : source.pipelineLinkId === link.id;
      return same && oilLeft(source) > 0;
    });
    if (!match) {
      setError('这条管道没有把石油连到这件货物。');
      return;
    }
    setSellOil((current) => [...current, { ...match, slotId }]);
    setError(null);
  }

  function oilLeft(source: { kind: string; oilfieldId?: string; linkId?: string }): number {
    const used = sellOil.filter((pick) => {
      if (source.kind === 'heavyTrain') return pick.kind === 'heavyTrain' && pick.linkId === source.linkId;
      return pick.kind !== 'heavyTrain' && pick.kind === source.kind && pick.oilfieldId === source.oilfieldId;
    }).length;
    if (source.kind === 'heavyTrain') {
      const train = state.links.find((entry) => entry.id === source.linkId);
      return (train?.cubes.oil ?? 0) - used;
    }
    const field = state.oilfields.find((entry) => entry.id === source.oilfieldId);
    if (!field) return 0;
    const have = source.kind === 'oilCity' ? oilCityBarrels(field) : looseFieldOil(field);
    return have - used;
  }

  function clickMerchant(locationId: string) {
    if (!sellingNow() || state.over) return;
    const merchant = state.merchants.find((entry) => entry.locationId === locationId);
    if (!merchant || state.over) return;
    if (!sellMerchantIds.includes(locationId)) {
      const fits = sellSlotIds.some((slotId) => {
        const slot = state.slots.find((entry) => entry.id === slotId);
        if (!slot?.tileDefId) return false;
        return merchantsForSale(state, slot.locationId, tile(slot.tileDefId).kind).some(
          (option) => option.locationId === locationId,
        );
      });
      if (!fits) {
        setError('这个市场不收这件货物。牌子上画的是箱、煤油或汽车。15 块的金面收箱和煤油，翻成红面只收汽车。');
        return;
      }
    }
    setSellMerchantIds((currentIds) => {
      const coversAll = sellSlotIds.every((slotId) => {
        const slot = state.slots.find((entry) => entry.id === slotId);
        if (!slot?.tileDefId) return false;
        return merchantsForSale(state, slot.locationId, tile(slot.tileDefId).kind).some(
          (option) => option.locationId === locationId,
        );
      });
      if (coversAll) {
        if (currentIds.length === 1 && currentIds[0] === locationId) {
          dropStep('merchant', locationId);
          return [];
        }
        for (const id of currentIds) dropStep('merchant', id);
        noteStep({ kind: 'merchant', id: locationId });
        return [locationId];
      }
      if (currentIds.includes(locationId)) {
        dropStep('merchant', locationId);
        return currentIds.filter((id) => id !== locationId);
      }
      noteStep({ kind: 'merchant', id: locationId });
      return [...currentIds, locationId];
    });
    setError(null);
  }

  function beginGame(nextHotseat: boolean) {
    const next = createGame(randomSeed());
    storeHotseat(nextHotseat);
    setHotseat(nextHotseat);
    setAiRoles(storeRoles(assignRoles(next)));
    setSelectedCardId(null);
    setDraft([]);
    setBuildTileId(null);
    setDevelopTiles([]);
    setBuildSlotId(null);
    setBuildOilfieldId(null);
    setBuildOilSource(null);
    setSellSlotIds([]);
    setSellMerchantIds([]);
    setSellOil([]);
    setSellWhiskeyStars(0);
    setSellQualityId(null);
    setIndustryPicks([]);
    setSalePicks([]);
    setWhiskeyWild(false);
    setActionKind(null);
    setSteps([]);
    setSecondLink(false);
    setHistory([]);
    setError(null);
    setTool({ kind: 'lightTrain' });
    setState(next);
  }

  const actor = aiActor(state, hotseat);
  const aiConfirm = !hotseat && state.pendingConfirm && state.currentPlayerId !== 0;
  const stepDisabled = thinking || state.over || state.eraScoreHeld || (actor === null && !aiConfirm);
  const stepText = thinking
    ? '正在思考'
    : state.over || state.eraScoreHeld
      ? '本局已停'
      : aiConfirm
        ? `确认 P${state.currentPlayerId + 1}`
        : actor === null
          ? '轮到 P1'
          : `步进 P${actor + 1}`;

  function seat(id: PlayerId) {
    return (
          <PlayerPanel
            key={id}
            state={state}
            playerId={id}
            interactive={hotseat || id === 0}
            selectedCardId={state.currentPlayerId === id ? selectedCardId : null}
            onSelectCard={(cardId) => {
              if (!actionKind) return;
              setSelectedCardId(cardId);
              if (actionKind === 'build') {
                setBuildSlotId(null);
                setBuildOilfieldId(null);
                setBuildOilSource(null);
                setIndustryPicks([]);
                setSalePicks([]);
              }
              setError(null);
            }}
            onAction={(action) => proposeAction(action, action.type === 'network' && !action.secondLink)}
            resourceStep={resourceStep}
            onConfirmResource={confirmResource}
            onCancelResource={cancelResource}
            onBuyOutsideAll={buyOutsideAll}
            actionKind={state.currentPlayerId === id ? actionKind : null}
            onChooseAction={chooseAction}
            notice={state.currentPlayerId === id ? error : null}
            onUndo={undoStep}
            onRestart={restartTurn}
            secondLink={state.currentPlayerId === id && secondLink}
            onPassSecond={passSecond}
            onConfirmSecond={confirmSecond}
            onConfirmTurn={confirmTurn}
            linkChoices={state.currentPlayerId === id ? linkChoices(current, tool) : []}
            onPickLink={(choiceId) => {
              const next = availableTools(current).find((choice) => toolKey(choice) === choiceId);
              if (next) setTool(next);
            }}
            networkDraft={
              state.currentPlayerId === id
                ? draft.map((placement) => ({ ...placement, sources: filledSources ?? [] }))
                : []
            }
            resourceHint={
              !resourcePending && state.currentPlayerId === id && choice?.nextIndustrySlotIds.length
                ? '点版图上还有免费资源的建筑。免费的必须用。'
                : !resourcePending &&
                    state.currentPlayerId === id &&
                    ((choice && choice.openPaidCubes.length > 0) || (actionKind === 'develop' && developPaid > industryPicks.length))
                  ? '付费资源可以点更贵的市场、自己的重车，或外部购买。不点就用最便宜的，市场不够就用外部。'
                  : undefined
            }
            onBuyOutside={
              !resourcePending && state.currentPlayerId === id && choice && choice.openPaidCubes[0] && spend
                ? () => addResourcePick({ kind: 'vanderbilt', cube: choice.openPaidCubes[0] })
                : !resourcePending && state.currentPlayerId === id && actionKind === 'develop' && developPaid > industryPicks.length
                  ? () => addResourcePick({ kind: 'vanderbilt', cube: 'iron' })
                  : undefined
            }
            sourcesReady={state.currentPlayerId !== id || sourcesReady}
            buildTileId={state.currentPlayerId === id ? buildTileId : null}
            whiskeyWild={whiskeyWild}
            onWhiskeyWild={setWhiskeyWild}
            buildSlotId={buildSlotId}
            buildOilfieldId={buildOilfieldId}
            buildOilSource={state.currentPlayerId === id ? buildOilSource : null}
            onSelectTile={selectTile}
            developTileIds={state.currentPlayerId === id ? developTiles : []}
            sellSlotIds={state.currentPlayerId === id ? sellSlotIds : []}
            sellMerchantIds={state.currentPlayerId === id ? sellMerchantIds : []}
            sellOil={state.currentPlayerId === id ? sellOil : []}
            sellWhiskeyStars={state.currentPlayerId === id ? sellWhiskeyStars : 0}
            sellQualityId={state.currentPlayerId === id ? sellQualityId : null}
            onSellWhiskey={setSellWhiskeyStars}
            onSellQuality={setSellQualityId}
            onSellMerchant={state.currentPlayerId === id ? clickMerchant : undefined}
            sellHint={
              state.currentPlayerId === id
                ? sellPreview(state, id, sellSlotIds, sellMerchantIds, sellOil, sellWhiskeyStars)
                : undefined
            }
            buildSources={
              state.currentPlayerId === id && actionKind === 'build' && filledSources ? filledSources : []
            }
            developSources={
              state.currentPlayerId === id && developPaid > 0 && industryPicks.length === developPaid
                ? industryPicks
                : []
            }
            sales={state.currentPlayerId === id ? salePicks : []}
          />
    );
  }


  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Brass: Pittsburgh</h1>
          <p>
            {hotseat ? '热座一控四' : 'P1 对三位 AI'} · Era {state.era} · Round {state.round} · Action{' '}
            {Math.min(state.actionsTaken + 1, state.actionsAllowed)}/{state.actionsAllowed}
            {current ? ` · ${current.name}` : ''}
          </p>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => beginGame(false)}>
            New game
          </button>
          <button type="button" onClick={() => beginGame(true)}>
            New game: hotseat
          </button>
          {!hotseat ? (
            <button
              type="button"
              title="贪心=快基线；MCTS=浅层长线；定锚=时代1计分/时代2终局（很慢）"
              onClick={() => {
                const next = nextAiBrain(aiBrain);
                storeAiBrain(next);
                setAiBrain(next);
              }}
            >
              AI: {AI_BRAIN_LABEL[aiBrain]}
            </button>
          ) : null}
        </div>
      </header>
      {state.eraScoreHeld ? (
        <p className="muted">一时代已经计分，一级产业和轻轨还没有移除。这一局停在这里，用来核对分数。</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      <QualityTray rewards={state.qualityRewards} />
      <div className="table">
      <Board
        markets={state.markets}
        merchants={state.merchants}
        links={state.links}
        slots={state.slots}
        players={state.players.map((player) => ({ id: player.id, color: player.color }))}
        selectedLineIds={draft.map((placement) => placement.lineId)}
        legalSlotIds={legalSlotIds}
        selectedSlotId={buildSlotId}
        sellSlotIds={sellSlotIds}
        sellMerchantIds={sellMerchantIds}
        sellChoiceIds={sellingNow() ? sellChoiceIds(state, sellSlotIds) : []}
        oilfields={state.oilfields}
        resourceSlotIds={(resourcePending ? (isDevelopStep ? developResourceSlots : resourceChoice?.nextIndustrySlotIds) : choice?.nextIndustrySlotIds) ?? []}
        selectableOilfieldIds={
          actionKind === 'build' && buildTileId && tile(buildTileId).kind === 'oilCity'
            ? oilCityFieldIds(state, state.currentPlayerId)
            : []
        }
        selectedOilfieldId={buildOilfieldId}
        onLine={clickLine}
        onMerchant={clickMerchant}
        onSlot={clickSlot}
        onOilfield={clickOilfield}
        onMarket={clickMarket}
      />
      <div className="side">
        <div className="seats seats-lead">{seat(0)}</div>
        <div className="ai-step">
          {hotseat ? null : (
            <button type="button" onClick={stepAi} disabled={stepDisabled}>
              {stepText}
            </button>
          )}
          {history.length > 0 ? (
            <button type="button" className="action-undo" onClick={undoStep}>
              撤销上一步
            </button>
          ) : null}
          <button type="button" className="action-undo" onClick={exportLog}>
            导出对局记录
          </button>
          {!hotseat && state.currentPlayerId === 0 && state.pendingConfirm ? (
            <div className="think-box">
              <textarea
                value={thinkDraft}
                onChange={(event) => setThinkDraft(event.target.value)}
                rows={3}
                placeholder="记录本回合思路，确认回合时写入日志，供 AI 学习分析"
                style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', marginTop: 6 }}
              />
            </div>
          ) : null}
          <ol className="log log-recent">
            {state.log.slice(-2).map((entry, index) => (
              <li key={`${entry.text}-${index}`}>{entry.text}</li>
            ))}
          </ol>
        </div>
      </div>
      <div className="seats">{([1, 2, 3] as PlayerId[]).map((id) => seat(id))}</div>
      </div>
      <ol className="log">
        {[...state.log].reverse().slice(0, 12).map((entry, i) => (
          <li key={`${entry.text}-${i}`}>{entry.text}</li>
        ))}
      </ol>
    </div>
  );
}

function toolKey(tool: Tool): string {
  if (tool.kind === 'lightTrain') return 'light';
  if (tool.kind === 'heavyTrain') return `heavy:${tool.heavyType}`;
  if (tool.kind === 'pipeline') {
    // vp 管道按分数区分，避免 4/7/3 分管道折叠成同一个工具。
    return `pipe:${tool.pipelineType}${tool.points ? `:${tool.points}` : ''}`;
  }
  return 'light';
}

const LINK_LABEL: Record<string, { label: string; token: string }> = {
  light: { label: '轻车', token: 'light' },
  'heavy:whiskey': { label: '威士忌重车', token: 'whiskey' },
  'heavy:cokeResource': { label: '焦炭重车', token: 'coke' },
  'heavy:steelResource': { label: '钢铁重车', token: 'steel' },
  'heavy:oilResource': { label: '油重车', token: 'oil' },
  'heavy:doubleLink': { label: '双连重车', token: 'score' },
  'heavy:replacement': { label: '替换重车', token: 'swap' },
  'pipe:income': { label: '收益管道', token: 'income2' },
  'pipe:money': { label: '金钱管道', token: 'money10' },
  'pipe:vp': { label: '分数管道', token: 'points3' },
  'pipe:reserve': { label: '储备管道', token: 'broken' },
};

function sellChoiceIds(state: GameState, slotIds: string[]): string[] {
  const ids = new Set<string>();
  for (const slotId of slotIds) {
    const slot = state.slots.find((entry) => entry.id === slotId);
    if (!slot?.tileDefId) continue;
    for (const merchant of merchantsForSale(state, slot.locationId, tile(slot.tileDefId).kind)) {
      ids.add(merchant.locationId);
    }
  }
  return [...ids];
}

function linkChoices(
  player: GameState['players'][number] | undefined,
  selected: Tool,
): { id: string; label: string; token: string; selected: boolean }[] {
  return availableTools(player).map((choice) => {
    const id = toolKey(choice);
    const named = LINK_LABEL[id] ?? { label: id, token: 'light' };
    if (choice.kind === 'pipeline' && choice.pipelineType === 'vp') {
      const pipe = player?.pipelineSupply.find(
        (entry) => entry.type === 'vp' && (choice.points === undefined || entry.points === choice.points),
      );
      const points = pipe?.points ?? choice.points ?? 0;
      const token = points === 7 ? 'points7' : points === 4 ? 'points4' : 'points3';
      return { id, label: `${points}分管道`, token, selected: toolKey(selected) === id };
    }
    return { id, label: named.label, token: named.token, selected: toolKey(selected) === id };
  });
}

function availableTools(player: GameState['players'][number] | undefined): Tool[] {
  if (!player) return [];
  const tools: Tool[] = [];
  if (player.lightTrains > 0) tools.push({ kind: 'lightTrain' });
  const heavies = new Set<string>();
  for (const heavy of player.heavySupply) {
    if (heavies.has(heavy.type)) continue;
    heavies.add(heavy.type);
    tools.push({ kind: 'heavyTrain', heavyType: heavy.type });
  }
  const pipes = new Set<string>();
  for (const pipe of player.pipelineSupply) {
    // 多个 vp 管道（4/7/3 分）按分数各自成一个工具，不能用 type 折叠。
    const key = `${pipe.type}:${pipe.points ?? 0}`;
    if (pipes.has(key)) continue;
    pipes.add(key);
    tools.push({ kind: 'pipeline', pipelineType: pipe.type, points: pipe.points });
  }
  return tools;
}

function randomSeed(): number {
  return (Math.floor(Math.random() * 0x7fffffff) + 1) | 0;
}
