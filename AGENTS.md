# AGENTS.md — Brass（Cursor Cloud / 本地 Agent）

## 项目是什么

《黄铜：匹兹堡》规则引擎 + 热座 UI + AI（贪心 / 可选 MCTS / 可选时代1定锚）。  
技术栈：React 19、TypeScript、Vite、Vitest、npm。

## 开干前必读

1. [`docs/cloud-baseline.md`](docs/cloud-baseline.md) — **门禁基线**（默认贪心；seed777 = 巴里\|克堡）
2. [`docs/value-framework.md`](docs/value-framework.md) — 价值哲学与定锚结论
3. [`docs/cloud-environment-audit.md`](docs/cloud-environment-audit.md) — 依赖与测试分层

## 环境

```bash
# Node 22+ 推荐
npm ci
npm run build          # tsc -b && vite build
npm run test:smoke     # 快门禁
npm run test:regression
# npm run test:benchmark   # 很慢，勿默认跑
```

- **不要**假设已装 PyTorch；价值网训练可选且脚本含硬编码 Windows 路径。
- 云端以 Ubuntu x86_64 + Node 为主；见 `.cursor/environment.json` / `Dockerfile`。

## 改代码时的约束

- **云基建任务**：禁止改生产 AI 决策逻辑（`src/ai/choose.ts` 主策略、默认热座脑）。
- **价值/算法任务**：允许改 AI，但须跑 `test:smoke` + 相关 regression；更新 `cloud-baseline.md` 若期望变了。
- 不要删除或弱化现有测试；临时 `diag*` / `tmp-*` 勿升为默认门禁。
- 不为单个臭招给 `scoreAction` 打补丁（外部焦炭等）——用时代1定锚/审计。

## 测试分层

| 命令 | 用途 |
|---|---|
| `npm run test:smoke` | 编译 + 快测 + JSON 报告 |
| `npm run test:regression` | 破产线 + seed777 核心回归 + JSON |
| `npm run test:benchmark` | 定锚对照等慢测 + JSON |
| `npm run report:cloud` | 仅汇总最近报告目录 |

报告目录：`reports/cloud/`（机器可读 JSON）。

## 决策入口速查

- 默认：`chooseAiAction`
- 可选 MCTS：`mctsChoose`（16×2×topK4×topM8）
- 可选定锚：`era1AnchorChoose`（慢）

## Git

推送前确认 `git remote -v` 有 origin。无远程时先由维护者创建 GitHub 仓库并 `git remote add origin ...`。
