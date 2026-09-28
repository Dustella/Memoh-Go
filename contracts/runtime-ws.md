# Runtime WebSocket

来源：`internal/handlers/local_channel.go`、`internal/handlers/runtime_ws.go`、`internal/agent/runtime/session/types.go`、`internal/agent/view/uimessage.go`；Web 参考实现 `apps/web/src/composables/api/useChat.ws.ts`、`apps/web/src/store/chat/runtime-client.ts`、`runtime-projection.ts`、`realtime.ts`。

## 连接

- URL：`wss://<deployment>/bots/{bot_id}/web/ws`，一条连接可订阅同一 Bot 的多个 Session。
- 鉴权：`Authorization: Bearer <jwt>`，或 `?token=`。**移动端只用 header**（原生 WS 可设 header，避免 token 进日志）。
- 打开连接需要 `workspace_exec` 或 `manage` 权限。
- 断开只结束订阅，运行中的 run 继续在服务端执行。
- 无应用层心跳。客户端：应用回前台时主动重连并重新订阅；空闲时靠 OS 断连信号 + 退避重连（1s ×1.5，上限 10s）。

## 客户端 → 服务端

| type | 必填 | 可选 | 幂等键 |
| --- | --- | --- | --- |
| `runtime_subscribe` | `session_id` | `cursor{epoch,seq}`（仅上报，不用于回放） | — |
| `runtime_unsubscribe` | `session_id` | — | — |
| `message` | `invocation_id` | `session_id`、`text`、`attachments[]`、`model_id`、`reasoning_effort`、`workspace_target_id` | `invocation_id` |
| `retry_message` | `invocation_id`、`session_id`、`turn_id` | 模型/位置 | `invocation_id` |
| `edit_message` | `invocation_id`、`session_id`、`turn_id`、`text` 或 `attachments` | 模型/位置 | `invocation_id` |
| `abort` | `run_id`、`session_id`、`control_id` | — | `control_id` |
| `tool_approval_response` | `run_id`、`session_id`、`decision_id`、`control_id`、`decision`（`approve`/`reject`） | `option_id`、`reason` | `control_id` |
| `user_input_response` | `run_id`、`session_id`、`decision_id`、`control_id` | `answers[]`、`canceled`、`reason` | `control_id` |

`/steer …`、`/queue …` 前缀的 `message` 会被当作命令；移动端改用 REST 队列端点，发送普通文本时不以 `/` 开头即可（以 `/` 开头的用户文本需确认转义方式，**UNVERIFIED**）。

## 服务端 → 客户端

| type | 关键字段 | 客户端处理 |
| --- | --- | --- |
| `run_accepted` | `run_id`、`invocation_id`、`session_id`、`turn_id`、`epoch?`、`seq?`、`duplicate?` | Outbox 条目 → accepted，记录 run/turn；`duplicate:true` 表示附着到既有 run，无 cursor |
| `run_rejected` | `invocation_id`、`code`、`message` | `session_busy` 可原样重试；`session_invocation_conflict` 终止，不重试 |
| `session_created` | `invocation_id`、`session_id` | 仅在使用空 `session_id` 时出现；移动端不走该路径（见 U5） |
| `error` | `message`、`invocation_id?`、`run_id?`、`code?` | 带 `invocation_id` 时同样结束该 Outbox 条目的等待 |
| `control_ack` | `control`、`control_id`、`applied`、`code?` | `applied:true` 成功；`applied:false` 且无 `code` = run 已结束，不重试；有 `code` = 未送达，可重试 |
| `runtime_snapshot` | `session_id`、`epoch`、`seq`、`snapshot` | 整体替换该 Session 的运行投影 |
| `runtime_delta` | `session_id`、`epoch`、`seq`、`delta` | 按序应用 |
| `runtime_dropped` | `session_id`、`epoch`、`seq` | 重新订阅，等待新快照 |

## epoch / seq 规则

`(epoch, seq)` 成对比较；`epoch` 是不透明字符串，变化即重置 `seq`。收到事件：

1. 未持有快照 → 只接受 `runtime_snapshot`，其余丢弃。
2. `epoch` 不同 → 重新订阅（恢复中）。
3. `seq <= 当前` → 丢弃重复。
4. `seq != 当前 + 1` → 缺口，重新订阅。
5. 否则应用 delta，`seq` 前进。

快照：同 epoch 且 `seq <= 当前` 时丢弃，否则整体替换。**永不依赖持久 cursor 恢复**：冷启动后一律重新订阅并等待快照。

## Delta 语义

- `current_run_view`：整体替换 run view。
- `run`：标量补丁（status、error、updated_at）。
- `reset_messages`：清空 assistant 块。
- `message_upserts`：按 `id` 插入或替换整块。
- `message_appends`：按 `id` 追加 `text`/`reasoning` 的 `content`。
- `progress_appends`：追加到工具块 `progress[]`，可带新的 `input`。
- `user_turn_upserts`、`steer_turn_upserts`、`steer_turn_removals`：按 `turn_id` / `item_id`。

应用顺序与 Web `applyRunPatch`（`apps/web/src/store/chat/runtime-projection.ts:243`）一致，已对照源码核实：

1. `current_run_view` 存在则整体替换；否则基于当前 run view（无 run view 时整条 delta 无效）。
2. `run` 补丁仅在 `run_id` 相同时应用。
3. `reset_messages` 清空块列表。
4. `user_turn_upserts`（按 `turn_id`）、`steer_turn_upserts` / `steer_turn_removals`（按 `item_id`）。
5. `message_appends`：按 `id` **且** `type` 匹配追加；找不到则新建该块。
6. `progress_appends`：只作用于已有工具块。
7. `message_upserts`：按 `id` 或工具块 `tool_call_id` 匹配替换（保留原 `id`），否则新增。
8. 按 `id` 升序排序。

## Run 状态

活动：`admitting`、`running`、`waiting_decision`、`aborting`、`finishing`。终态：`completed`、`aborted`、`errored`、`lost`。终态后以 REST 历史为准（见 U3）。

## 可靠请求

Web 在内存中按 `invocation:<id>` / `control:<id>` 保存待确认请求，重连时原样重发，收到对应 ACK 删除。移动端相同规则，但保存在 SQLite Outbox（跨进程终止）。
