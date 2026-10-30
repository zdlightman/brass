import { it } from 'vitest';
import { applyAction } from './engine/apply';
import { incomeLevelAt } from './engine/income';
import { player } from './engine/mat';
import { createGame } from './engine/state';
import { assignRoles, chooseAiAction, handFlowScore, relockRoles, ROLE_ZH } from './ai/choose';
import { tile } from './engine/catalog';
import type { GameState, PlayerId } from './engine/types';

function industryOf(state: GameState, pid: PlayerId): string {
  const byKind = new Map<string, { n: number; f: number }>();
  for (const s of state.slots) {
    if (s.owner !== pid || !s.tileDefId) continue;
    let k: string;
    try {
      k = tile(s.tileDefId).kind;
    } catch {
      k = '?';
    }
    const e = byKind.get(k) ?? { n: 0, f: 0 };
    e.n++;
    if (s.flipped) e.f++;
    byKind.set(k, e);
  }
  return [...byKind.entries()].map(([k, e]) => `${k}${e.n}${e.f ? `(${e.f}翻)` : ''}`).join(',') || '无';
}

it('20 seeds: era1-end flow/reason/industry/vp/income + relock flips', () => {
  const seeds = [1, 7, 99, 1234, 555, 2024, 88, 31337, 20261026, 42, 77, 101, 5, 19, 66, 2000, 777, 1024, 8080, 1314];
  let bankrupt = 0;
  let flips = 0;
  for (const seed of seeds) {
    const game = createGame(seed);
    const opening = assignRoles(game);
    const openReason = [0, 1, 2, 3].map((p) => {
      const f = handFlowScore(game, player(game, p as PlayerId).hand);
      return `${ROLE_ZH[opening[p as PlayerId]]}(箱${f.box}/油${f.oil})`;
    });
    let roles = opening;
    let state = game;
    let flipInfo: string[] = [];
    let snap = '';
    for (let step = 0; step < 2000 && !state.over; step++) {
      const pid = state.currentPlayerId;
      // 每回合动态流派重估：按当前手牌+市场分差、随回合阈值决定（差距拉开才定，接近保持经济流）。
      if (state.era === 1) {
        const before = { ...roles };
        roles = relockRoles(state, roles);
        for (const p of [0, 1, 2, 3] as PlayerId[]) {
          if (before[p] !== roles[p]) {
            flips++;
            flipInfo.push(`P${p + 1}${before[p]}→${roles[p]}`);
          }
        }
      }
      const action = chooseAiAction(state, pid, roles);
      if (!action) throw new Error('no action');
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.error);
      if (state.era === 1 && result.state.era === 2) {
        // 抓"时代计分完成后"的真实时代1分数（result.state，era=2 起始，时代分/铁路分已入账）。
        snap = [0, 1, 2, 3].map((p) => {
          const pl = player(result.state, p as PlayerId);
          const f = handFlowScore(result.state, pl.hand);
          const role = roles[p as PlayerId];
          if (pl.vp <= -40) bankrupt++;
          return `${ROLE_ZH[role]}|${openReason[p as number]}→末(箱${f.box}/油${f.oil})|产:${industryOf(result.state, p as PlayerId)}|VP${pl.vp}|收${incomeLevelAt(pl.incomeSpace)}`;
        }).join(' || ');
      }
      state = result.state;
    }
    console.log(`[${seed}] ${flipInfo.length ? `翻转:${flipInfo.join(',')} ` : ''}${snap}`);
  }
  console.log(`\n汇总: 破产(${bankrupt}/80) 流派翻转(${flips})`);
});
