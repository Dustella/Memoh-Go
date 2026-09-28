# 与 Memoh 上游的契约

基准：上游 `felinics/Memoh` commit `3e45c438`（本地 `../Memoh`，只读调查，未运行服务端）。字段名均取自 Go `json` tag 与 `apps/web` 的 TS 镜像类型；未在源码中确认的内容标注 **UNVERIFIED**。

本目录不是 SDK。它记录：当前服务端事实、移动端缺口、建议的最小服务端改动，以及上游未落地时客户端的降级实现。客户端代码以这里为准，`src/data/remote/wire.ts` 与本目录保持一致。

## 页面

| 文件 | 内容 |
| --- | --- |
| [runtime-ws.md](runtime-ws.md) | WebSocket 连接、消息目录、epoch/seq 规则、可靠请求 |
| [u1-discovery.md](u1-discovery.md) | U1 能力发现与版本 |
| [u2-auth.md](u2-auth.md) | U2 登录、续期、WS 鉴权 |
| [u3-history-live.md](u3-history-live.md) | U3 历史与实时投影的交接 |
| [u4-invocation-lookup.md](u4-invocation-lookup.md) | U4 丢失 ACK 后查询发送结果 |
| [u5-session-create.md](u5-session-create.md) | U5 首次建会话的幂等 |
| [fixtures/](fixtures/) | 由类型推导的脱敏样例（**derived**，非真实抓包） |

## 差距总表

owner 均待 maintainer 认领；“降级”列是客户端在服务端改动前的实际实现，M2 以降级模式也能交付，但 UI 不宣称完整长离线保证。

| ID | 现状 | 缺口 | 建议服务端改动 | 客户端降级 | 阻塞 |
| --- | --- | --- | --- | --- | --- |
| U1 | `GET /ping` 返回 `version`、`commit_hash`、少量后端标志 | 无客户端能力矩阵、无最低客户端版本 | `/ping` 增加 `api_version`、`features[]`、`min_client` | 按 `version` + 探测结果推断能力；未知能力隐藏 | M2 |
| U2 | `POST /auth/login`、`/auth/refresh`；24h JWT，refresh 需未过期 token | 无 refresh token / 设备会话；无服务端注销 | 可撤销的设备 refresh token + `/auth/logout` | 前台/启动时剩余 < 25% 即续期；过期后要求重新登录，保留本地数据 | M2 |
| U3 | 运行中的 turn 只在 WS 快照中；结束后才进入 `GET /messages` | 无 HTTP 快照、无 committed-through 标记 | `GET .../sessions/:id/runtime-snapshot` | 订阅快照 + 拉最新历史页，按 `turn_id` 合并（见 U3） | M2 |
| U4 | ledger 有 `GetByInvocation`，handlers 未暴露 | 进程被杀后无法问“发送是否已准入” | `GET .../sessions/:id/invocations/:invocation_id` | 同 `session_id` + 同 `invocation_id` 重发，依赖 `duplicate:true` | M2 |
| U5 | REST 与 WS 首发建会话都不幂等 | 重试会产生重复会话 | 建会话接受 `client_request_id` 唯一键 | 先 REST 建会话并持久化 id，再发送；永不使用空 `session_id` 的 WS 捷径 | M2 |

结论：U1–U5 都有可实现的降级，M2 不被上游阻塞；U3/U4 的服务端改动能显著降低恢复成本，优先提给 maintainer。

## 其他已确认事实（影响设计）

- `GET /bots` 不分页，返回 `{items}`；`GET /bots/:bot_id/sessions` 为 `(updated_at,id)` 降序 keyset，`limit` 1..200，返回 `{items,next_cursor}`。
- 历史 `GET /bots/:bot_id/messages?session_id=&limit=&before_message_id=` 返回 `UITurn[]`，默认最新 30 条、页内旧→新，页首按 turn 对齐；排序键是 `turn_position`。
- `GET /bots/:bot_id/sessions/events`（SSE）只用于列表排序提示：`session_touched`、`session_created`、`session_title_changed`、`dropped`、`ping`；不含正文。
- steer / follow-up 有 REST 队列端点，`GET .../queue` 返回 `steer_supported`。
- WS 无协议心跳（**UNVERIFIED** 是否有反向代理层心跳）；客户端需自行检测半开连接。
