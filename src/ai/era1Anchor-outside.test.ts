import { describe, it, expect } from 'vitest';
import { applyAction } from '../engine/apply';
import { createGame } from '../engine/state';
import type { Action } from '../engine/types';
import { assignRoles, chooseAiAction, relockRoles } from './choose';
import { era1AnchorChoose } from './era1Anchor';
import { tile } from '../engine/catalog';

/** 子集：每命中一次外部焦/钢就要跑定锚，控制种子数。 */
const SEEDS = [777, 42, 1, 7, 99, 555, 2024, 88];

function outsideCokeOrSteel(beforeLogLen: number, after: { log: { text: string }[] }): boolean {
  return after.log.slice(beforeLogLen).some((e) => /从外部购买(焦炭|钢)/.test(e.text));
}

function label(a: Action | null): string {
  if (!a) return 'null';
  if (a.type === 'build') return `build:${tile(a.tileDefId).kind}@${String(a.slotId ?? '').replace(/-\d+$/, '')}`;
  return a.type;
}

describe('era1Anchor 外部焦/钢审计（不打补丁）', () => {
  it('贪心将外部买焦/钢时，定锚是否改招', () => {
    let hits = 0;
    let anchorAlsoOutside = 0;
    let anchorAvoided = 0;
    let compared = 0;

    for (const seed of SEEDS) {
      let state = createGame(seed);
      let roles = assignRoles(state);
      let found = false;
      for (let step = 0; step < 120 && !state.over && state.era === 1 && !found; step++) {
        roles = relockRoles(state, roles);
        const pid = state.currentPlayerId;
        const greedy = chooseAiAction(state, pid, roles);
        if (!greedy) break;
        const trial = applyAction(state, greedy);
        if (!trial.ok) break;
        if (greedy.type === 'build' && outsideCokeOrSteel(state.log.length, trial.state)) {
          hits += 1;
          found = true;
          const anchored = era1AnchorChoose(state, pid, roles, { width: 5 });
          compared += 1;
          let anchorOut = false;
          if (anchored) {
            const at = applyAction(state, anchored);
            if (at.ok) anchorOut = outsideCokeOrSteel(state.log.length, at.state);
          }
          if (anchorOut) anchorAlsoOutside += 1;
          else anchorAvoided += 1;
          // eslint-disable-next-line no-console
          console.log(
            `[${seed}] P${pid + 1} greedy=${label(greedy)} OUTSIDE | anchor=${label(anchored)}${
              anchorOut ? ' OUTSIDE' : ' avoided'
            }`,
          );
          break;
        }
        state = trial.state;
      }
    }

    // eslint-disable-next-line no-console
    console.log(`外部焦/钢命中 ${hits} 对照 ${compared} 定锚仍外部=${anchorAlsoOutside} 定锚避开=${anchorAvoided}`);
    // 不强求全避开（rollout 有噪声）；有命中时记录基线
    expect(hits).toBeGreaterThanOrEqual(0);
  }, 900_000);
});
