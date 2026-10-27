import { drawToHand } from './cards';
import { decideWinner, scoreEra } from './era';
import { incomeLevelAt } from './income';
import { playerTag } from './logText';
import { takeDeferredLogs } from './logQueue';
import { player } from './mat';
import type { GameState, PlayerId } from './types';

/** When set, the end of era 1 pays income and then stops before scoring or removing tiles. */
let holdEraScore = false;

export function setHoldEraScore(value: boolean): void {
  holdEraScore = value;
}

export function finishAction(state: GameState, manualConfirm = false): void {
  state.actionsTaken += 1;
  if (state.actionsTaken < state.actionsAllowed) return;
  if (manualConfirm) {
    state.pendingConfirm = true;
    return;
  }
  endTurn(state);
}

export function confirmPendingTurn(state: GameState): void {
  if (!state.pendingConfirm) return;
  state.pendingConfirm = false;
  endTurn(state);
}

function endTurn(state: GameState): void {
  const pid = state.currentPlayerId;
  drawToHand(state, pid, 8);
  if (!state.playersActed.includes(pid)) state.playersActed.push(pid);

  const idx = state.turnOrder.indexOf(pid);
  for (let i = 1; i <= state.turnOrder.length; i++) {
    const next = state.turnOrder[(idx + i) % state.turnOrder.length];
    if (next === undefined || state.playersActed.includes(next)) continue;
    if (state.deck.length === 0 && player(state, next).hand.length === 0) {
      state.playersActed.push(next);
      continue;
    }
    state.currentPlayerId = next;
    state.actionsTaken = 0;
    state.actionsAllowed = actionsThisTurn(state);
    return;
  }
  endRound(state);
}

function endRound(state: GameState): void {
  const order = [...state.turnOrder];
  order.sort((a, b) => {
    const da = state.spentThisRound[a] - state.spentThisRound[b];
    if (da !== 0) return da;
    return state.turnOrder.indexOf(a) - state.turnOrder.indexOf(b);
  });
  state.turnOrder = order;
  state.spentThisRound = { 0: 0, 1: 0, 2: 0, 3: 0 };

  const lastRoundOfGame = state.era === 2 && handsAndDeckEmpty(state);
  if (!lastRoundOfGame) {
    const paid = state.players.map((entry) => applyIncome(state, entry.id));
    logAction(state, `过回合，按收入等级结算：${paid.join('；')}。`);
  }

  if (handsAndDeckEmpty(state)) {
    if (holdEraScore && state.era === 1) {
      scoreEra(state, { remove: false });
      state.eraScoreHeld = true;
      logAction(state, '一时代计分已经完成。一级产业和轻轨还没有移除，都留在版图上。');
      return;
    }
    scoreEra(state);
    if (state.era === 1) {
      state.log.push({ text: 'Era 1 ends. Trains and flipped industries scored. Level I tiles leave the board.' });
      state.era = 2;
      state.round = 1;
    } else {
      state.over = true;
      state.winner = decideWinner(state);
      const winner = player(state, state.winner);
      state.log.push({ text: `${playerTag(winner.id)} wins with ${winner.vp} VP.` });
      return;
    }
  } else {
    state.round += 1;
  }

  state.playersActed = [];
  state.actionsTaken = 0;
  state.actionsAllowed = actionsThisTurn(state);
  if (state.deck.length === 0) {
    state.playersActed = state.turnOrder.filter((id) => player(state, id).hand.length === 0);
  }
  const first = state.turnOrder.find((id) => !state.playersActed.includes(id)) ?? state.turnOrder[0]!;
  state.currentPlayerId = first;
  state.log.push({
    text: `第 ${state.round} 回合（时代 ${state.era}）。顺位：${state.turnOrder.map((id) => playerTag(id)).join(' → ')}。`,
  });
}

function applyIncome(state: GameState, playerId: PlayerId): string {
  const p = player(state, playerId);
  const income = incomeLevelAt(p.incomeSpace);
  if (income > 0) {
    p.money += income;
    return `${playerTag(p.id)} 等级 ${income}，获得 $${income}，手头 $${p.money}`;
  }
  if (income === 0) return `${playerTag(p.id)} 等级 0，不收支，手头 $${p.money}`;
  const due = -income;
  if (p.money >= due) {
    p.money -= due;
    return `${playerTag(p.id)} 等级 ${income}，支付 $${due}，手头 $${p.money}`;
  }
  p.money = 0;
  p.whiskey = 0;
  p.vp -= 40;
  p.incomeSpace = 10;
  return `${playerTag(p.id)} 等级 ${income}，付不起 $${due}，破产，−40 分，收入回到 0，手头 $0`;
}

function handsAndDeckEmpty(state: GameState): boolean {
  return state.deck.length === 0 && state.players.every((p) => p.hand.length === 0);
}

function actionsThisTurn(state: GameState): number {
  return state.era === 1 && state.round === 1 ? 1 : 2;
}

export function logAction(state: GameState, text: string): void {
  const queued = takeDeferredLogs(state);
  state.log.push({ text: queued.length ? `${text} ${queued.join(' ')}` : text });
  if (state.log.length > 4000) state.log.splice(0, state.log.length - 4000);
}

export function spendMoney(state: GameState, playerId: PlayerId, amount: number): boolean {
  const p = player(state, playerId);
  if (p.money < amount) return false;
  p.money -= amount;
  state.spentThisRound[playerId] += amount;
  return true;
}

export function gainWhiskey(state: GameState, playerId: PlayerId, n = 1): void {
  const p = player(state, playerId);
  p.whiskey = Math.min(3, p.whiskey + n);
}
