# 客户端源码骨架

当前有四个静态占位页面、路由布局和共用组件；其他目录只声明职责。根目录已提供 Expo、Expo Router、TypeScript strict 与 development client 配置，可安装依赖并启动工程；业务、持久化和同步尚未实现。

架构与依赖边界以 [项目架构](../docs/07-project-architecture.md) 为准。初始化 Expo 时保留这些目录，在临时参考工程中确认 SDK 组合后合并配置；不要覆盖已有文档与源码。

- app：路由，不放普通模块或 README。
- bootstrap：组装应用服务和基础设施。
- features：按用户功能组织的展示层。
- application：命令、查询与同步编排。
- core：不依赖 React/Expo 的语义与接口。
- data：协议、数据库和仓储实现。
- platform：原生系统能力适配。
- ui：无业务含义的共用展示。

目标目录结构见 07；尚未实现的模块不预建空目录，首次落代码时再创建。
