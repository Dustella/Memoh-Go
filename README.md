# Memoh 移动客户端：项目讨论与规划

目前已从产品与架构讨论进入工程基线与真机风险验证阶段：保留既有目录分层、四区导航占位页面和共用 `PlaceholderScreen`，并初始化 React Native + TypeScript + Expo development build 配置。Android 原生构建、实体机安装、Metro LAN、四区导航、系统返回、安全区和键盘自动化冒烟均已通过；业务功能尚未实现。暂用 Memoh 移动客户端称呼本项目，目录名 `Memoh-Go` 不代表采用 Go 编写客户端。

已确认的方向：**React Native + TypeScript + Expo development build**；Android 优先、架构兼容 iOS；手机首版固定竖屏，横屏与平板后置；交付可安装的 App；首页兼顾深入聊天与并行任务；客户端可以与 Memoh maintainer 协作增加服务端协议。Vue Lynx 本轮不采用，不再安排候选验证。

建议按以下顺序阅读：

1. [产品方向、技术选型与阶段计划](docs/01-product-and-stack.md)：已确认的技术栈、选择依据与阶段计划。
2. [Memoh 仓库调查](docs/02-upstream-investigation.md)：当前已经具备的能力、限制和源码依据。
3. [同步与恢复协议草案](docs/03-sync-contract.md)：弱网、后台、进程终止、幂等发送与 Team 边界。
4. [移动端交互草案](docs/04-mobile-interaction.md)：首页、会话、待处理事项、产物与设置。
5. [当前 Electron 功能盘点](docs/05-current-feature-inventory.md)：基于已登录客户端实地检查的主要功能、入口与能力状态。
6. [移动端功能分区与执行环境设计](docs/06-mobile-feature-areas.md)：第二轮四区导航建议，Files、Memory、Computers 与 Workspace 的移动设计。
7. [项目架构与目录约定](docs/07-project-architecture.md)：分层、状态归属、同步协调器、平台适配、目录职责与实施顺序。
8. [移动端实施优先级](docs/08-implementation-priorities.md)：Now / Next / Later 排序、阶段门槛与最近里程碑。

文档更新：2026-09-13，持续讨论稿。技术栈和可靠恢复目标已由用户确认；交互方案、功能优先级和新增协议仍为提案，不代表上游已经实现。当前代码是可编译的工程基线与静态架构占位，尚无业务能力。

第一轮阅读 `../Memoh` 与公开一手资料；第二轮通过用户提供的 CDP 检查已登录 Electron 界面；第三轮建立架构骨架；第四轮基于 Expo SDK 57 初始化 development build 配置并整理实施优先级。没有修改上游或发布内容。当前没有 Vault 功能，也不在计划中新增这一概念。后续开发者应先阅读各文档的状态与验收条件。

## 当前目录骨架

- [src](src/README.md)：路由、功能模块、应用服务、纯 TS 核心、数据和平台适配。
- [contracts](contracts/README.md)：与上游确认契约的预留位置，尚无定稿 SDK。
- [tests](tests/README.md)：协议、恢复、持久化、真机和性能验证的预留位置，尚无测试实现。
- [PlaceholderScreen](src/ui/components/PlaceholderScreen.tsx)：四个主入口复用的静态页面占位组件。

## 本地启动

```powershell
npm install
npm run typecheck
npm run doctor
npm run android:device
```

`npm run android:device` 会生成并安装 development build，需要 Android SDK、adb、启用 USB 调试的实体机或模拟器。尚未准备 Android 工具链时，可用 `npm run web` 做路由与静态页面冒烟；Web 仅是开发验证入口，不改变“交付原生 App、不是 PWA”的产品决定。

当前已完成依赖安装、Expo 兼容检查、TypeScript 检查、Android 原生构建、实体机安装、四区导航、系统返回、安全区和键盘自动化冒烟。SQLite、SecureStore 与 AppState 恢复探针已通过真机后台、强制终止和冷启动验证；真实中文 IME 候选词组合测试因当前设备未安装中文输入法而保留为人工复核项。iOS 编译尚未验证。不要把占位页面视为已实现功能。下一阶段先对齐上游移动协议契约，再完成长文本与流式渲染基准。
