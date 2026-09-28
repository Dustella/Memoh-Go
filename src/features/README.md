# 功能展示层

页面、业务组件、hooks 和表单按功能放置，通过 application 发出命令、订阅读模型。普通功能内部不访问 token、SQLite、HTTP 或 WebSocket。

| 目录 | 职责 |
| --- | --- |
| home | 跨 Bot 摘要、待处理、继续会话 |
| sessions | 会话目录、搜索和文件夹 |
| chat | 会话正文、输入、工具过程、决策/队列展示、阅读锚点 |
| resources | 文件与环境的聚合入口 |
| management | 管理功能的聚合入口 |
| bots | Bot 详情、默认行为、Agent、工具和访问策略 |
| files | 文件浏览、附件、产物阅读、上传下载与分享 |
| memory | Bot 长期记忆内容与索引状态 |
| environments | Computers、运行时 Workspace、能力和运维入口 |
| automation | Schedule 与运行记录 |
| access | 部署接入、登录、账号与 Team 切换 |
| settings | 团队/成员/用量、能力服务、外观和诊断 |

仅 home、sessions、resources、management 有静态占位页面；其他目录未实现。复杂配置先在所属模块内细分，不为每个表单创建顶层模块。

跨页面操作（例如首页与聊天里的审批）使用同一个应用用例。需要跨功能复用的领域组件通过明确公开入口提供，禁止相互深层引用。详见 [架构说明](../../docs/07-project-architecture.md)。
