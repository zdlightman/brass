# Brass · Cursor Cloud 环境审计报告

日期：2026-10-31  
范围：**仅基础设施与依赖**；不描述如何改 AI 算法。  
基线门禁见 [`cloud-baseline.md`](./cloud-baseline.md)（已按当前价值计划修正，**不是**旧「默认 MCTS 16×2 + 必须巴里」）。

---

## 1. 运行时与包管理

| 项 | 要求 | 仓库现状 |
|---|---|---|
| OS（云） | Ubuntu x86_64 | 本地为 Windows；云端需 Linux |
| Node.js | **≥ 20**（建议 22 LTS；lockfileVersion 3） | 未钉 `.nvmrc`；云应安装 Node 22 |
| 包管理器 | **npm** | `package-lock.json`（lockfileVersion **3**） |
| Python | **可选** | `traces/train_value_net.py` 等用 **NumPy**；**不依赖 PyTorch** |
| GPU | 不需要 | 价值网为 CPU numpy MLP |

主路径（引擎 / vitest / Vite）**只需 Node + npm**。Python 缺省时 Smoke/Regression 仍应通过。

---

## 2. TypeScript / 构建

| 命令 | 作用 |
|---|---|
| `npm ci` | 按 lockfile 安装 |
| `npm run build` | `tsc -b && vite build` |
| `npx tsc -b` | 仅类型检查/工程引用编译 |
| `npm run lint` | oxlint |
| `npm run dev` | Vite 热座 UI（云 agent 一般不需要常驻） |

TypeScript：`~6.0.3`（已解析 6.0.3）。  
配置：`tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`。

---

## 3. 测试入口一览

统一跑：`npm test` → `vitest run`（约 30+ 个 `*.test.ts`，含引擎与 AI）。

### 3.1 建议分层（云）

| 层 | npm script | 内容 | 预估时长 |
|---|---|---|---|
| **Smoke** | `npm run test:smoke` | `tsc -b` + 引擎快测 + `evaluateState` / `choose` / seed777 贪心核心煤 | ~1–2 min |
| **Regression** | `npm run test:regression` | `era1diag` 20 种子破产线 + seed777 MCTS/定锚核心煤回归 | ~5–10 min |
| **Benchmark** | `npm run test:benchmark` | `era1:baseline` / `era1:compare` / `era1:outside`（慢） | ~15–40+ min |

### 3.2 已有专用脚本

| Script | 文件 |
|---|---|
| `era1:baseline` | `src/era1-baseline-report.test.ts` |
| `era1:anchor` | `src/ai/era1Anchor.test.ts` |
| `era1:compare` | `src/ai/era1Anchor-compare.test.ts` |
| `era1:outside` | `src/ai/era1Anchor-outside.test.ts` |

### 3.3 关键回归文件

- 20 种子破产：`src/era1diag.test.ts`（及 `era1diag-new.test.ts`）
- seed777：`src/ai/mcts.test.ts`、`mcts-drive.test.ts`、`era1Anchor.test.ts`、`choose` 相关
- 诊断/临时：`src/tmp-diag.test.ts`、`diag*.test.ts`、`many-seed.test.ts` — **勿作门禁**（慢/噪声）

---

## 4. 生产决策入口（供门禁理解，非改算法）

| 模式 | 入口 | 默认？ |
|---|---|---|
| 贪心 | `chooseAiAction` | **是**（热座默认） |
| MCTS | `mctsChoose(..., {iterations:16, rolloutDepth:2, topK:4, topM:8})` | 可选 |
| 时代1定锚 | `era1AnchorChoose`（推到一时代计分） | 可选、很慢 |

---

## 5. Python / 自对弈（可选）

| 文件 | 依赖 | 说明 |
|---|---|---|
| `traces/train_value_net.py` | `numpy` | 路径写死为 `D:/pythonprojects/Brass/traces` — **上云前需改成相对路径**（已知债） |
| `traces/evaluate_value_net.py` | `numpy` | 同上 |
| `traces/traces.json` / `value_net.json` | 数据产物 | 可 gitignore 大文件；训练非 Regression 阻塞项 |

**不需要 PyTorch。** 当前价值计划主线是 TS 启发式 + 时代1定锚，不是重训网络。

自对弈 / 轨迹：`src/ai/export-traces.test.ts`、`scripts/era1-sim.ts`、`scripts/full-sim.ts` — Benchmark 级。

---

## 6. 云环境缺口（任务 2 对应）

| 缺口 | 状态 |
|---|---|
| `.cursor/environment.json` | 本次补骨架 |
| `Dockerfile` | 本次补最小 Node 22 镜像 |
| `AGENTS.md` | 本次补 |
| 统一 JSON 测试报告 | 本次补 `scripts/cloud-report.mjs` 最小版 |
| `git remote` | **本地仍可能无 origin** — 需你提供 GitHub 仓库后 `git remote add` + push |
| Python 脚本绝对路径 | 已知债，云跑训练前必改 |

---

## 7. 结论

- **最小云可跑集**：Node 22 + `npm ci` + `npm run test:smoke` (+ 可选 `test:regression`)。
- **不要**把 PyTorch / 全量定锚对比放进 Smoke。
- **门禁基线**以 `docs/cloud-baseline.md` 为准，覆盖旧 MCTS 默认假设。
