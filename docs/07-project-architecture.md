# 项目架构与目录约定

日期：2026-09-13。状态：基于已确认的 RN + Expo 技术栈、[功能盘点](05-current-feature-inventory.md)和[移动分区建议](06-mobile-feature-areas.md)提出的实施架构。目录与占位组件已保留，根目录已初始化 Expo development build 配置；业务功能仍未实现。四区导航仍可在交互讨论中调整。

## 总体选择

采用**单个 Expo 应用、按业务模块组织界面、共享应用服务与纯 TypeScript 核心**的结构。当前只有一个移动客户端，不引入 monorepo、独立 npm 包、微前端或插件宿主。Android 与 iOS 共用核心和大部分界面，平台差异集中在适配层。

Memoh 服务端继续在上游仓库开发；这里维护客户端需要的契约说明、适配器和测试夹具。不要在手机工程中复制 Agent Runtime，也不增加一个仅用于转发 API 的中间服务。推送 relay 如需建设，是后续独立部署议题。

组织代码的重点是：**导航能改，业务语义不跟着改；页面能销毁，同步和操作仍有确定的恢复路径。**

## 目录与依赖方向

```text
Memoh-Go/
├─ docs/                      产品、协议、架构与决策
├─ contracts/                 与上游对齐的契约说明和版本记录
├─ src/
│  ├─ app/                    Expo Router 路由与布局，仅做页面装配
│  │  ├─ _layout.tsx          根导航栈
│  │  └─ (tabs)/              首页 / 会话 / 资源 / 管理占位路由
│  ├─ bootstrap/              创建依赖、启动与销毁应用会话
│  ├─ features/               用户功能：页面、组件、hooks、表单
│  │  ├─ home/                并行任务与待处理聚合
│  │  ├─ sessions/            会话目录、搜索、文件夹
│  │  ├─ chat/                正文、输入、工具卡片、阅读锚点
│  │  ├─ resources/           文件与执行环境入口
│  │  ├─ management/          管理入口
│  │  ├─ bots/                Bot 详情和配置、Agent 选择
│  │  ├─ files/               浏览、附件、产物阅读与分享
│  │  ├─ memory/              Bot 的记忆内容
│  │  ├─ environments/        Computers、运行时 Workspace
│  │  ├─ automation/          Schedule 与执行记录
│  │  ├─ access/              部署接入、登录、账号与 Team 切换
│  │  └─ settings/            团队、能力服务、App 设置
│  ├─ application/            跨功能用例与可订阅读模型
│  │  ├─ commands/            发送、控制、上传等操作编排
│  │  ├─ queries/             本地读取与细粒度订阅
│  │  └─ sync/                应用级同步协调器
│  ├─ core/                   纯 TS 语义、状态转换、依赖接口
│  │  ├─ identity/            Scope 与资源身份
│  │  ├─ conversation/        Session、Turn、内容块与历史版本
│  │  ├─ execution/           Run、Decision、服务端队列、执行目标
│  │  ├─ operations/          本地 Outbox 与操作结果状态
│  │  ├─ sync/                epoch/seq、快照与持久同步边界
│  │  └─ ports/               持久化、传输、时钟等所需接口
│  ├─ data/                   协议与本地存储的实际适配
│  │  ├─ remote/              DTO 校验、HTTP/WS/SSE、版本映射
│  │  ├─ local/               SQLite、迁移、事务、附件元数据
│  │  └─ repositories/        领域读取和写入接口的实现
│  ├─ platform/               生命周期、凭据、系统文件、推送、诊断
│  └─ ui/                     通用展示组件、主题、无业务含义的交互
│     └─ components/          PlaceholderScreen.tsx
└─ tests/                     契约、恢复、性能、真机流程的预留位置
```

路由文件是薄入口；具体页面在 `features`。上图是目标结构；尚未实现的模块不预建空目录，首次落代码时按此创建。普通组件、测试、数据文件不放入 `src/app`，避免被路由系统识别为页面。Expo 支持顶层 `src/app`，项目配置仍应放根目录。[Expo 路由核心约定](https://docs.expo.dev/router/basics/core-concepts/)、[src 目录约定](https://docs.expo.dev/router/reference/src-directory/)。

允许的主要依赖如下，箭头表示 import 方向：

```text
app ───────────→ features ─────────→ application ─────→ core
 │                  └────────────→ ui                  ↑
 └─→ bootstrap ─→ application / data / platform         │
                                 data / platform ──────┘
```

- `core` 不 import React、React Native、Expo、SQLite 或 HTTP SDK。不使用隐式全局时钟/网络；确有需要时通过接口传入。
- `application` 编排用例，依赖 `core` 的语义与接口，不直接 import 具体 SQLite、网络或 Expo 实现。
- `data` 与 `platform` 实现接口，不反向依赖页面；协议 DTO 不泄漏给页面。
- `features` 通过应用服务发出操作、订阅读模型，不直接写数据库、创建 socket 或读取凭据。
- `bootstrap` 是组装例外：显式创建具体适配器并注入服务，不需要依赖注入框架。React Provider 只暴露稳定的服务引用，不承载每个 token。
- `ui` 不 import 业务功能；跨功能共享规则下沉到应用服务/核心。需要复用的领域卡片可由所属 feature 通过公开入口导出，不能互相深挖内部路径形成循环。

这不是要求每个 CRUD 都写六层空接口。复杂同步和操作需要清晰边界；普通设置可以由一个应用服务和一个适配器完成。新模块先有具体用例，再提取抽象。

## 状态由谁负责

| 数据或状态 | 归属与恢复方式 | 不允许的做法 |
| --- | --- | --- |
| 持久消息、Run、Decision、服务端队列 | 服务端权威；SQLite 保存有版本的本地副本 | socket 断开就把 Run 改成失败 |
| 持久同步 cursor / tombstone | 与对应实体在同一 SQLite 事务提交 | cursor 先前进，再异步写正文 |
| 实时未完成输出 | 按 Session/Run 的内存投影；可保存匹配的快照边界 | 把未落盘的实时 seq 当持久补差 cursor |
| 本地发送、待确认控制 | SQLite Outbox；保存不可变输入和原操作 ID | HTTP 超时后换 ID 再发一遍 |
| 草稿、阅读锚点、上次页面 | SQLite 中的本地用户状态，持续合适地保存 | 只在进入后台时保存，或重同步时一起清空 |
| 登录凭据 | 系统安全存储；数据库只存连接资料和凭据引用 | token 放到日志、路由参数或普通全局 store |
| 弹层、临时选中项、表单交互 | 页面局部状态；有恢复需要的表单再持久化 | 所有状态都进入一个全局 store |
| 服务目录等辅助查询 | 可选请求缓存，按完整 scope 分键 | 请求缓存和 SQLite 各自维护一份权威聊天历史 |

SQLite 是本地持久化基础，首选 `expo-sqlite`；事务必须使用已验证的 API 边界，不能假定所有异步写入自动属于正确事务。[Expo SQLite 事务说明](https://docs.expo.dev/versions/latest/sdk/sqlite/)。凭据首选 `expo-secure-store`，但安全存储不能代替服务器设备会话的撤销、刷新和恢复协议。[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)。

暂不引入 Redux。Zustand 如用于少量跨页展示状态，不承担聊天真值；TanStack Query 如用于普通配置查询，不承担 Run 恢复和 Outbox。两者都不是骨架的必装项。React 订阅通过细粒度 selector / external store 适配，具体库在首条纵切中决定。

## 同步是应用服务，不是页面副作用

`bootstrap` 在本地库就绪并解析登录上下文后创建活动 scope 的服务。`application/sync` 管理鉴权恢复、连接生命周期、持久补差、实时订阅、Outbox 核对与退避。`core/sync` 只负责可独立验证的状态转换、版本规则和恢复判定。

每个活动 scope 最多一个协调器。首版只维持当前 Team 的主动同步；其他 scope 可以保留隔离的缓存。将来确有跨部署聚合需求再增加多个协调器，不先为全部账号常驻连接。

恢复流程固定为：

1. 从本地加载原页面、草稿、锚点和已有内容，明确标记新鲜度。
2. 验证身份和服务器能力，执行 [同步契约](03-sync-contract.md) 中的恢复握手。
3. 在事务内合并持久变更及 checkpoint；按 epoch/seq 恢复实时投影。
4. 查询未确认操作，只有满足幂等和目标有效性契约时才重试。
5. 发布细粒度读模型更新，在原页面补齐内容。

页面只声明订阅需求：当前正文优先，后台会话保留摘要，离开会话降低订阅级别。页面卸载不会停止服务端 Run。连接状态、同步状态、操作状态与 Run 状态各自存在。

系统网络和前后台信号是触发核对的提示，不能证明服务器可达。进程被终止后无需保存 JS 协调器本身；从持久数据重建它。推送只引导同步和导航，不能直接改权威运行状态。

## Team、Bot、会话与执行位置

最低隔离键沿用协议草案：

```text
Scope = deployment_id + account_id + team_id
SessionKey = Scope + bot_id + session_id
ExecutionTarget = 明确区分的 cloud workspace / connected computer 引用
```

这些是客户端语义，不是新增 API 字段已定稿的声明。一个 Team 下存在多个 Bot；Bot 可以包含多会话并配置不同 Agent。模型和执行目标独立保留，不用一个 `agentId` 包揽所有选择。

建议首版每个 deployment/account 使用独立 SQLite 文件，同库内所有 Team 业务表带 scope 并通过复合键约束。文件名使用不含账号隐私的本地连接标识。账号级服务目录允许属于账号作用域，不能为了统一而伪造成某个 Team 的私有数据。数据库迁移与不支持的 schema 版本必须有失败恢复路径。

切换时停止旧订阅和发送 worker、递增连接 generation、打开新上下文。晚到响应在提交前核验 scope/generation；旧操作保留在自己的作用域，不能转投新 Team。通知和深链先完成身份与权限核验，再打开目标；来自错误部署的资源 ID 不能在当前部署下直接解释。

路由只携带定位引用，不携带整条消息或凭据。深链将来使用可解析的 scope 引用和资源键；精确 URL 形状留到登录与通知契约明确后决定。本轮没有创建无 scope 的假详情路由。

退出登录与暂时切换账号分别设计：普通切换可保留隔离缓存；退出清理凭据和该账号本地数据，无法确认的已发送操作不能被解释为服务端取消。重新登录通过服务端状态恢复，不能自动补发已被清除的草稿。

## 功能盘点如何落到模块

| 功能模块 | 覆盖范围 | 跨模块协作 |
| --- | --- | --- |
| home | 待处理、运行中、新结果、继续会话 | 消费应用层跨 Bot 摘要；审批与 chat 使用同一控制用例 |
| sessions / chat | 目录、搜索、会话正文、工具过程、输入、队列与决策 | 共用 conversation/execution；会话列表不持有所有正文 |
| bots | Bot 详情、默认模型/Agent、工具与访问策略 | Bot 是业务对象，配置页不承担 Runtime 生命周期 |
| files | 工作文件、消息附件引用、下载副本、预览和分享 | 来源保留 Bot、location、path、revision 或 asset 身份 |
| memory | Bot 的长期记忆内容与索引状态 | 全局记忆服务配置属于 settings，不能与内容 CRUD 混合 |
| environments | Computers、Cloud Workspace、能力与新鲜度、后续运维 | 停止环境、快照恢复有独立操作语义，不复用 Run 停止 |
| automation | Schedule、触发规则与执行记录 | 使用现有会话/Run 页面查看结果，不创建第二套聊天历史 |
| access | 连接资料、登录、账号与 Team 切换 | 调用上下文切换用例，不在按钮回调里自行清空全库 |
| settings | Team/成员/用量、Providers、Search/Voice/Video/Email、外观与诊断 | 区分 Team、账号、Bot 与本机设置；按资源能力显示 |

Platforms、Connectors、MCP、Skills、Hooks、Compaction、Access 等先在 `bots` / `settings` 内按用途分组；实际实现复杂后再拆子模块。Terminal、Browser、Desktop 暂列 `environments` 的后续入口，尚不建设远程交互子系统。

`resources` 和 `management` 是聚合页面，不各自复制一套文件、环境或配置数据。四区导航变化只需调整路由与聚合页，不重写核心模块。

## 长文本、附件与环境能力

聊天显示管线为：传输解码 → 校验/归并实时投影 → 合批通知 → 当前可见内容块渲染。持久变更按事务落盘，不要求每个 token 写数据库；未持久化的尾部必须能从运行快照或最终历史恢复。

虚拟化覆盖长历史和超长单条内容块。稳定 block/turn 身份与语义阅读锚点由 chat 维护；解析器和列表实现是内部可替换组件。已完成段落复用，可变尾部有限重算，结束时完整校正。普通 React Context 不广播整条流；首页不解析全部后台会话 Markdown。

附件发送先把系统选择结果保存到 App 管理的持久文件，再由上传用例产生服务器引用。文件内容放文件系统，SQLite 保存元数据、上传状态与引用。清理缓存不能删除未提交操作仍引用的附件。文件编辑后续必须加入版本冲突处理。

若后续允许 HTML 预览，隔离在专门阅读器；不能把账户 token 注入产物页面。核心聊天保持原生，复杂渲染按真实需求决定是否使用局部 WebView。

执行环境使用逐项 capabilities（文件、桌面、指标、配额、快照等）和带时间的状态。未知能力显示未知/待获取，服务端声明不支持时才显示不支持；缺失指标不能解释成零。能力展示不替代服务端鉴权。

## 协议演进与服务端边界

`data/remote` 处理上游 DTO 到客户端语义的映射。区分当前服务器的有限兼容模式与定稿移动协议的完整恢复模式；UI 使用能力和结果状态，不散落服务器版本号判断。

`contracts` 先保存经确认的契约版本、来源和脱敏样例。正式 OpenAPI/schema 可用后再生成 DTO；手写领域类型不直接复制生成类型。提案夹具必须标注 proposal，不能让 mock 测试掩盖服务器尚不支持的事实。

服务端优先补齐：持久补差、历史/live 一致边界、幂等准入与查询、设备会话/刷新、Team 聚合与权限、文件身份和环境控制语义。权威 ledger、鉴权和 Runtime 调度仍归上游，不在客户端构造替代品。

## 平台适配与依赖策略

- 导航使用 Expo Router：仅路由层依赖文件路由，业务代码不绑定 URL 结构。
- 本地库与凭据使用 Expo SQLite / SecureStore；P0.3 已通过 `expo install` 锁定 `expo-sqlite ~57.0.3` 与 `expo-secure-store ~57.0.4`，并以隔离的诊断表和安全记录完成进程终止/冷启动验证。P1 再把探针演进为正式 migration、scope 隔离、仓储与凭据引用。
- 生命周期、通知、文件选择/分享、键盘等平台能力通过薄适配接入。只在确有差异处使用 `.android` / `.ios` 实现，不复制两套业务。
- Expo development build 是开发与真机验证路线。当前使用配置驱动生成，`android` / `ios` 原生目录不提交；确需原生定制时重新评审。
- 保持一个包和一个锁文件。依赖按 Expo SDK 兼容表固定精确版本，不把每个包单独升级到 latest。
- iOS 从第一条纵切保留编译路径；需要 macOS/Xcode 或合适的构建环境验证，不能用 Android 成功替代。

## 验证与实施顺序

不为静态占位组件写无意义的快照测试。后续测试集中在值得防止回归的行为：

| 位置 | 验证内容 |
| --- | --- |
| tests/contracts | 脱敏真实响应、能力协商、DTO 映射、未知语义处理 |
| tests/sync | ACK 丢失、重复/乱序、epoch 变化、cursor 过期、历史/live 竞态、切账号晚到响应 |
| tests/integration | 真实 SQLite 事务、迁移中断、Outbox/附件持久化、重启恢复 |
| tests/e2e | Android 进程终止、后台恢复、键盘与返回、锚点、登录与权限变化 |
| tests/performance | 确定性长历史/高频增量/多会话夹具及 release 真机记录 |

Expo development build 已在 Android 实体机完成安装、四区导航、系统返回、安全区与键盘自动化冒烟；手机首版固定竖屏，横屏和大屏/平板布局后置。SQLite、SecureStore 与 AppState 探针也已通过后台、强制终止、冷启动和覆盖安装验证。真实中文 IME 人工验证因当前设备仅有英文 AOSP 键盘而保留为外部复核项。下一步先完成上游移动协议契约对齐与长文本/流式基准，再实施一条完整纵切：**连接与登录 → 本地会话 → 持久发送 → 流式输出 → App 被终止 → 恢复完整结果与原阅读位置**。接着加入多会话待处理、文件与环境，再扩展定时任务和配置。详细顺序见 [实施优先级](08-implementation-priorities.md)。

当前四个页面仍共用 `PlaceholderScreen`，没有假 Bot、假运行状态或模拟发送按钮。根目录已有 `package.json`、锁文件、Expo/EAS 配置和严格 TypeScript 配置；依赖兼容、类型检查、Android 原生编译、安装和当前真机行为均已验证。iOS 编译仍未验证。
