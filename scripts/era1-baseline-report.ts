/**
 * 离线基线报告（贪心推满一时代）：开局动作分布、外部购买、破产。
 * 不定锚全量（太慢）；定锚只对少量种子比首招。
 *
 *   npx tsx scripts/era1-baseline-report.ts
 *   npx tsx scripts/era1-baseline-report.ts --anchor 777,42
 */
import { assignRoles, chooseAiAction, relockRoles } from '../src/ai/choose';
import { era1AnchorChoose } from '../src/ai/era1Anchor';
import { applyAction } from '../src/engine/apply';
import { tile } from '../src/engine/catalog';
import { createGame } from '../src/engine/state';
import { setHoldEraScore } from '../src/engine/turn';
import type { Action } from '../src/engine/types';

const SEEDS = [1, 7, 99, 1234, 555, 2024, 88, 31337, 20261026, 42, 77, 101, 5, 19, 66, 2000, 777, 1024, 8080, 1314];

function label(a: Action | null): string {
  if (!a) return 'null';
  if (a.type === 'build') {
    const kind = tile(a.tileDefId).kind;
    const slot = String(a.slotId ?? '');
    const city = slot.replace(/-\d+$/, '');
    return `build:${kind}@${city || '?'}`;
  }
  if (a.type === 'network') {
    const p = a.placements[0];
    return `net:${p?.kind}:${p?.pipelineType ?? ''}`;
  }
  return a.type;
}

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

function playEra1(seed: number): {
  openings: string[];
  outside: Record<string, number>;
  bankrupt: number;
  vps: number[];
} {
  setHoldEraScore(true);
  try {
    let state = createGame(seed);
    let roles = assignRoles(state);
    const openings: string[] = [];
    const outside = { 煤: 0, 铁: 0, 焦炭: 0, 钢: 0, 其它: 0 };
    let firstActs = 0;

    for (let step = 0; step < 2500 && !state.over && !state.eraScoreHeld; step++) {
      roles = relockRoles(state, roles);
      const pid = state.currentPlayerId;
      const action = chooseAiAction(state, pid, roles);
      if (!action) break;
      if (state.round === 1 && firstActs < 4) {
        openings.push(`P${pid + 1}:${openingBucket(action)}`);
        firstActs += 1;
      }
      const result = applyAction(state, action);
      if (!result.ok) break;
      for (const entry of result.state.log.slice(state.log.length)) {
        const m = entry.text.match(/从外部购买(煤|铁|焦炭|钢)/);
        if (m) {
          const k = m[1] as keyof typeof outside;
          if (k in outside) outside[k] += 1;
          else outside.其它 += 1;
        }
      }
      state = result.state;
    }

    let bankrupt = 0;
    const vps = state.players.map((p) => {
      if (p.vp <= -40) bankrupt += 1;
      return p.vp;
    });
    return { openings, outside, bankrupt, vps };
  } finally {
    setHoldEraScore(false);
  }
}

function parseAnchorSeeds(): number[] {
  const idx = process.argv.indexOf('--anchor');
  if (idx < 0) return [777];
  const raw = process.argv[idx + 1] ?? '777';
  return raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

function main(): void {
  const buckets = new Map<string, number>();
  let bankrupt = 0;
  const outsideTot = { 煤: 0, 铁: 0, 焦炭: 0, 钢: 0, 其它: 0 };

  console.log('=== 贪心一时代基线（20 种子）===');
  for (const seed of SEEDS) {
    const r = playEra1(seed);
    bankrupt += r.bankrupt;
    for (const o of r.openings) {
      const b = o.split(':')[1] ?? o;
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    for (const k of Object.keys(outsideTot) as (keyof typeof outsideTot)[]) {
      outsideTot[k] += r.outside[k];
    }
    console.log(
      `[${seed}] open=${r.openings.join(' ')} outside焦炭=${r.outside.焦炭} 铁=${r.outside.铁} VP=[${r.vps.join(',')}] 破=${r.bankrupt}`,
    );
  }

  console.log('\n开局桶计数（R1 前 4 个行动者）:');
  for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  console.log(`破产: ${bankrupt}/80`);
  console.log(`外部购买合计: 煤${outsideTot.煤} 铁${outsideTot.铁} 焦炭${outsideTot.焦炭} 钢${outsideTot.钢}`);

  const anchorSeeds = parseAnchorSeeds();
  console.log(`\n=== 首招：贪心 vs 时代1定锚（width=4）种子 ${anchorSeeds.join(',')} ===`);
  for (const seed of anchorSeeds) {
    const game = createGame(seed);
    const roles = assignRoles(game);
    const pid = game.currentPlayerId;
    const g = chooseAiAction(game, pid, roles);
    console.time(`anchor-${seed}`);
    const a = era1AnchorChoose(game, pid, roles, { width: 4 });
    console.timeEnd(`anchor-${seed}`);
    console.log(`seed${seed} P${pid + 1} greedy=${label(g)} | anchor=${label(a)}`);
  }
}

main();
