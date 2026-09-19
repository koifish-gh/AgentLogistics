# AgentLogistics — B 同学：仿真与算法

根据文件夹内《AgentLogistics 智能仓储机器人调度.pdf》和四人分工实现。原始 PDF 未修改。
本目录包含 **Rust 仿真核心、A*、调度基线、故障与重规划、Agent 工具接口、前端接入桥和测试**。
LLM 决策逻辑、正式前端页面和 PPT 分别由 A、C、D 同学负责。

## A 同学：Agent 大脑

Agent 大脑位于 `agent/`，包含 LLM Function Calling、Prompt、AgentLoop、工具调用、事件记忆和安全降级。运行方式与 C 同学前端接口见 `agent/README.md`。

## 快速运行（Windows / PowerShell）

请从 `D:\sw_huibian` 运行。当前环境已经准备好本目录内的 Rust 工具链、依赖缓存及 debug 可执行程序。

```powershell
# 无需重新编译即可演示；默认 seed=42，20 个订单，包含故障/修复
.\target\debug\logistics.exe --demo

# 测试 / 编译，使用项目内工具链及缓存
.\scripts\dev.ps1 test --offline
.\scripts\dev.ps1 build --offline

# 按行处理命令，记录后可确定性回放
Get-Content -Encoding utf8 .\examples\scenario.jsonl |
    .\target\debug\logistics.exe --record scenario.replay.json
.\target\debug\logistics.exe --replay scenario.replay.json

# 可选：C 同学 HTTP/SSE 接入，需要 Node.js（测试使用 Node 24）
node .\scripts\server.mjs
# http://127.0.0.1:8787/api/state
```

其他机器安装 Rust（本项目验证版本为 1.98.1）后可直接 `cargo test --locked`、`cargo run -- --demo`。
Windows GNU 工具链需要可用的 MinGW 链接器；本机使用现有 `D:\mingw64\bin\gcc.exe`。
`.tools/` 是本机工具与缓存，不纳入版本管理。`Cargo.lock` 应提交，以固定依赖版本。
`dev.ps1` 的 `run`、`fmt`、`clippy` 后参数分别转交程序、格式器、静态检查器，例如：

```powershell
.\scripts\dev.ps1 run --demo
.\scripts\dev.ps1 fmt --check
.\scripts\dev.ps1 clippy
```

## 已实现

| 部分 | 行为 |
| --- | --- |
| 仓库 | 可配置网格、固定货架障碍、动态封锁、12×8 默认地图 |
| 机器人 | idle → to_pickup → to_dropoff → idle；faulted 独立状态 |
| 订单 | 优先级 0–9；pending → assigned → in_transit → completed |
| 路径 | 四邻接、单位距离 A*、曼哈顿启发、稳定的平局处理 |
| 派单 | nearest 最近优先、balanced 历史工作量均衡、manual Agent 接管 |
| 安全移动 | 同步时间步、格点预留；禁止重叠、迎面交换及同一时间步跟车进入 |
| 异常 | 机器人故障、修复、通道封锁/解除、主动重规划、等待事件 |
| 可观测性 | 完整状态、递增事件序号、占用热力图、吞吐/耗时/利用率/距离/等待 KPI |
| 回放 | 固定随机种子、命令记录、同版本确定性重放 |
| 接口 | Rust library、持久 JSON Lines 子进程、可选 HTTP/SSE 桥 |

## 文件导航

- `src/map.rs` / `src/model.rs`：地图和领域数据结构。
- `src/planner.rs`：A*。
- `src/sim.rs`：仿真、调度、冲突防护、故障恢复与指标。
- `src/tools.rs` / `src/main.rs`：工具命令、CLI、回放。
- `docs/API.md`：A/C 对接协议、返回格式及示例。
- `schemas/command.schema.json`：命令 JSON Schema。
- `docs/B_HANDOFF.md`：设计约定、测试、限制及分工交接。
- `examples/agent_client.py`：A 同学可复用的 Python 子进程调用示例。
- `examples/scenario.jsonl`：取货后故障接运场景。
- `scripts/server.mjs`：仅用 Node 内置模块的 HTTP/SSE 桥。
- `tests/`：Rust 核心测试、CLI 与 HTTP/SSE 集成检查。

## 验证

Windows 可直接运行 `.\scripts\verify.ps1`，自动使用本机已有的 Node/Python（优先使用 Codex 附带运行时），执行全部检查。也可分别运行：

```powershell
.\scripts\dev.ps1 test --offline
.\scripts\dev.ps1 clippy
python .\tests\cli_smoke.py
node .\tests\http_smoke.mjs
```

Python 脚本仅使用标准库。CLI 测试会将回放和指标保存到 `output/`。
当前验证结果见 `docs/B_HANDOFF.md`。

本实现是可联调的仿真基线：不模拟电量、充电、加速度和真实机械取货；单车道对向堵塞可能需要 Agent 干预。
请先阅读交接文档中的货物接运、时间步及冲突模型约定，再进行 A/B 策略比较。
