import { describe, it, expect } from 'vitest';
import { applyAction } from '../engine/apply';
import { tile } from '../engine/catalog';
import { createGame } from '../engine/state';
import type { Action } from '../engine/types';
import { assignRoles, chooseAiAction, pickLoanAction, proposeRootActions, relockRoles } from './choose';
import { era1AnchorChoose } from './era1Anchor';

/** 子集多种子：全 20 太慢（每种子定锚约 40s）。 */
const SEEDS = [777, 42, 1, 7, 99, 555, 2024, 88];

function canCoreCoal(state: Parameters<typeof proposeRootActions>[0], pid: Parameters<typeof proposeRootActions>[1], roles: Parameters<typeof proposeRootActions>[2]): boolean {
  return proposeRootActions(state, pid, roles, 20, 40).some(
    (a) => a.type === 'build' && a.tileDefId && tile(a.tileDefId).kind === 'coal' && /^(wilkes-barre|clarksburg)-/.test(String(a.slotId ?? '')),
  );
}

function bucket(a: Action | null): string {
  if (!a) return 'none';
  if (a.type === 'loan') return 'loan';
  if (a.type === 'build' && tile(a.tileDefId).kind === 'coal') {
    const city = String(a.slotId ?? '').replace(/-\d+$/, '');
    if (city === 'wilkes-barre' || city === 'clarksburg') return 'coreCoal';
    return `coal@${city}`;
  }
  if (a.type === 'network' && a.placements[0]?.kind === 'pipeline') {
    return a.placements[0]?.pipelineType === 'reserve' ? 'reservePipe' : 'pipe';
  }
  if (a.type === 'build') return `build:${tile(a.tileDefId).kind}`;
  return a.type;
}

function label(a: Action | null): string {
  if (!a) return 'null';
  if (a.type === 'build') return `build:${tile(a.tileDefId).kind}@${String(a.slotId ?? '').replace(/-\d+$/, '')}`;
  if (a.type === 'network') {
    const p = a.placements[0];
    return `net:${p?.kind}:${p?.pipelineType ?? ''}`;
  }
  return a.type;
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function fmt(map: Map<string, number>): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join(' ');
}

describe('era1Anchor 多种子对照（计划：定锚 vs 贪心）', () => {
  it('R1 首招：贪心 vs 定锚(width=4) 桶分布', () => {
    const gBuckets = new Map<string, number>();
    const aBuckets = new Map<string, number>();
    let differ = 0;

    for (const seed of SEEDS) {
      const game = createGame(seed);
      const roles = assignRoles(game);
      const pid = game.currentPlayerId;
      const greedy = chooseAiAction(game, pid, roles);
      const anchored = era1AnchorChoose(game, pid, roles, { width: 4 });
      const gb = bucket(greedy);
      const ab = bucket(anchored);
      tally(gBuckets, gb);
      tally(aBuckets, ab);
      if (gb !== ab) differ += 1;
      // eslint-disable-next-line no-console
      console.log(`[${seed}] P${pid + 1} greedy=${label(greedy)} | anchor=${label(anchored)}${gb !== ab ? ' *DIFF*' : ''}`);
    }

    // eslint-disable-next-line no-console
    console.log(`贪心桶 ${fmt(gBuckets)}`);
    // eslint-disable-next-line no-console
    console.log(`定锚桶 ${fmt(aBuckets)}`);
    // eslint-disable-next-line no-console
    console.log(`首招不同 ${differ}/${SEEDS.length}`);

    expect(aBuckets.get('reservePipe') ?? 0).toBe(0);
    expect((aBuckets.get('coreCoal') ?? 0) + (aBuckets.get('loan') ?? 0)).toBeGreaterThan(0);
  }, 600_000);

  it('巴里已有煤且己方仍能核心煤：贪心 vs 定锚（经典贷开抢顺位审计）', () => {
    // 人类线：巴里已有煤 → 贷开抢顺位 → 下回合煤双压收入。不是「无煤可造」才贷。
    let samples = 0;
    let loanGreedy = 0;
    let loanAnchor = 0;
    let loanPickable = 0;
    let differ = 0;

    for (const seed of SEEDS) {
      let state = createGame(seed);
      let roles = assignRoles(state);
      let seenBarry = false;
      for (let step = 0; step < 60 && !state.over && state.era === 1; step++) {
        roles = relockRoles(state, roles);
        const pid = state.currentPlayerId;
        const barryCoal = state.slots.some(
          (s) => s.locationId === 'wilkes-barre' && s.tileDefId && tile(s.tileDefId).kind === 'coal',
        );
        if (barryCoal) seenBarry = true;
        if (seenBarry && canCoreCoal(state, pid, roles)) {
          const pickable = !!pickLoanAction(state, pid, roles[pid]);
          if (pickable) loanPickable += 1;
          const greedy = chooseAiAction(state, pid, roles);
          const anchored = era1AnchorChoose(state, pid, roles, { width: 5 });
          samples += 1;
          if (bucket(greedy) === 'loan') loanGreedy += 1;
          if (bucket(anchored) === 'loan') loanAnchor += 1;
          if (bucket(greedy) !== bucket(anchored)) differ += 1;
          // eslint-disable-next-line no-console
          console.log(
            `[${seed}] barry+canCoal P${pid + 1} loanOk=${pickable} greedy=${label(greedy)} | anchor=${label(anchored)}${
              bucket(greedy) !== bucket(anchored) ? ' *DIFF*' : ''
            }`,
          );
          break;
        }

        const action = chooseAiAction(state, pid, roles);
        if (!action) break;
        const result = applyAction(state, action);
        if (!result.ok) break;
        state = result.state;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `巴里+可核心煤样本 ${samples} 可贷=${loanPickable} 贷开贪心=${loanGreedy} 定锚=${loanAnchor} 不同=${differ}`,
    );
    expect(samples).toBeGreaterThan(0);
  }, 600_000);
});
