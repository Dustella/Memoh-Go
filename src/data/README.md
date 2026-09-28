# 数据适配

由 bootstrap 创建，依赖 core 的接口与语义。

- remote：传输、DTO 校验、认证附加、能力/版本映射；不要记录凭据或完整私有正文。
- local：SQLite schema、迁移、复合 scope 键、事务和本地用户状态。
- repositories：实现领域读取/写入接口，不含 UI；业务实体、删除标记和 checkpoint 需要一次事务时，不拆成各自提交的仓储调用。

持久历史和实时投影不是两套竞争的聊天真值。契约未确认的能力明确标记为不支持或未知，不能用空数组、假成功填补。

## local（已实现）

| 文件 | 内容 |
| --- | --- |
| `local/sql.ts` | `SqlDatabase` 端口；设备用 expo-sqlite，单测用 Node 内置 SQLite（`tests/support/nodeDatabase.ts`），同一套 SQL |
| `local/expoDatabase.ts` | expo-sqlite 适配：WAL、外键、独占事务，打开即迁移 |
| `local/migrations.ts` | 只追加的迁移表；`PRAGMA user_version` 与迁移同一事务提交；文件版本高于本构建 → `UnsupportedSchemaError`，不触碰文件 |
| `local/conversationStore.ts` | Bot、会话、持久历史 turn、历史 checkpoint、实时投影 checkpoint |
| `local/outboxStore.ts` | 发送队列；payload 不可变；冷启动把 `sent` 改为 `unconfirmed` |
| `local/userStateStore.ts` | 草稿、阅读锚点、服务端能力缓存、按 scope 清除（登出） |

规则：

- 所有 Team 数据表的主键都包含 `scope`（部署 + 账号 + Team）。
- `turns` 只存服务端已持久化的 turn（必须有 `turn_position`）；运行中的 turn 只在 `runtime_checkpoint`，冷启动仅用于立即显示，仍需重新订阅并采用新快照。
- 一页历史、其 checkpoint、以及因此结算的 Outbox 条目在同一事务写入；最新页与缓存无重叠且之前还有更早历史时，替换缓存而不是留下空洞。
- 设备端自检：开发构建打开 `memoh://db-selftest`（独立的 `memoh-go-selftest.db`），强杀后再打开可验证跨进程恢复。
