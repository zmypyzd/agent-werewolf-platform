# 狼人杀新增模块 · 实现位置与参考项目评估

**日期**：2026-05-04
**作者**：cc-Werewolf 分支评估会话
**状态**：决策已选定（方案 A + 主 WolfMind 辅 werewolfGameAi），待用户复核后转 writing-plans

---

## 1. 评估目标

回答两个并列问题：

1. 新增"多 agent 狼人杀"模块，应当**集成进当前 agent-poker monorepo**，还是**独立成新项目**？
2. 仓库 `参考代码/` 下提供的两个狼人杀项目（`werewolfGameAi`、`WolfMind-main`），哪个更适合作为开发起点？

输出物是一份决策记录，让下一阶段（写实现 plan）有清晰锚点。

---

## 2. 关键事实（不可绕过的硬约束）

来自 `CLAUDE.md` 与仓库现状：

- **平台定位**：技术实验性多 agent 平台，**不**做任何真实金钱/赌博/赔率类功能。新增狼人杀必须保持同定位。
- **技术栈**：TypeScript 5.5（strict, NodeNext, `.js` 后缀）、Node 20、pnpm workspaces、Vitest 2、Fastify 4 + Zod、React 18 + Vite 5。
- **已有可复用底座**：
  - `packages/agent-runtime` — `IAgent` 接口、mock/HTTP/WS/human/NPC 适配器、`TimeoutHandler`。所有 agent 调用统一过超时管控。
  - `packages/agent-protocol` — Zod 边界，外部输入在此校验后才进入引擎/编排。
  - `packages/realtime` — `RealtimeHub` + `wire`，订阅/广播阶段事件。
  - `packages/auth` — cookie session（`apk_sid`）+ CSRF + 限流 + bcrypt。
  - `packages/persistence` — SQLite + 可插拔 `IMatchArtifactStore` / `IObjectStore`。
  - `packages/table-orchestrator` — `hand-runner` / `orchestrator` / `scheduled-match-runner`，是"引擎 × agents × 持久化 × realtime"的拼装层。
  - `apps/api`、`apps/web` 路由与 SPA 模板。
- **信息隔离不变量**：`publicState` 不含底牌；`privateState` 仅含请求方私密；公共 artifact 必须 redact 私密事件；decision trace 仅持久化 `reasoningSummary`，绝不存原始 chain-of-thought，并执行 per-trace + per-match 字节/条数上限。
- **引擎纪律**：`packages/poker-engine` 是纯函数 — 无 I/O、无日志、无网络、无 `Math.random()`，所有随机走 `createSeededRng(seed)` 以保证回放可复现。新增的 `werewolf-engine` 必须遵守同样契约。
- **参考项目栈**：两个参考都是 Python（`werewolfGameAi` 用 LangChain/LangGraph；`WolfMind-main` 用 AgentScope + FastAPI + Vue3）。本平台是 TypeScript — 这意味着任何方案下，参考代码都不会被代码级移植，只用于借鉴算法/状态机/提示词/产品形态/数据结构。

---

## 3. 用户给出的偏好（本次会话采集）

- **约束强度**：软约束 — "在已有平台上做"，但实现路径开放。
- **交付形态**：产品级 — Web 控制台 + 实时观战 + 持久化 artifact。

---

## 4. 评估轴 1：集成 vs 独立

### 4.1 三个候选方案

| 方案 | 形态 |
|---|---|
| **A. 完全集成** | 新增 `packages/werewolf-engine` + `packages/werewolf-orchestrator`，复用 `agent-runtime` / `agent-protocol` / `realtime` / `auth` / `persistence` / `apps/api` / `apps/web` 全部底座。`IAgent` 做小幅泛型化或并行新增 `IWerewolfAgent`。参考代码用作算法/提示词参考。 |
| **B. 同仓库子项目** | 在 `apps/werewolf/` 新建独立技术栈（直接 fork `WolfMind-main` 的 Python 代码或新建 TS 子项目），只共享仓库与 docs，不共享底座。 |
| **C. 可演进路径** | 先做 `packages/werewolf-engine` 纯引擎 + CLI 跑通对局；引擎稳定后再加 API 路由与 SPA。是 A 的施工节奏裁剪版，不是另一套架构。 |

### 4.2 决策矩阵

| 维度 | A 完全集成 | B 同仓库子项目 | C 演进路径 |
|---|---|---|---|
| 与"产品级"形态匹配 | ✅ 直接 | ⚠️ 取决于 fork 后改造量 | ⚠️ 第一阶段无 Web UI |
| 复用 auth / realtime / persistence | ✅ | ❌ 重做或写桥接 | ✅ |
| 信息隔离纪律继承 | ✅ 已有不变量直接搬 | ❌ 要在新栈重写 | ✅ |
| 双栈维护税 | 0 | 高（pnpm + uv、Vitest + pytest、Fastify + FastAPI、React + Vue） | 0 |
| 工期估计 | 中 | 短（fork 启动）但长（双栈维护拖累） | 长（先窄后宽） |
| 上级"在该项目基础上添加"的可见度 | 高 | 低（与参考项目形态相似，差异不显著） | 高 |
| 风险点 | `IAgent` 泛型化、命名/定位扩展 | 双栈分裂、纪律重写 | 阶段交付与产品级形态有时间差 |

### 4.3 决策：方案 A，施工节奏借鉴 C

**理由（按权重）：**

1. **底座吻合度异常高** — 信息隔离、`IAgent` + `TimeoutHandler`、Zod 边界、`RealtimeHub`、`IMatchArtifactStore`、decision-trace + `reasoningSummary` 全部是狼人杀刚需。这套底座是本平台最大的资产，独立或双栈方案等于把它丢掉。
2. **栈一致** — 软约束 + 产品级形态下，TS 栈成本最低，避免双栈维护。
3. **平台定位一致** — `CLAUDE.md` 已写明"技术实验性多 agent 平台"，新增第二个游戏正合该定位，不需要重新定调。
4. **施工节奏借用 C** — 落地时先 `werewolf-engine`（纯函数）+ `werewolf-orchestrator` 跑通集成测，再贴 API 与 SPA。这是 PR 拆分顺序，不是另一套架构。

---

## 5. 评估轴 2：参考项目对比

### 5.1 画像

| 维度 | werewolfGameAi | WolfMind-main |
|---|---|---|
| 形态 | CLI-only 上帝视角 | FastAPI + Vue3 + WS 完整产品 |
| 多 agent 框架 | LangChain + LangGraph | AgentScope + asyncio 并行 + 节流 |
| 决策抽象 | 单段决策（`agents/base_agent`） | **三段式（心声 → 表现 → 发言）** |
| 状态机组织 | `graph/`（builder + nodes）+ `rules/`（day/night/win） | `core/game_engine.py` + `models/roles.py` + `prompts/` |
| 私密信息 | 角色实例直接持有 | `models/schemas.py` 结构化 + Pydantic |
| 工程模式 | 简洁（agents / cli / graph / llm / models / prompts / recorder / rules） | 产品级（EventBus + WS + 经验库 + 分析 pipeline + Docker） |
| 部署 | `python src/main.py` 单入口 | `npm run dev` 前后端一起启 / Docker compose |
| 数据资产 | `logs/*.json`（speeches/actions/votes/summary） | `data/game_logs/`、`data/experiences/`、`data/analysis_reports/` |

### 5.2 与本平台的契合点对照

| 本平台资产 | werewolfGameAi 对照 | WolfMind 对照 |
|---|---|---|
| `IAgent.requestDecision` | 角色 agent 内部的"思考一步"函数 | `Agent.observe + reply` 模式（AgentScope） |
| `TimeoutHandler` | 无显式 | `asyncio.wait_for` + 节流 |
| `agent-protocol` Zod 边界 | 弱 | `models/schemas.py` Pydantic 强契合 |
| 信息隔离（public/private state） | 弱（角色实例直接持有） | 中（schemas 区分） |
| `RealtimeHub` 阶段广播 | 无（CLI 打印） | `api_server.py` EventBus + WS 完全同构 |
| decision-trace + `reasoningSummary` | `recorder/` 简单 JSON | 三段式（心声/表现/发言）天然映射 `reasoningSummary` |
| `IMatchArtifactStore` | `logs/*.json` 文件 | `data/game_logs/*.log` + 分析报告 HTML |
| `apps/web` live-table 模式 | 无 | Vue 控制台（Header/RoomView/GameFeed），思路同构 |

### 5.3 决策：主参考 WolfMind-main，辅参考 werewolfGameAi

- **主 WolfMind**：FastAPI+WS 模式 → Fastify+`RealtimeHub`；三段式决策 → `reasoningSummary`；玩家经验库 → 平台 `agent-config` 扩展方向；分析 pipeline → 平台 decision-trace + analysis 方向；Pydantic schemas → Zod schemas。**产品形态、工程模式、数据结构、提示词**主要从 WolfMind 取。
- **辅 werewolfGameAi**：`graph/`（夜晚/白天/投票节点）和 `rules/`（day/night/win 三文件）是最干净的"最小可工作状态机"。当做 `werewolf-engine` 引擎层 PR 时，对照它确保规则不漏。**算法、状态机骨架、规则边界**主要从 werewolfGameAi 取。
- **代码不直接移植**。无论从哪个参考取灵感，落地都是 TypeScript + 本平台抽象，遵守 `werewolf-engine` 的"纯函数、无 I/O、seeded RNG"纪律。

---

## 6. 实施骨架（仅给方案 A 的入口轮廓，不替代实现 plan）

下面只列要新增/触动的位置，不写具体接口签名 — 那是下一步 writing-plans 的活。

### 6.1 包级别

```
packages/
├── shared/                      ← 加狼人杀公共类型（Role、Phase、Side）与错误码
├── agent-protocol/              ← 新增 WerewolfDecisionRequest/Response 与相关 Zod schemas
├── agent-runtime/               ← 评估 IAgent 是否泛型化；或并行新增 IWerewolfAgent
├── werewolf-engine/             ← 新增。纯函数、无 I/O、seeded RNG；夜晚阶段、白天发言、投票、胜负判定
├── werewolf-orchestrator/       ← 新增。引擎 × agents × 超时 × 持久化 × realtime 的拼装层
├── realtime/                    ← 复用，无改动
├── auth/                        ← 复用，无改动
└── persistence/                 ← 复用 IMatchArtifactStore；可能加狼人杀 artifact schema
```

### 6.2 应用层

```
apps/api/src/routes/             ← 新增 /api/v1/werewolf/...
apps/web/src/                    ← 新增狼人杀页面，复用 live-table 组件思路
```

### 6.3 信息隔离边界（必须在 plan 阶段精确定义）

- 狼人在夜晚知道"己方狼队全员"； `privateState.knownAllies` 仅返回给狼人 agent
- 预言家查验结果只入预言家本人 `privateState`
- 女巫知道当晚被刀目标 — 只入女巫 `privateState`
- 公共 artifact 中夜晚行为序列必须 redact 行为方/目标的私密关联，仅暴露聚合结果（"昨晚 X 死亡"）
- 三段式决策的"心声"段绝不进入公共 trace；"表现/发言"段才允许；"心声"如需持久化必须落到 owner-only 的私密 trace 通道

### 6.4 引擎纪律（开工前确认的契约）

- 纯函数；状态转移 `(state, action) → state'`
- 无 `Math.random()`；所有随机经 `createSeededRng(${tableSeed}-${gameNumber}-${phaseTag})`
- 单元测可逐回合复现完整对局
- 与 `poker-engine` 平行存在，互不依赖

---

## 7. 风险与开放问题

| 风险/问题 | 处理建议 |
|---|---|
| `IAgent` 接口当前绑定 poker 的 `AgentDecisionRequest/Response` | 在 plan 阶段决定：泛型化 `IAgent<TReq, TRes>`，还是并行新增 `IWerewolfAgent`。倾向泛型化但需评估对现有 adapter 影响。 |
| 平台命名（agent-poker → 多对局平台）是否要改 | 不在本评估范围；可在 plan 阶段提议，由 PM/老板决定。命名变更与本次实现解耦。 |
| 三段式"心声"如何持久化 | 必须设计成 owner-only 私密通道，不能进入公共 decision trace。在 plan 阶段精确写出 redact 规则。 |
| 经验库/对手建模是否进 v1 | 倾向先不进，作为 phase 2。v1 只做引擎 + 编排 + Web 控制台 + artifact。 |
| 模型成本与节流 | 借鉴 WolfMind 的 asyncio 并行 + 小延迟节流策略；本平台 `TimeoutHandler` 已有超时，节流策略需在 orchestrator 层加。 |
| 9-AI vs 可变玩家数 | v1 先锁 9 人标准局；可变玩家数列入未来扩展。 |

---

## 8. 下一步

本 spec 落地后，由用户复核确认；通过后调用 `superpowers:writing-plans` 把方案 A 的实现骨架展开为详细 implementation plan，包含包级别 PR 拆分、接口契约、测试策略、phase 分期。
