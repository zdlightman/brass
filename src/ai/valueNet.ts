import { evaluateState, featureVector, type Role } from './choose';
import type { GameState, PlayerId } from '../engine/types';

/** #29 训练出的价值网络权重（由 traces/train_value_net.py 导出）。 */
export interface ValueNet {
  w1: number[][]; b1: number[];
  w2: number[][]; b2: number[];
  w3: number[][]; b3: number[];
  means: number[]; stds: number[];
  n_features: number;
}

const relu = (z: number): number => (z > 0 ? z : 0);

/**
 * #29 用已训练价值网络估值：featureVector → 归一化 → 2 层 MLP → 预测终局 vp。
 * 与 evaluateState 同返回"预测值"，供 #30 融合（α·启发式 + β·网络）。
 */
export function netValue(state: GameState, pid: PlayerId, role: Role, net: ValueNet): number {
  const x = featureVector(state, pid, role);
  const n = x.map((v, i) => (v - (net.means[i] ?? 0)) / (net.stds[i] ?? 1));
  const h1: number[] = [];
  for (let j = 0; j < net.b1.length; j++) {
    let s = net.b1[j];
    for (let i = 0; i < n.length; i++) s += n[i] * (net.w1[i]?.[j] ?? 0);
    h1.push(relu(s));
  }
  const h2: number[] = [];
  for (let j = 0; j < net.b2.length; j++) {
    let s = net.b2[j];
    for (let i = 0; i < h1.length; i++) s += h1[i] * (net.w2[i]?.[j] ?? 0);
    h2.push(relu(s));
  }
  let out = net.b3[0] ?? 0;
  for (let i = 0; i < h2.length; i++) out += h2[i] * (net.w3[i]?.[0] ?? 0);
  return out;
}

/**
 * #30 融合估值：α·启发式(evaluateState) + β·网络(netValue)。α/β 可校准。
 * α=1,β=0 时退回纯启发式（当前生产基版）。
 */
export function blendedValue(
  state: GameState,
  pid: PlayerId,
  role: Role,
  net: ValueNet | null,
  alpha = 1,
  beta = 1,
): number {
  const h = evaluateState(state, pid, role);
  if (!net) return h * alpha;
  return h * alpha + netValue(state, pid, role, net) * beta;
}
