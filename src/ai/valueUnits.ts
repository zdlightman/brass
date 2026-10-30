import type { Era } from '../engine/types';

/**
 * 统一软锚定（docs/value-framework.md v3）。
 * 主轴是 VP；收入规则上不算分；系数可被时代 1 定锚改写。
 */

/** 1 块钱折合多少 VP。均值约 0.5（2 块≈1 分）；早期略高、后期略低。 */
export function moneyToVp(money: number, era: Era, round: number): number {
  return money * moneyVpPerDollar(era, round);
}

/** 每块钱的 VP 权重（软曲线，非锁死表）。 */
export function moneyVpPerDollar(era: Era, round: number): number {
  if (era === 2) return 0.35;
  if (round <= 4) return 0.55;
  if (round <= 6) return 0.45;
  return 0.4;
}

/** 市场最低补价（块）：用免费资源 / 溢出按此计价。 */
export function resourceFillMoney(kind: 'coal' | 'iron' | 'coke' | 'steel'): number {
  return kind === 'coal' || kind === 'iron' ? 2 : 4;
}

/**
 * 收入作为「未来钱期权」的轻量折算（非规则分）。
 * Δlevel × 剩余回合 × 每块钱 VP × 折扣；折扣刻意压低，避免刷收入。
 */
export function incomeAsOptionVp(
  incomeLevelDelta: number,
  roundsLeft: number,
  era: Era,
  round: number,
  discount = 0.25,
): number {
  const blocks = incomeLevelDelta * Math.max(0, roundsLeft);
  return moneyToVp(blocks, era, round) * discount;
}

/** 时代 1+2 剩余计费回合粗估（与旧 choose 口径一致，供期权用）。 */
export function roundsLeftApprox(era: Era, round: number): number {
  return 8 - round + (era === 1 ? 8 : 0);
}
