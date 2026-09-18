# A/C 同学对接协议 v1

## 传输与状态

Rust library 可直接使用 `Simulation` 与 `tools::execute`。命令边界会校验输入；Rust 直接调用方不得绕过接口修改公开字段来破坏状态约束。

CLI `logistics` 是一个持久进程。stdin 每行一个 UTF-8 JSON 命令，stdout 每行一个 JSON 结果，收到命令后立即刷新输出。
stderr 用于启动错误。每个进程独立持有一个世界；不要每次调用重新启动，否则状态不会保留。
空行忽略，UTF-8 BOM 可接受；非法输入返回错误后继续处理下一行。

成功：`{"ok":true,"tick":3,"data":{...}}`

失败：`{"ok":false,"tick":3,"error":{"code":"invalid_operation","message":"..."}}`

结构/解析错误的 code 为 `invalid_json`，无效操作为 `invalid_operation`。错误不推进时间，不部分修改业务状态。
仅 `step` 推进时间；`reset` 把时间、事件序号和指标重新归零。

## 命令表

每个命令必须有 `op`，不接受拼错或多余字段。完整机器可读约束见 `schemas/command.schema.json`。
位置统一为 `{"x":0,"y":0}`，左上角原点，x 向右、y 向下。
机器人、订单 ID 均从 1 开始；`reset.robots` 数组顺序决定机器人 ID。

| op | 参数 | data / 用途 |
| --- | --- | --- |
| get_state | 无 | `{world,kpis}` 完整快照 |
| get_kpis | 无 | 指标对象 |
| get_events | after（默认 0） | `sequence > after` 的事件数组 |
| reset | map, robots, seed | `{reset:true}`；替换世界 |
| add_order | pickup, dropoff, priority（默认 0） | `{order_id}` |
| generate_orders | count（0–1000） | `{order_ids}`；固定种子生成同连通分量内的端点 |
| set_strategy | strategy | `{strategy}`；nearest / balanced / manual |
| dispatch | 无 | `{assigned}`；立即按当前策略分配；manual 时不派单 |
| assign_order | robot_id, order_id | `{assigned:true}`；只能空闲机器人接待分配订单 |
| plan_path | start, goal, avoid（默认 []） | `{distance,path}`；纯地图路径，不默认避让机器人 |
| replan | robot_id, avoid（默认 []） | `{distance}`；替换当前任务路径，自动考虑其他机器人 |
| set_blocked | position, blocked | `{blocked}`；不能封锁机器人当前所在格 |
| inject_fault | robot_id | `{faulted:true}`；释放未完成任务、记录货物位置 |
| repair_robot | robot_id | `{repaired:true}`；恢复空闲 |
| step | ticks（1–10000） | 推进后的 KPI |

`avoid` 是本次规划的附加避让格；不是持久禁行区。持久封锁请用 `set_blocked`。
路径不含出发格，包含目标格；起终点相同时返回空路径。无法到达时返回错误。
`replan` 失败时保留原路径，移动安全检查仍会阻止进入新障碍和其他机器人。

自定义地图示例：

```json
{"op":"reset","map":{"width":8,"height":5,"obstacles":[{"x":3,"y":2}],"blocked":[]},"robots":[{"x":0,"y":0},{"x":0,"y":4}],"seed":42}
```

地图宽高 1–256，机器人数量 1–64，初始位置必须可走且互不重合，订单总数最多 10000。
`add_order` 校验当前地图上的端点可达性；临时被机器人占用的端点可入队，等待派单或交付。
`generate_orders` 按可连通且不孤立的格采样，不承诺自动恢复所有拥塞。

## A 同学：Agent 控制

1. 启动持久 CLI，设置 `manual`，防止基线调度器和 Agent 同时派单。
2. 用 `get_state` 感知机器人和订单；工具调用映射到此文档命令。
3. 通过 `assign_order`、`replan`、`set_strategy` 等执行决策，再 `step` 推进。
4. 读取 `get_events` 并保存最后一个 sequence；下一次传入 after。
5. LLM 不可用时可切回 `nearest` 或 `balanced` 作为安全降级。

`manual` 只关闭自动派单；局部安全检查和阻塞后自动重规划仍运行。B 核心不包含 LLM 调用、Prompt 或 Agent 解释文本。
实际使用示例见 `examples/agent_client.py`。

## C 同学：HTTP 与 SSE

启动 `node scripts/server.mjs`，默认绑定 `127.0.0.1:8787`。可设置 `PORT`。
接口由一个持久 Rust 子进程支撑，所有请求按顺序执行，同一服务内的客户端共享世界。

| HTTP | 路径 | 行为 |
| --- | --- | --- |
| GET | /api/state | get_state |
| GET | /api/kpis | get_kpis |
| GET | /api/events?after=0 | 增量领域事件 |
| GET | /api/stream | SSE `snapshot` 事件，初次连接和每次成功修改后推送全量状态 |
| POST | /api/command | JSON body 为命令；需 Content-Type: application/json |

```javascript
const base = 'http://127.0.0.1:8787';
const stream = new EventSource(`${base}/api/stream`);
stream.addEventListener('snapshot', event => {
  const { world, kpis } = JSON.parse(event.data).data;
  // robots/orders 是以 ID 字符串为键的对象；绘图可用 Object.values(world.robots)。
  // world.heatmap[y][x] 为累计占用时间步数。
  renderWarehouse(world, kpis); // 接入 C 同学自己的渲染函数
});
await fetch(`${base}/api/command`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ op: 'step', ticks: 1 })
});
```

动画应逐次调用 `step:1`，等待上一次返回再推进；`step:100` 只广播最终快照，不会推送 100 帧。
SSE 重连返回最新快照；历史事件通过 `get_events` 补取，不使用 Last-Event-ID 回放。
`reset` 后清除前端缓存的事件游标。快照 world 中包含 map、robots、orders、tick、strategy、events、heatmap 及回放随机状态。

领域事件字段：`sequence,tick,kind,robot_id,order_id,detail`。
kind 包括 `order_created`、`order_assigned`、`order_picked_up`、`order_completed`、`path_replanned`、`map_changed`、`robot_faulted`、`robot_repaired`、`robot_waiting`。
机器人逐格动画使用快照位置，领域事件不为每次移动单独写一条日志。

HTTP 成功为 200，命令错误为 400，内容类型错误为 415，请求体上限 64 KiB，SSE 最多 16 个连接。
服务只接受 localhost / 127.0.0.1 的本地网页来源，支持本地前端开发端口。
JavaScript 桥的输入整数必须在安全整数范围内（包括 seed 不超过 9007199254740991）；Rust CLI 可接受完整 u64 seed。快照中的内部 rng 状态不用于前端决策，精确回放应使用 Rust CLI 录制文件。
本地桥没有身份认证、持久存储或多租户隔离，不应直接部署到公网。

## 指标定义

| 字段 | 定义 |
| --- | --- |
| throughput_per_100_ticks | 累计完成订单数 / 已运行 tick × 100 |
| average_completion_ticks | 已完成订单的 `completed_at-created_at` 均值，包含排队 |
| utilization | 所有机器人的有任务时间步 / (机器人数量 × tick)；含因拥塞等待，不含故障停机 |
| total_distance | 所有机器人实际移动格数 |
| total_wait_ticks | 有任务但该 tick 无法移动且未完成任务的累计等待 |
| pending_orders / active_orders | 待分配 / 已分配及运输中的订单数 |

tick=0 或尚无完成订单时相关比率返回 0，不返回 NaN。
`heatmap[y][x]` 在每步结束采样一次，包含空闲和故障机器人，是占用图，不等同于纯拥塞图。
