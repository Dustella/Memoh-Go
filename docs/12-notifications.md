# 12 · 后台通知方案（NT-02 / U10）

状态：建议稿，2026-09-29。需要维护者确认推送通道后才能实现 NT-02/NT-03。

## 现状（已核对源码）

- Memoh 服务端没有任何推送能力：全仓库搜索 `fcm|apns|firebase|webpush|device_token|push_notification|register_device|VAPID` 零结果。没有设备注册接口，也不存设备令牌。
- 实时送达只有两条：会话运行时 WebSocket 和 `sessions/events` SSE。两者都要求 App 在前台保持连接。
- 移动端现在能做的：前台时的应用内提醒（NT-01，已完成）。App 进入后台后，Android 会在几分钟内断开连接，之后什么都收不到。

## 约束

1. **很多用户的手机没有 GMS。** 开发用的测试机是小米 2206123SC（mayfly），国行 ROM 通常不带 Google 服务（未在该机上核实），FCM 收不到。只做 FCM 等于放弃这部分用户。
2. **自部署是主要场景。** 服务端不能假设能访问 Google，也不能要求运营者去申请各家厂商推送账号。
3. **推送内容不能带消息正文。** 与诊断日志同一原则：通知只携带 Bot、会话、事件类型和 ID，正文在 App 打开后通过已认证的连接读取。
4. **后台轮询不可靠。** `expo-background-task` 最短约 15 分钟一次，而且国产 ROM 会直接杀掉后台任务。只能作为补充，不能作为主方案。

## 方案比较

| 方案 | 覆盖 | 服务端工作 | 运营者负担 | 结论 |
| --- | --- | --- | --- | --- |
| A. FCM | 仅有 GMS 的设备 | 设备注册 + FCM 发送 | 需要 Firebase 项目与服务账号 | 作为可选通道 |
| B. UnifiedPush（ntfy 等分发器） | 任何 Android，含无 GMS | 设备注册 + 向分发器 URL 发 HTTP POST | 可自建 ntfy，或用公共实例 | **建议作为默认通道** |
| C. 厂商推送（小米/华为/OPPO…） | 对应品牌 | 每家一个适配器 | 每家单独申请 | 不做 |
| D. 后台定时拉取 | 不稳定 | 无 | 无 | 仅作兜底 |
| E. 不做后台通知 | — | — | — | 当前状态 |

UnifiedPush 与自部署最契合：服务端只需要对每个设备登记的 endpoint URL 发一个 HTTP POST，不绑定任何厂商；用户可以装 ntfy（或已有的分发器）接收。FCM 可以作为同一接口下的第二种通道，给有 GMS 的用户省去安装分发器。

## 建议的上游契约（U10）

- `POST /devices`：`{ platform: 'android'|'ios', channel: 'unifiedpush'|'fcm'|'apns', endpoint | token, app_version, locale }` → `{ device_id }`。按账号 + 设备幂等（带客户端生成的 `installation_id`）。
- `DELETE /devices/:device_id`：退出登录时调用；服务端在推送返回 404/410 时自动删除。
- `PUT /devices/:device_id/preferences`：按 Bot / 事件类型开关（NT-04，M5）。
- 触发事件：run 完成、run 失败、出现待审批、出现待回答问题。与 NT-01 的横幅同一组事件。
- 推送负载（加密可选，UnifiedPush 支持 Web Push 加密）：`{ v: 1, event, bot_id, session_id, run_id?, decision_id?, occurred_at }`，不含正文与标题。
- 去重：客户端按 `(session_id, event, run_id|decision_id)` 去重；同一会话在 App 前台且正在查看时不显示系统通知。

## 客户端计划

1. NT-02：注册 UnifiedPush 分发器（需要原生模块，重建开发客户端）；收到负载后用本地 i18n 生成通知文案（“Kitty 回复完成”），Bot 名称来自本地缓存。
2. NT-03：点击通知 → `memoh://chat/<bot>/<session>?focus=latest`，与首页“等你处理”的打开方式一致。
3. 旧服务端（没有 `/devices`）：设置页的通知开关显示“服务端不支持后台通知”，只保留前台提醒。能力按证据探测（404 即不支持），与 U4 相同。

## 需要决定

- 默认通道选 UnifiedPush 还是 FCM（建议 UnifiedPush 为默认，FCM 可选）。
- 是否由我起草 U10 的上游 PR（设备注册表 + UnifiedPush 发送器），做法与 U4 相同。
