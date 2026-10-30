import { describe, it, expect } from 'vitest';
import { assignRoles, chooseAiAction, relockRoles } from './ai/choose';
import { era1AnchorChoose } from './ai/era1Anchor';
import { applyAction } from './engine/apply';
import { tile } from './engine/catalog';
import { createGame } from './engine/state';
import { setHoldEraScore } from './engine/turn';
import type { Action } from './engine/types';

const SEEDS = [1, 7, 99, 1234, 555, 2024, 88, 31337, 20261026, 42, 77, 101, 5, 19, 66, 2000, 777, 1024, 8080, 1314];

function openingBucket(a: Action | null): string {
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

describe('era1 greedy baseline report（定锚前度量，不打补丁）', () => {
  it('20 种子：破产线 + 开局桶 + 外部购买', () => {
    const buckets = new Map<string, number>();
    let bankrupt = 0;
    const outside = { 煤: 0, 铁: 0, 焦炭: 0, 钢: 0 };

    for (const seed of SEEDS) {
      setHoldEraScore(true);
      try {
        let state = createGame(seed);
        let roles = assignRoles(state);
        let firstActs = 0;
        for (let step = 0; step < 2500 && !state.over && !state.eraScoreHeld; step++) {
          roles = relockRoles(state, roles);
          const action = chooseAiAction(state, state.currentPlayerId, roles);
          if (!action) break;
          if (state.round === 1 && firstActs < 4) {
            const b = openingBucket(action);
            buckets.set(b, (buckets.get(b) ?? 0) + 1);
            firstActs += 1;
          }
          const result = applyAction(state, action);
          if (!result.ok) break;
          for (const entry of result.state.log.slice(state.log.length)) {
            const m = entry.text.match(/从外部购买(煤|铁|焦炭|钢)/);
            if (m && m[1] in outside) outside[m[1] as keyof typeof outside] += 1;
          }
          state = result.state;
        }
        for (const p of state.players) if (p.vp <= -40) bankrupt += 1;
      } finally {
        setHoldEraScore(false);
      }
    }

    const bucketLine = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    // eslint-disable-next-line no-console
    console.log(`开局桶 ${bucketLine}`);
    // eslint-disable-next-line no-console
    console.log(`外部购买 煤${outside.煤} 铁${outside.铁} 焦炭${outside.焦炭} 钢${outside.钢}`);
    // eslint-disable-next-line no-console
    console.log(`破产 ${bankrupt}/80`);

    expect(bankrupt).toBeLessThanOrEqual(1); // 旧基线 ≤1/80；当前应接近 0
  }, 600_000);

  it('seed777 首招：贪心 vs 时代1定锚', () => {
    const game = createGame(777);
    const roles = assignRoles(game);
    const pid = game.currentPlayerId;
    const greedy = chooseAiAction(game, pid, roles);
    const anchored = era1AnchorChoose(game, pid, roles, { width: 4 });
    // eslint-disable-next-line no-console
    console.log(`seed777 greedy=${label(greedy)} anchor=${label(anchored)}`);
    expect(openingBucket(anchored)).toBe('coreCoal');
  }, 300_000);
});
