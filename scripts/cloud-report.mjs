#!/usr/bin/env node
/**
 * 统一云测入口：跑一层测试并写 reports/cloud/<tier>-<ts>.json
 * 用法: node scripts/cloud-report.mjs <smoke|regression|benchmark>
 * 不修改 AI 逻辑。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tier = process.argv[2] ?? 'smoke';
const root = process.cwd();
const outDir = join(root, 'reports', 'cloud');
mkdirSync(outDir, { recursive: true });

const nodeBin = process.execPath;
const tscJs = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const vitestJs = join(root, 'node_modules', 'vitest', 'vitest.mjs');

const TIERS = {
  smoke: {
    label: 'smoke',
    steps: [
      { name: 'tsc', cmd: nodeBin, args: [tscJs, '-b', '--pretty', 'false'] },
      {
        name: 'vitest-smoke',
        cmd: nodeBin,
        args: [
          vitestJs,
          'run',
          'src/engine/build.test.ts',
          'src/engine/pass.test.ts',
          'src/engine/era.test.ts',
          'src/ai/evaluateState.test.ts',
          'src/ai/choose.test.ts',
          'src/ai/era1Anchor-seat.test.ts',
          '--testTimeout=60000',
        ],
      },
    ],
  },
  regression: {
    label: 'regression',
    steps: [
      {
        name: 'era1diag-bankruptcy',
        cmd: nodeBin,
        args: [vitestJs, 'run', 'src/era1diag.test.ts', '--testTimeout=600000'],
      },
      {
        name: 'seed777-core-coal',
        cmd: nodeBin,
        args: [
          vitestJs,
          'run',
          'src/ai/era1Anchor.test.ts',
          'src/ai/mcts.test.ts',
          '-t',
          '核心城煤开|选核心城煤开|seed777',
          '--testTimeout=300000',
        ],
      },
    ],
  },
  benchmark: {
    label: 'benchmark',
    steps: [
      {
        name: 'era1-baseline',
        cmd: nodeBin,
        args: [vitestJs, 'run', 'src/era1-baseline-report.test.ts', '--testTimeout=600000'],
      },
      {
        name: 'era1-outside',
        cmd: nodeBin,
        args: [vitestJs, 'run', 'src/ai/era1Anchor-outside.test.ts', '--testTimeout=900000'],
      },
    ],
  },
};

const conf = TIERS[tier];
if (!conf) {
  console.error(`Unknown tier: ${tier}. Use smoke|regression|benchmark`);
  process.exit(2);
}

const started = Date.now();
const steps = [];
let failed = 0;

for (const step of conf.steps) {
  const t0 = Date.now();
  const r = spawnSync(step.cmd, step.args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  const ok = r.status === 0;
  if (!ok) failed += 1;
  steps.push({
    name: step.name,
    ok,
    exitCode: r.status,
    durationMs: Date.now() - t0,
    stdoutTail: (r.stdout ?? '').slice(-4000),
    stderrTail: (r.stderr ?? '').slice(-2000),
  });
  console.log(`[${tier}] ${step.name}: ${ok ? 'PASS' : 'FAIL'} (${Date.now() - t0}ms)`);
}

const report = {
  tier: conf.label,
  ok: failed === 0,
  failedSteps: failed,
  durationMs: Date.now() - started,
  timestamp: new Date().toISOString(),
  baselineDoc: 'docs/cloud-baseline.md',
  notes: {
    defaultBrain: 'greedy',
    seed777: 'core coal wilkes-barre|clarksburg',
    mctsOptional: { iterations: 16, rolloutDepth: 2, topK: 4, topM: 8 },
  },
  steps,
  metrics: {
    // 占位：详细 VP/破产/耗时由各 vitest stdout 解析；本壳保证机器可读通过率
    passRate: failed === 0 ? 1 : Math.max(0, (steps.length - failed) / steps.length),
    averageVp: null,
    winRate: null,
    bankruptcyRate: null,
    mctsAvgDecisionMs: null,
    seeds: tier === 'regression' ? [777] : null,
  },
};

const file = join(outDir, `${tier}-${started}.json`);
writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
writeFileSync(join(outDir, `${tier}-latest.json`), JSON.stringify(report, null, 2), 'utf8');
console.log(`Wrote ${file}`);
process.exit(failed === 0 ? 0 : 1);
