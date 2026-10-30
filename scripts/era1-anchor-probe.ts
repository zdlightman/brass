/**
 * 离线探针：对指定种子用时代 1 计分锚定选根动作，打印与贪心差异。
 * 用法（需本机 node）：npx tsx scripts/era1-anchor-probe.ts [seed]
 */
import { assignRoles, chooseAiAction } from '../src/ai/choose';
import { era1AnchorChoose } from '../src/ai/era1Anchor';
import { tile } from '../src/engine/catalog';
import { createGame } from '../src/engine/state';
import type { Action } from '../src/engine/types';

function label(a: Action | null): string {
  if (!a) return 'null';
  if (a.type === 'build') return `build:${tile(a.tileDefId).kind}@${a.slotId ?? '?'}`;
  if (a.type === 'network') {
    const p = a.placements[0];
    return `network:${p?.kind}:${p?.pipelineType ?? ''}@${p?.lineId ?? ''}`;
  }
  return a.type;
}

const seed = Number(process.argv[2] ?? 777);
const game = createGame(seed);
const roles = assignRoles(game);
const pid = game.currentPlayerId;
const greedy = chooseAiAction(game, pid, roles);
console.log(`seed=${seed} P${pid + 1} greedy=${label(greedy)}`);
console.time('era1Anchor');
const anchored = era1AnchorChoose(game, pid, roles, { width: 4 });
console.timeEnd('era1Anchor');
console.log(`anchored=${label(anchored)}`);
