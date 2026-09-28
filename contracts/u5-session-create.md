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

## 客户端降级（当前实现）

两阶段：

1. 本地先创建草稿会话（本地 ID，状态 `creating`），持久化 `create_attempted_at` 与请求 payload。
2. `POST /sessions`，成功后把服务端 `id` 写回本地并转为 `ready`；此后发送才进入 Outbox（带服务端 `session_id`）。
3. 若建会话响应丢失（超时/进程终止）：不盲目重建。先 `GET /sessions?limit=5`，找 `created_at >= create_attempted_at - 5s`、标题匹配、且无历史的会话；找到则采用，否则再创建。
4. 永不使用空 `session_id` 的 WS 首发捷径。

标题：首条消息前 40 个字符（去换行）；服务端后续可通过 `session_title_changed` 事件更新。
