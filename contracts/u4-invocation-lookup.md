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

**进展**：PR [felinics/Memoh#1405](https://github.com/felinics/Memoh/pull/1405)（分支 `Dustella:feat/session-invocation-lookup`）已在 dev stack 实测并转为 Ready for review。实现与上面形状一致：未知 invocation 返回 200 `found:false`；鉴权与 `GetSession` 相同；只按路径中的 session 查询。合并后仍只对新版本服务端生效，客户端必须保留下方降级路径。

## 客户端降级（当前实现）

**不假设服务端有查询端点。** 已发布版本（≤ v0.20.0）都没有这条路由；v0.16.0 及更早连持久准入去重都没有（`run_accepted` 与 ledger 同在 #865 引入，首个版本 v0.17.0）。

Outbox 条目状态机（`src/core/operations/outbox.ts`）：

```text
queued ──send──▶ sent ──run_accepted──▶ accepted ──(run 终态)──▶ settled
   ▲               │  ╲
   │               │   run_rejected(session_busy) → 退避回 queued（未准入，重发安全）
   │               │   run_rejected(session_invocation_conflict) → failed
   │        断线 / 进程终止（ACK 丢失）
   │               ▼
   └──安全时── unconfirmed ──快照中看到同 invocation_id──▶ accepted
                   │
                   └── 无安全自动路径 → needsUser：由用户选择"重发"或"放弃"
```

ACK 丢失后按**已证实**的能力选择路径（`src/core/identity/capabilities.ts`、`src/core/operations/recovery.ts`）：

| 能力状态 | 做法 |
| --- | --- |
| 查询端点 `yes` 或 `unknown` | 调用查询：`found` → accepted；`not_found` → 重发；网络/5xx 在已证实时退避再查 |
| 查询返回路由 404（`{"message":"Not Found"}`）/405/501，或 200 但不是本 invocation 的查询结果（如代理回 HTML） | 记为 `no`，走下一行 |
| 查询不可用，但本服务端构建已回过 `run_accepted` | 用原 `invocation_id` 与原 payload 重发，服务端去重，`duplicate:true` 即 accepted |
| 两者都未证实 | **不自动重发**，标记 `needsUser`，由用户确认；期间订阅快照若看到该 run 仍自动结算 |
| 处理器 404 `{"message":"session not found"}` | 会话已删除 → failed |

- 能力只由证据开启：`/ping` 显式 `features`、查询成功、或收到 `run_accepted`。不解析版本号猜测。
- 能力按 `部署地址 | version | commit_hash` 缓存；服务端升级或降级后全部回到 `unknown`。
- 以上分类均已对 dev stack 实测（2026-09-28）：已知发送 → `found`，未发送 → `not_found`，已删除会话 → `session_not_found`，不存在的路由 → `unsupported`。
- `unconfirmed` 仍占据该会话的发送位，后续消息等待它结算，不会越过它发送。
