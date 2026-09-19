# AgentLogistics Agent Brain

这个目录是 A 同学负责的 Agent 大脑。它不修改 B 同学的 Rust 仿真核心，只通过 B 已提供的 JSON Lines 命令接口控制世界。

## 已完成

- `sim-client.mjs`：持久启动 `target/debug/logistics.exe`，按 JSON Lines 收发命令。
- `tools.mjs`：把 B 同学的 15 个命令映射为 LLM Function Calling 工具定义。
- `llm.mjs`：OpenAI-compatible Chat Completions 客户端，支持任意 base URL。
- `observation.mjs`：状态压缩、热点提取、Prompt 构建。
- `policy.mjs`：无 LLM 时的确定性安全降级策略。
- `loop.mjs`：AgentLoop，负责感知、工具调用、步进、事件游标、trace 和可选解释。
- `server.mjs`：给 C 同学前端用的本地 HTTP API。
- `cli.mjs`：命令行运行与演示。

## 运行前提

先构建 B 同学的 Rust 核心：

```powershell
cargo build --locked
```

无 API key 的离线规则模式：

```powershell
cd agent
node cli.mjs demo --mode rule --turns 300
```

LLM 模式：

```powershell
$env:AGENT_MODE='llm'
$env:OPENAI_API_KEY='...'
$env:OPENAI_MODEL='gpt-4o-mini'
node cli.mjs demo --mode llm --turns 300
```

启动 Agent HTTP 服务：

```powershell
node server.mjs
```

默认地址为 `http://127.0.0.1:8788`。

## C 同学前端接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/agent/status | 当前模式、tick、KPI、trace 长度 |
| GET | /api/agent/state | 当前完整世界快照 |
| GET | `/api/agent/tools` | Agent 可用的工具 Schema |
| GET | `/api/agent/events?after=0` | 增量领域事件 |
| GET | `/api/agent/trace` | 最近决策 trace |
| POST | `/api/agent/reset` | 重置世界，可选 `{seed,map,robots}` |
| POST | `/api/agent/decide` | 执行一轮 Agent 决策 |
| POST | `/api/agent/run` | 执行多轮，例如 `{turns:300,ticks:1}` |
| POST | `/api/agent/command` | 直接透传仿真命令，例如 `{op:"step",ticks:1}` |

前端通常调用 `/api/agent/decide` 推进一帧，再用 B 同学的 `/api/state` 或 `/api/stream` 获取世界快照来渲染。也可以直接用 `/api/agent/run` 批量跑完并读取最终 trace。

## 两种模式

`rule` 模式不调用 LLM，使用最近优先派单、故障修复和等待重规划，适合无网环境和演示兜底。

`llm` 模式使用 OpenAI-compatible Function Calling。模型通过 `get_state`、`assign_order`、`replan`、`repair_robot`、`step` 等工具自主决策。若模型未调用 `step`，AgentLoop 会安全地补一次 `step`，保证演示不会卡住。

## 环境变量

参考同目录 `.env.example`。常用项：

- `AGENT_MODE`：`rule` 或 `llm`。
- `OPENAI_API_KEY`：LLM API key。
- `OPENAI_BASE_URL`：默认 OpenAI v1 地址，可换成兼容服务。
- `OPENAI_MODEL`：默认 `gpt-4o-mini`。
- `AGENT_EXPLAIN`：设为 `true` 时每轮追加中文解释，方便 C 同学展示“Agent 为什么这么做”。
