import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { featureVector, chooseAiAction, assignRoles } from './choose';
import { applyAction } from '../engine/apply';
import { createGame } from '../engine/state';
import { player } from '../engine/mat';

describe('#29 轨迹导出', () => {
  it('跑多 seed self-play，导出 {features, labels} 到 traces/traces.json', () => {
    const seeds = [
      1, 7, 99, 1234, 555, 2024, 88, 31337, 20261026, 42, 77, 101, 5, 19, 66, 2000, 777, 1024, 8080, 1314,
      2, 3, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657,
    ];
    const samples: { pid: number; f: number[] }[] = [];
    for (const seed of seeds) {
      const game = createGame(seed);
      const roles = assignRoles(game);
      let state = game;
      for (let step = 0; step < 2000 && !state.over; step++) {
        const pid = state.currentPlayerId;
        samples.push({ pid, f: featureVector(state, pid, roles[pid]) });
        const action = chooseAiAction(state, pid, roles);
        if (!action) break;
        const r = applyAction(state, action);
        if (!r.ok) break;
        state = r.state;
      }
      const finalVp = [0, 1, 2, 3].map((p) => player(state, p as never).vp);
      for (const s of samples) (s as { label?: number }).label = finalVp[s.pid];
    }
    const features = samples.map((s) => s.f);
    const labels = samples.map((s) => (s as { label?: number }).label ?? 0);
    writeFileSync('D:/pythonprojects/Brass/traces/traces.json', JSON.stringify({ features, labels }), 'utf8');
  });
});
