# U5 首次建会话的幂等

## 现状

- `POST /bots/:bot_id/sessions`：请求 `{title, type?, bot_agent_id?, workdir_id?, preferred_chat_model_id?, preferred_reasoning_effort?, …}`，响应 201 `Session`。无客户端 ID、无幂等键，每次调用都新建。
- WS `message` 在 `session_id` 为空时调用 `createWSChatSession`（`local_channel.go:2606`），同样无键；重发空 `session_id` 的首条消息会创建重复会话。准入幂等只保护会话已存在之后的 run。
- 会话列表：`GET /bots/:bot_id/sessions?limit=&cursor=&types=`，`(updated_at,id)` 降序。

## 缺口

弱网下“新建会话并发送”重试会留下空会话或重复会话。

## 建议（服务端）

- `CreateSessionRequest.client_request_id?: string`，唯一约束 `(bot_id, created_by_user_id, client_request_id)`；冲突时返回既有行（200）。
- WS 空 `session_id` 分支用 `invocation_id` 作为 `client_request_id`。
- 在 U1 `features` 中以 `session_client_request_id` 声明。

## 客户端降级（已实现，2026-09-29）

代码：`src/core/operations/sessionCreate.ts`（纯状态机）、`src/data/local/sessionCreationStore.ts`（schema v3 `session_creations`）、`src/application/conversation/sessionCreator.ts`（驱动）。

1. 先落盘意图：本地 `request_id`、首条消息、预先生成的首条 `invocation_id`，状态 `pending`。
2. `POST /sessions`（`creating`），请求体带 `client_request_id = request_id`：U5 服务端据此返回既有行；旧服务端忽略未知字段（开发栈实测 201 并丢弃该字段）。记录**首次**尝试时间 `first_attempt_at`。
3. 成功：同一事务内写入会话缓存、用服务端 `session_id` 建首条 Outbox 条目、意图转 `created`。之后才发送，崩溃不会留下“有会话无首条消息”或重复排队。
4. 响应丢失（超时、网络错误、5xx、401/408/409/429，或进程在请求中被杀）→ `unknown`，**不直接重发**。退避后 `GET /sessions?limit=20`，按以下条件找候选：标题相同、`created_by_user_id` 为本账号、`created_at >= first_attempt_at − 时钟偏差 − 5s`、未被本机其他意图占用；再逐个用 `limit=1` 历史探测，**无历史**才采用（我们的会话在采用前不可能有消息）。时钟偏差取列表响应的 `Date` 头。
5. 找不到 → 回到 `pending` 再 POST；最多 8 次后 `failed`。明确的 4xx → `failed`，用户可重试（从未发出过则直接 POST，否则先核对）或删除。
6. 冷启动时 `creating` 一律视为 `unknown`。意图在启动、登录状态变化与回到前台时恢复。
7. 永不使用空 `session_id` 的 WS 首发捷径。

已知残余风险：POST 超时（15s）后服务端才提交、而核对恰好在提交前完成时，会再 POST 一次形成空的重复会话。U5 服务端（`client_request_id`）可消除；旧服务端下概率很低，且重复的是空会话，不会重复执行任务。

标题：首条消息折叠空白后前 40 个字符（按码点，超长以“…”结尾）；服务端后续可通过 `session_title_changed` 事件更新。

验证：单元测试覆盖响应丢失、请求丢失、同名有历史会话不被采用、请求中进程被杀、4xx 重试/删除；模拟器实测飞行模式下发送 → 强杀 → 恢复网络冷启动，服务端该标题恰有 1 个会话，首条消息与回复各 1 条。
