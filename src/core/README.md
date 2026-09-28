# 纯 TypeScript 核心

预留目录，无领域类型或协议实现。这里表达必须稳定且可独立验证的语义：

- identity：部署、账号、Team、Bot、Session 和执行目标的复合身份。
- conversation：消息/turn/内容块、历史版本与 live 交接。
- execution：Run、Decision、服务端队列与操作目标的有效性。
- operations：客户端 Outbox、不可变操作意图、unknown/accepted 等结果。
- sync：epoch/seq、持久 cursor、快照/增量恢复规则与状态转换。
- ports：application 所需的存储、传输、凭据、时钟等最小接口。

禁止依赖 React、RN、Expo、SQLite、路由或网络库。不按桌面设置菜单创建领域类；普通配置不必拥有复杂领域模型。提案协议名称尚未定稿，不要从目录推断服务器已提供某个接口。

[协议语义](../../docs/03-sync-contract.md)优先于临时 mock 的便利。
