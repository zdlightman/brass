# Brass AI 路线方案：启发式 + 确定化 MCTS

**时间点划断：2026-10-31（以本文件为"现在"）**
**结论先行**：对《Brass: Pittsburgh》四人 AI 模拟器，"启发式局面评估 + 确定化 MCTS"是最优先、最高落地优先级路线；机器学习/自对弈作为第二层价值函数优化；SVM 不建议。本文件结合本项目**实际代码**说明可行性、划断现状、并给出下一步任务清单（自包含，可跨 AI 交接并行落地）。

---

## 一、之前已完成的工作（划断基线）

| 阶段 | 内容 | 状态 |
|---|---|---|
| 引擎 | 完整规则引擎 applyAction(state, action)（build/network/sell/develop/era/pass/industry），含测试 | ✅ 已交付 |
| 资源/两步交互 | 动作阶段 + 资源消耗阶段、PlayerPanel 确认、重车储备 token UI | ✅ 已交付 |
| 研发连锁 | develop.ts + mat.ts + PlayerMat.tsx（免费研发/连锁） | ✅ 已交付 |
| 贷款纪律 | 时代 1 破产漏洞修复（贷款纪律） | ✅ 已交付 |
| 角色系统 | Role 三态化：预设经济流 + 动态决定流派（assignRoles/relockRoles） | ✅ 已交付 |
| 价值体系 | 分/钱锚定的净价值计算（scoreAction 重构）、集中售卖（multi-sell）、重车用途修正 | ✅ 已交付 |
| 当前主线 | "煤开 > 贷开 > 管开"优先级：核心煤城豁免 + coalSupply 压制减半 + 储备管 R1-2 压制（断管修复） | ✅ 本段完成 |
| 验证基建 | 旧 20 种子（era1diag）、新 20 种子（era1diag-new）、seed777 完整对局（tmp-diag）、破产线 vp<=-40 | ✅ 可复现 |

**回归基线（当前最终版）**：tsc ✓、守护 6/6 ✓、seed777 开局 P4/P3/P2 煤开巴里 + P1 收入管克堡（无断管）✓、旧 20 破产 **0/80**、新 20 破产 **1/80**（seed55 P4 −40 油流边缘局）。

---

## 二、"现在"的代码事实（可行性依据，均经核验）

当前 AI 主逻辑（`src/ai/choose.ts`）：

```
chooseAiAction:  for action in candidates → applyAction(clone) 推一步 → scoreAction 打分 → 取最高
```

**三个瓶颈的代码落点（诊断确认命中）：**
1. **短视**：只 `applyAction` 推一步 + `scoreAction` 打分，看不到 16 回合长线。
2. **分解式打分**：每个动作独立 `scoreAction`，无序列评估，识别不了"铺铁路→建厂→卖货"combo。
3. **静态价值**：`scoreAction(before, after)` 输入局部前后差，不显式编码剩余回合/时代阶段，同动作时序不同分相同。

**已具备、可直接复用的关键资产（这是 MCTS 路线可行的核心依据）：**
| 资产 | 位置 | MCTS 中的角色 |
|---|---|---|
| 状态转移模拟器 `applyAction(state, action)` | `engine/apply.ts`（被引擎测试覆盖） | MCTS 最贵组件，**已就绪** |
| 动作生成器 `candidates(current, pid, style)` | `choose.ts:36`（pass/loan/develop/build/network/sell + 内部启发式预排序 + 基础过滤） | MCTS 合法动作接口 + 剪枝 |
| 局面可观察量特征函数库 | `hasCoalSlot/freeSupply/buildRank/linksToEastOil/isCoreCoalCity/minLinksTo/roadPoints/incomeCanRecover...` | 升级为局面评估 `evaluateState` 的特征源 |
| 完整对局 self-play 基建 | `era1diag(-new)/tmp-diag/many-seed/full-play.log` | 训练数据生成 + 回归验收 |

---

## 三、路线可行性结论

**完全可行，最高落地优先级。** 理由：
- 你不需要写模拟器（applyAction 已有且被测试覆盖）——MCTS 最贵、最容易出错的组件已解决。
- 你不需要从零设计动作枚举（candidates 已有带剪枝）。
- 你不必从零设计特征（现有特征函数库直接聚合升级为局面评估）。
- 验证闭环已存在（两套 20 种子 + seed777 + 破产线）。
- TypeScript 内可写完整 MCTS（缓存 + 剪枝 + 采样 N=8~32），算力可控，单人可落地。

**边界（诚实声明）：** 四人不完全信息 MCTS 有方差；rollout 对手用同策略会低估对手反制（需多风格参数进阶）；单人算力达不到 AlphaZero 级。目标 = 高质量热座对手，不追顶尖人类。

**不建议：** SVM（无时序/组合泛化、无法处理延迟回报信用分配）、纯监督学习（不具备规划能力，需套搜索框架）。

---

## 四、分层落地路线（按优先级，每层可独立验收）

### Tier 0（本周可做）：动作打分 → 局面评估 + 有限深度前向
- 新增 `evaluateState(state, pid, style): number`：输入整局面 → 0~100 局面期望。
- 特征复用现有库 + 新增三类：**【时序】**剩余回合/时代阶段/牌库剩余、【联动】铁路-厂-市场配套是否齐、【对手】对手产能与收入估计。
- 在 `candidates` 上做 **depth 2~3 有限前向**：对 top-k 动作各推 2~3 步（后续步用当前贪心或降级策略），累加局面分选动作——最轻的"长线"改造。
- **验收**：不破坏破产线（≤当前 1/160）、seed777 开局不变、至少出现一例"短期低分但长线联动"的铺垫动作。

### Tier 1（核心）：确定化 MCTS
- 动作接口 = `candidates`（已剪枝）；转移 = `applyAction(clone, action)`；叶子 = `evaluateState`（**截断 MCTS**，rollout 深度 4~8，不跑 16 回合全量）。
- 不完全信息：采样 **N=8~32 确定世界**（补全对手手牌/牌库/未翻油田，公共信息不变），每世界 MCTS，聚合统计选动作。
- 对手建模：rollout 中对手用同策略（默认）；进阶给对手单独保守/激进参数集模拟多风格。
- 优化：动作剪枝（过滤明显劣势）、transposition 缓存、并行 rollout。
- **验收**：稳定 2~4 步长线布局；愿为远期牺牲短期分；破产线维持；用户指定局行为正确。

### Tier 2（有富余算力）：自对弈训练价值网络（替换 evaluateState）
- 数据：现有 self-play 基建跑完整对局 → 导出 `(state, 终局分差)` 轨迹 JSON。
- 训练：TS 难训练 → 轨迹导出后 **Python 离线训练**小型 MLP/浅 Transformer（输入 = 局面特征向量，输出局面价值）。
- 部署：导出权重 json → 前端/模拟器加载推理，替换 `evaluateState` 作 MCTS 叶子。
- **关键认知**：规划能力始终来自 MCTS 搜索；网络只是更好的价值函数，不指望网络自带规划。

---

## 五、下一步任务清单（建议接续现有 #22；可并行）

| # | 层级 | 任务 | 验收 |
|---|---|---|---|
| 23 | Tier0 | 新增 `evaluateState` 局面评估（复用现有特征 + 时序/联动/对手特征） | 函数可独立单测 |
| 24 | Tier0 | 有限深度前向模拟（depth 2~3，top-k 推多步累分） | 出现长线铺垫动作、破产线不破 |
| 25 | Tier1 | MCTS 框架（UCB + rollout + 叶子 evaluateState） | 稳定 2~4 步布局 |
| 26 | Tier1 | 不完全信息采样（N 个确定世界聚合） | 方差可控 |
| 27 | Tier1 | 动作剪枝 + transposition 缓存 + 并行 rollout | 延迟可接受 |
| 28 | Tier1 | 对手多风格参数（rollout 对手建模） | 不再高估己方规划 |
| 29 | Tier2 | 轨迹导出 + Python 训练小价值网络 + 权重回载 | 网络替代手写 V(s) |
| 30 | Tier2 | 用自对弈数据校准 evaluateState 权重 | 替代手写调参 |

**每步必跑**：两套 20 种子 + seed777 + 破产线回归。

---

## 六、与当前主线的衔接（重要）

当前正处"煤开 > 贷开 > 管开"价值体系修复收尾（断管已修）。Tier 0 重构 `evaluateState` **不是推倒**，而是把这套已对齐的分/钱锚定价值（煤开优先级、储备管压制、coreCoalCity 豁免、income 管打折）**聚合进局面评估**，并叠加时序/联动/对手特征。已确认的正确行为（seed777 开局、断管修复）必须在新范式下保持——这是 Tier0 的第一验收项。

---

## 七、#23~#30 实现结果（2026-10-31 划断）

**全部 #23~#30 已实现并通过单测；#30 机制交付、大规模校准受性能约束。**

| # | 交付 | 验收 |
|---|---|---|
| 23 | `evaluateState(state,pid,style)` 七组局面特征（时序/经济/产能/联动/手牌/市场/对手） | 6/6 ✓ 确定性/现金单调/收入单调/破产风险/四人可比/流派感知 |
| 24 | `lookaheadChoose` 有限前向（depth2/width4） | 2/2 ✓ 根动作即时分用 scoreAction（保"煤开>贷开>管开"），rollout 每步当前玩家用现有 AI |
| 25 | `mctsChooseSingle`（UCB + topK 展开 + rollout + 叶子 evaluateState） | 3/3 ✓ 确定性/seed777 P4 煤开巴里/多世界投票 |
| 26 | `mctsChoose` 多世界采样 + `resampleWorld`（对牌库多洗牌模拟信息劣势） | 4/4 ✓ |
| 27 | `cheapActionScore` 粗筛 + topM/topK 剪枝（每步精确 applyAction 压到 ≤topM） | 4/4 ✓ 单决策 13~18s（structuredClone 深拷贝为硬瓶颈） |
| 28 | `OpponentStyle` + `styleScore` 对手风格偏置（mirror/conservative/aggressive） | 4/4 ✓ 默认 mirror 不破坏己方决策 |
| 29 | `featureVector`(18维) → 40 种子轨迹 5302 样本 → Python numpy MLP(18→32→32→1) 训练 → `value_net.json` → TS `valueNet.ts`/`netValue` | 2/2 ✓ tsc OK；loss 7663→130 |
| 30 | `blendedValue(α·启发式+β·网络)` 融合 + 有效性评估 | spearman 0.521 / pearson 0.688，高/低 vp 组 gap 14.9（网络学到终局价值方向） |

**关键工程事实（诚实记录）：**
- MCTS 单决策 **13~18s**（`structuredClone` 深拷贝为硬瓶颈）；多世界更慢。热座可接受，**40 种子全量 MCTS self-play 不现实**——#30 大规模校准受此约束。
- 网络数据量仍小（5302 样本）、epoch 200 后过拟合波动；`value_net.json` loss 130 仅可作辅助，生产接入需更大数据 + MCTS 性能优化后再对比验证提升。
- 主入口 `chooseAiAction` 尚未接入新决策器（接入红线：seed777 开局不变、无断管、两套 20 种子 + 破产线回归；MCTS 需权衡接入参数/时间预算）。

**待续（诚实未决项）：**
1. MCTS/网络融合的生产接入路径（替代叶子 vs 替代主入口）+ 每步时间预算。
2. MCTS 性能优化（快速 clone 替代 structuredClone）使全量 self-play 对比可行。
3. torch/GPU 大规模训练（RTX 5070 可用，样本少已显过拟合）。

---

## 八、性能优化 + 生产接入（2026-10-31 追加划断）

**结论：MCTS 已接入生产热座主入口（App.tsx），每步 ~3-6s，seed777 首步煤开巴里、无断管，回归保持。**

**性能瓶颈定位（实测，纠正原"structuredClone 是硬瓶颈"的误判）：**
| 组件 | 实测单次 | 说明 |
|---|---|---|
| structuredClone(GameState) | 0.156 ms | **不是主瓶颈**（MCTS 每决策 clone 仅 ~0.2s） |
| applyAction 单次 | 0.167 ms | 不是主瓶颈 |
| `candidates` 枚举 | ~130 ms | **真正主瓶颈**——buildCandidates 对每手牌×每tile×每slot 全量枚举 + slotAcceptsBuild/prepare 等引擎级 helper |
| MCTS 单决策 40×4 | 13.9 s | iterations/depth 线性放大 candidates 调用 |
| MCTS 单决策 12×2 / 16×2 | 4.6 s / 6.1 s | 热座可用参数 |

**已做的优化：**
1. `buildCandidates` 内 `buildRank` 按 `built.id` 缓存（纯函数，同局面同 tile 恒定）——消除大量重复 buildRank 调用（含 flowReady/builtCount 等昂贵 helper）。
2. 生产参数定为 **16×2**（iterations 16, depth 2, topK 4, topM 8）：seed777 首步煤开巴里 ✓、无断管 ✓，实测 ~3.3s/步（中局 candidates 更快）。

**诚实说明：** `candidates` 枚举是引擎级成本，是 MCTS 搜索深度的硬上限；"降参到热座可用"是性能与质量的现实取舍。若要大幅提速（更多 iterations 逼近"合格人类"），需**并行 rollout**（Web Worker 多核）或**优化 candidates 枚举本身**（引擎级重构，高风险）——均为后续可选项。

**生产接入（App.tsx:564）：** 热座 AI 决策 `mctsChoose(state, actor, roles, {iterations:16, rolloutDepth:2, topK:4, topM:8}) ?? chooseAiAction(...)`。`chooseAiAction` 本身未改——回归基线（两套 20 种子 + 守护）仍验证贪心策略，MCTS 只作用于生产热座。接入验证测试：`src/ai/mcts-drive.test.ts`（seed777 前 8 步，首步煤开 + 无断管）。
