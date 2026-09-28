# U4 丢失 ACK 后查询发送结果

## 现状

- 准入以 `(session_id, invocation_id)` 持久幂等（`internal/agent/runtime/session/admit.go`，ledger `ON CONFLICT DO NOTHING`）。
- 同一 `invocation_id` 且输入指纹相同 → 返回原 run，WS 回 `run_accepted{duplicate:true}`（无 cursor）。
- 同一 `invocation_id` 但输入不同 → `run_rejected{code:"session_invocation_conflict"}`，永不产生第二个 run。
- Session 忙（另一 run 活动）→ `run_rejected{code:"session_busy"}`，**未持久化**，可原样重试。
- ledger 有 `GetByInvocation(session_id, invocation_id)`（`ledger/postgres.go:520`），但 handlers 中没有任何路由暴露它（已 grep 确认）。
- `session_runs` 行无 TTL（**UNVERIFIED** 是否有外部清理任务）。

## 缺口

进程在“已发送、未收到 ACK”之间被杀，客户端只能重发，无法只读地询问结果；若会话在另一设备已进入新 run，重发会得到 `session_busy` 而非真实结果。

## 建议（服务端）

```ts
// GET /bots/:bot_id/sessions/:session_id/invocations/:invocation_id
interface InvocationLookupResponse {
  found: boolean;
  invocation_id: string;
  session_id: string;
  run_id?: string;
  turn_id?: string;
  turn_position?: number;
  state?: string; // accepted | running | waiting_decision | finishing | completed | aborted | failed | lost
}
```

在 U1 `features` 中以 `invocation_lookup` 声明。

## 客户端降级（当前实现）

Outbox 条目状态机：

```text
queued ──send──▶ sent ──run_accepted──▶ accepted ──(run 终态)──▶ settled
   ▲               │
   │           run_rejected(session_busy) / 断线 / 进程终止
   └───────────────┘   同 invocation_id 退避重发
                   run_rejected(session_invocation_conflict) ──▶ failed（不重试，提示用户）
```

- 条目在发送前落盘：scope、bot_id、session_id、invocation_id、不可变 payload（文本、附件引用、模型、位置）。
- 冷启动：所有 `sent` 条目回到 `queued` 并以**原 payload、原 invocation_id**重发；`duplicate:true` 即视为已准入。
- `session_busy` 退避重发（2s 起，上限 60s）；同时订阅快照，若快照 `current_run_view.invocation_id` 等于本条目 → 直接视为 accepted。
- 条目不因用户切换 Bot / Team 而改投目标；scope 不匹配的条目不投递。
- 有 `invocation_lookup` 能力时，冷启动先查询再决定是否重发。
