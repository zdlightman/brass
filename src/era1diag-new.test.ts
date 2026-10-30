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

it('20 NEW seeds: era1-end flow/reason/industry/vp/income + relock flips', () => {
  const seeds = [2, 3, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657];
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
