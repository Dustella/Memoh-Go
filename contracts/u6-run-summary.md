# U6：Team 内跨 Bot 的运行摘要 / 待处理聚合

状态：服务端无此接口；移动端使用有上限的逐会话订阅回退（M3）。源码依据：Memoh `3e45c438`。

## 服务端现状

- runtime WebSocket 按 Bot 连接、按 **会话** 订阅（`runtime_subscribe{session_id}`，见 [runtime-ws.md](runtime-ws.md)）。没有“订阅整个 Bot / Team 的运行状态”。
- `GET /bots/:bot_id/sessions`（及分页版）按 `updated_at DESC` 排序，每条只有 `id/title/type/created_at/updated_at` 等元数据，**不含运行状态**。`updated_at` 在消息落库时前移（开发栈实测：同一会话新消息后从 00:47 变为 02:54）。
- `GET /bots/:bot_id/sessions/events`（SSE）在消息落库时发 `session_touched{session_id, updated_at}`，同样不含运行状态、待审批或待回答。
- 账本已有按 Bot 查询活跃 run 的实现：`internal/agent/runtime/session/ledger/postgres.go` 的 `ActiveRunsByBot`（SQL `ListActiveSessionRunsByBot`），目前只被会话重置流程调用（`session/reset.go`），没有 HTTP 入口。

## 移动端回退（已实现）

代码：`src/core/home/home.ts`（纯函数）、`src/application/conversation/homeService.ts`、`src/data/local/homeStore.ts`。

1. 首页聚焦时刷新 Bot 列表和每个 Bot 的最新会话页（最多 20 个 Bot）。
2. 选出最多 **8** 个会话实时订阅：已知在运行或有未发送消息的优先，其次是 30 分钟内活跃的会话。复用 `LiveSessionPool`，与聊天页、后台发送共用同一连接和状态。
3. 其余会话使用本机上次保存的运行状态（`runtime_checkpoint`），在“正在运行”中标注“上次状态”。
4. “新结果”= 会话 `updated_at` 晚于本机上次打开该会话的时间（`session_seen` 表）。首次打开首页时记录基线，基线之前的活动不算新结果，避免把全部历史标成未读。
5. 首页离开焦点即停止订阅；不做后台常驻轮询。

已知缺口：未被订阅、也没有本机保存状态的会话，其待审批 / 待回答不会出现在“等你处理”里，直到它进入订阅集合或用户打开它。首页底部如实提示“实时跟踪 N 个会话（上限 8），其余显示本机保存的状态”。

## 建议的服务端改动

最小：暴露已有查询。

```
GET /bots/:bot_id/runs/active
200 { "items": [ { "session_id", "run_id", "turn_id", "status", "updated_at",
                   "pending_decisions": { "approvals": n, "user_inputs": n } } ] }
```

- 权限：与会话列表一致，只返回调用者可读的会话。
- 只含状态与计数，不含消息内容。

更好：Team 级聚合 `GET /runs/active`（所有可读 Bot），首页一次请求即可；再配一个 SSE 事件 `run_state_changed{bot_id, session_id, status, pending_decisions}`。

有了任一接口，移动端改为：用它决定“正在运行 / 等你处理”，逐会话订阅只用于打开的会话；能力通过调用结果判定（404/405 视为不支持，保持当前回退），不按版本号推断。
