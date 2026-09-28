# Memoh 仓库调查

日期：2026-09-12。对象：本地 `C:/Users/Dustella/Projects/Memoh`。

调查基准 commit：`3e45c438e2d79657ab807d9e371c86177504e9bb`。调查开始时 `git status --short` 无输出。本文是源码与文档调查，未部署后端、未运行既有测试，也未审计未提供的 Memoh Cloud 仓库。

文中“存在”指在此代码快照中有对应实现；不自动代表用户 Linux 部署已升级到该 commit，也不代表实机或线上行为已经验证。

后续补充：第二轮已检查用户登录的 Electron v2026.9.5-1，实际观察到 Team、Members、Usage、Billing 等产品界面，见 [客户端盘点](05-current-feature-inventory.md)。这补充了本轮未覆盖的产品证据，不改变本文件对 OSS commit 的调查范围；Cloud 正式协议仍未取得。

## 对规划最重要的结论

1. 会话运行与 WebSocket 已经解耦；关闭客户端连接不应终止 Agent run。
2. 已有 `invocation_id`、`run_id`、`turn_id`、`decision_id`、`control_id`，应复用这些身份。
3. WS 订阅带 `epoch + seq`，支持权威快照、增量、丢失信号；当前不按 cursor 回放历史运行事件。
4. 已有 durable admission / session run ledger，不能把“服务端新增幂等”误写成从零开始。
5. 历史消息与实时运行投影是不同读路径，移动端需要它们之间有明确的同步边界。
6. Team schema 和成员关系已落入数据库，当前 OSS 运行配置仍使用默认单 Team。未来 Cloud 不能仅凭表结构臆测 API。
7. 已有远程 Runtime、workspace target 和 steer / follow-up 队列，应按能力接入，避免只做一个通用聊天壳。

## 能力与证据表

以下相对链接从本文件出发指向兄弟仓库；如目录不同，请按 commit 在上游查看相同路径。

| 领域 | 已确认实现 | 对移动端的含义 | 源码 |
| --- | --- | --- | --- |
| 登录 | `/auth/login`、`/auth/refresh`；返回 access token 与 expires_at | 有续期入口，但不能假定是独立 refresh token 的设备会话方案 | [auth.go](../../Memoh/internal/handlers/auth.go) |
| JWT | Authorization header 或 query token；refresh 读取有效 token 上下文 | 长时间休眠后 token 过期的行为需要协议完善；原生优先避免长寿命 token 出现在 URL | [jwt.go](../../Memoh/internal/auth/jwt.go) |
| 会话 | Bot 下创建、列表、详情、fork 等 | Bot 与 Session 都是独立实体，UI 应保留两层身份 | [session.go](../../Memoh/internal/handlers/session.go) |
| 对话传输 | `/bots/:bot_id/web/ws`；同一连接发送命令和订阅会话 | 一个 Bot 的 WS 可订阅多个 Session；跨 Bot 聚合另行处理 | [local_channel.go](../../Memoh/internal/handlers/local_channel.go)、[runtime_ws.go](../../Memoh/internal/handlers/runtime_ws.go) |
| 运行时观察 | `runtime_snapshot`、`runtime_delta`、`runtime_dropped` | 比无位置的 token 流更适合移动恢复 | [types.go](../../Memoh/internal/agent/runtime/session/types.go) |
| 提交幂等 | 相同 invocation 可返回既有准入；输入 fingerprint 冲突被拒绝 | 重传继续使用同一 invocation，不用文本或时间去重 | [admit.go](../../Memoh/internal/agent/runtime/session/admit.go)、[ledger/postgres.go](../../Memoh/internal/agent/runtime/session/ledger/postgres.go) |
| 控制命令 | abort、审批、用户输入响应含 run/decision/control 身份；控制可路由 owner | “停止中”与“已停止”必须区分；跨设备决策需处理竞争 | [runtime_ws.go](../../Memoh/internal/handlers/runtime_ws.go)、[useChat.ws.ts](../../Memoh/apps/web/src/composables/api/useChat.ws.ts) |
| 历史 | `/bots/:bot_id/messages?session_id=...` 返回 `UITurn[]`；支持向前分页 | 不应把 UI turn、底层 message、run 混成一个 ID | [message.go](../../Memoh/internal/handlers/message.go)、[uimessage.go](../../Memoh/internal/agent/view/uimessage.go) |
| 历史定位 | `/messages/locate` 以 external message ID 定位窗口 | 不能直接当成通用本地 turn/block 锚点定位 API | [message.go](../../Memoh/internal/handlers/message.go) |
| 会话活动 | Bot 下 `/sessions/events` SSE，主要带 touched、title 等元数据；溢出发 dropped | 可做刷新提示，不能代替可靠历史补差或跨 Bot 待处理收件箱 | [message_stream.go](../../Memoh/internal/handlers/message_stream.go)、[hub.go](../../Memoh/internal/chat/event/hub.go) |
| 输入队列 | steer、follow-up、查询、修改、取消、重排、提升；返回 steer_supported | 原生端按钮按实际 runtime 能力显示，不假设所有后端都支持 steer | [session_queue.go](../../Memoh/internal/handlers/session_queue.go) |
| Workspace target | Bot 下列出、绑定 remote runtime、切 primary 等 | “执行环境”与未来团队协作空间应区分 | [bot_remote_runtime.go](../../Memoh/internal/handlers/bot_remote_runtime.go) |
| 用户 Runtime | `/users/me/runtimes` 等，存在凭据与撤销管理 | 手机是控制端，无需承担远程运行机的职责 | [user_runtime.go](../../Memoh/internal/handlers/user_runtime.go) |
| Team 基础 | teams、team_members、team_id、RLS / 复合关系的迁移与测试 | 已有可对接的隔离基础，不能称为完全没有 Team 支持 | [0001_init.up.sql](../../Memoh/db/postgres/migrations/0001_init.up.sql) |
| OSS Team 运行范围 | DB 连接设定固定 DefaultTeamID | 不能靠客户端任意加 team header 就启用多租户 | [db.go](../../Memoh/internal/db/db.go)、[team/id.go](../../Memoh/internal/team/id.go) |

为分享提供固定版本入口：[上游 commit](https://github.com/felinics/Memoh/tree/3e45c438e2d79657ab807d9e371c86177504e9bb)、[运行时订阅实现](https://github.com/felinics/Memoh/blob/3e45c438e2d79657ab807d9e371c86177504e9bb/internal/handlers/runtime_ws.go)、[Team 迁移](https://github.com/felinics/Memoh/blob/3e45c438e2d79657ab807d9e371c86177504e9bb/db/postgres/migrations/0001_init.up.sql)。本地源码是本次事实依据，未另外证明该 commit 已被所有部署使用。

## 快照恢复的准确含义

`runtimeSubscriptions.subscribe` 明确说明：收到的 cursor 不用于选择回放位置，因为 live projection 后面没有 durable event log。服务端返回当前权威快照，再发送真实增量。

这不是自动判定为缺陷。只要当前运行快照完整、历史消息可靠且边界清晰，快照可以满足正确恢复；移动端主要需要避免频繁传输大快照，并补齐离线期间已经完成或修改的历史。

`Snapshot` 包含 `bot_id`、`session_id`、`epoch`、`seq`、`current_run_view` 等，不能将它解释为“整个 Session 历史”。runtime epoch 用于区分 live backend 重建前后的不同序列，不能跨 epoch 比较 seq 大小。

Web 的 [runtime-client.ts](../../Memoh/apps/web/src/store/chat/runtime-client.ts) 已做去重、顺序检查、缺口重订阅和批量 delta；[realtime.ts](../../Memoh/apps/web/src/store/chat/realtime.ts) 已处理首次快照与历史准备过程。移动客户端应研究并提取纯逻辑，不能假设现有前端毫无恢复设计，也不应照搬其浏览器生命周期。

## 幂等与手机进程终止

Web `useChat.ws.ts` 用进程内 `Map` 保存待确认可靠请求，重连时重发，并在 acceptance / control ack 后移除。这个机制覆盖同一 JS 进程内断线；它本身不能跨 App 被终止保存待确认命令。

移动端应把对应命令、scope、原始 payload、invocation/control ID 和确认结果持久化。上游 ledger 已有 `GetByInvocation` 等内部方法；是否暴露为客户端可查结果、如何覆盖首次创建 Session 的提交，需要共同定协议。

已有 Session Runtime 验收要求说明 ACK 应在准入持久化后返回，跨实例重复提交映射到同一 run/turn，owner 丢失进入可观察的 lost 状态。[正确性要求](../../Memoh/docs/design/session-runtime-requirements.md)、[黑盒验收说明](../../Memoh/internal/agent/runtime/session/acceptance/README.md)。这些测试覆盖存在，但本轮没有执行它们，不能声称“已通过验证”。

## Team、协作空间与运行环境

数据库有固定默认 Team `00000000-0000-0000-0000-000000000001`。这个值在不同自部署实例里相同，**所以本地缓存绝不能仅按 team_id 隔离**，还必须包含部署身份和账号身份。

当前 OSS DB 连接固定设 Team 上下文。Team 表与 RLS 是重要基础，完整 Cloud 的登录、成员目录、请求路由、切 Team、计费、权限撤销和资源归属仍需 maintainer 提供正式契约。

建议概念上分开：

- Deployment：连接的 Memoh 安装或 Cloud 服务边界。
- Account / Principal：登录主体。
- Team：授权和数据隔离边界。
- CollaborationSpace：未来产品层“协作空间”，仅是暂定客户端概念；若 Team 本身就是 Workspace，不额外强造一层。
- Bot：Agent 的配置与资源主体。
- Session / Thread：对话上下文与历史边界。
- Run：一次具体执行。
- WorkspaceTarget / Runtime：执行环境与资源，不等于团队空间。

## SDK 与界面复用

`@memohai/sdk` 位于 [packages/sdk](../../Memoh/packages/sdk/package.json)，REST 由 OpenAPI 生成；Pinia Colada 是可选 peer，并有独立导出路径。移动端可以优先复用 REST 类型与 fetch 客户端，但必须检查目标宿主的 fetch / header / 文件能力。

WS 联合类型与事件处理目前主要在 Web `useChat.ws.ts`、`useChat.types.ts` 及 chat store 模块中。建议上游提取框架无关的协议类型、schema、fixtures 和 reducer，再由 Web、移动端分别适配。OpenAPI 生成 SDK 不自动覆盖 WS 协议的语义。

`apps/web` 是 Vue 3；桌面端是 Electron 壳复用 Web 模块。仓库已有 [Web 移动壳计划](../../Memoh/docs/design/web-mobile-shell/PLAN.md)，其一屏一事、返回保留聊天的原则可参考；本项目是独立 App，不受该分支的 Dockview 实施约束支配。

## 建议与上游协作的差距清单

| 优先级 | 能力 | 当前判断 | 建议交付 |
| --- | --- | --- | --- |
| P0 | 历史与运行状态一致补齐 | 两条读路径存在，尚未建立移动所需统一 revision 契约 | 有版本的实体补差、快照边界、删除/修改语义 |
| P0 | 冷启动未知提交结果查询 | 幂等与内部 ledger 已有 | 对外查询 invocation/control 结果，定义保留期与首次建 Session 幂等 |
| P0 | 协议发现 | 本轮未确认统一 mobile discovery 契约 | 协议版本、身份、认证方式、恢复与资源能力声明 |
| P0 | 客户端本地恢复 | Web 有进程内恢复逻辑 | 移动 SQLite、outbox、锚点、生命周期实现；主要是客户端工作 |
| P1 | 跨 Bot 待处理与运行摘要 | 现有活动 SSE 不等价于可靠聚合 | 当前 Team 下授权范围的摘要/决策收件箱及补差 |
| P1 | 长期设备登录 | 现有 access token 续期 | 明确过期后登录流程；可增加可撤销设备会话/refresh token |
| P1 | 推送 | 在已查 handlers/spec 范围未发现通用移动设备注册与 APNs/FCM 闭环 | 设备注册、事件投递、偏好、去重与撤销；核对 Cloud 是否另有实现 |
| P2 | 完整 Cloud 接入 | 未获得 Cloud 仓库及正式接口 | 对齐 Team 目录、路由、权限与 Runtime 能力；不推测实现 |

这些是本项目所需能力的缺口判断，不是对整个 Memoh 平台的全面审计。上游已有实现时应收敛为扩展或复用，避免重复造协议。
