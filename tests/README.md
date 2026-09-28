# 验证

当前没有自动化测试实现。App 构建与真机验收（P0.2/P0.3）已通过，记录见 [HANDOFF](../docs/HANDOFF.md)。静态占位页面不添加无意义快照测试。

按需创建以下子目录，不预建空目录：

- contracts：真实脱敏响应校验、能力与协议版本映射。
- sync：确定性事件源与故障场景，覆盖恢复、去重、状态隔离。
- integration：真实 SQLite 事务/迁移、附件与 Outbox 恢复。
- e2e：Android/iOS 平台行为和关键用户流程。
- performance：长历史、流式和多会话的夹具、release 真机结果。

验收依据为 [同步契约矩阵](../docs/03-sync-contract.md)与[技术计划](../docs/01-product-and-stack.md)。本机已登录 Electron 和生产数据不是故障注入目标；使用独立测试部署。

测试框架随路线图 PF-02 选定（见 [路线图](../docs/09-roadmap.md)）。
