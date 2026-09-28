# 当前 Electron 客户端主要功能盘点

调查时间：2026-09-12 至 2026-09-13。状态：实际界面盘点，移动端映射与优先级属于建议。

## 本次观察边界

通过用户提供的 `127.0.0.1:9333` CDP 连接已登录的 Electron；目标页面标题为 Memoh，地址为 `memoh-app://app/`。使用临时 Node CDP 脚本读取 DOM、操作导航和捕获截图，没有继续阅读应用源代码。

About 页面显示客户端 **v2026.9.5-1**，另提示有 v2026.9.12-1 更新；本次没有更新。About 底部另显示 `4cf262e`，未通过源码核对其含义。服务端精确版本未确认，不能把本次 UI 等同于上一轮本地 OSS commit 的界面。

本次登录环境实际展示 Team、成员、用量和 Billing 数据。因此这份记录补充了 [开源仓库调查](02-upstream-investigation.md) 未覆盖的产品界面；仍不能据此宣称已获得完整 Cloud API 契约。

主要操作是进入页面、展开菜单/详情、查看空白表单和打开一个 Markdown 文件标签。没有发送消息、创建 Bot/Agent/任务、保存设置、修改文件、安装工具、改变权限、停止或删除运行环境、创建/恢复快照。原始聊天、记忆正文、邮箱、Team ID、账单余额和连接凭据不写入本盘点。

最初 Electron 处于 hidden，部分动画与退出过渡暂停；用户将窗口置前后，重新检查了 Files、Workspace、Memory 及若干异常页面。DOM 中同时残留的后台页面与通知，不当成当前页面新增功能。截图用于布局核对，不以截图证明业务操作完成。

**名称更正：本项目没有既定的 Vault 定义；用户已明确 Memoh 当前没有 Vault 功能。本次不新增、不盘点，也不把 Files 或 Memory 改称 Vault。**

## 当前产品结构

实际导航主要有三层：

```text
聊天工作区
  Bot 切换
  Chat / Files / Schedule
  会话、文件与工具面板标签
  聊天输入：附件 / 执行电脑 / 模型与推理强度 / 语音

Bot 设置
  Overview / General / Platforms / Memory / Tool Approval
  Hooks / Agents / Connectors / MCP / Skills
  Desktop / Computers / Workspace / Network
  Compaction / Schedule / Access / Email

全局设置
  Bots / Computers / Supermarket
  Providers / Memory / Web Search / Voice / Video / Email
  Team / Members / Usage / Billing
  Appearance / Keyboard / Account / About
```

同名入口不一定属于同一作用范围。例如 Bot 的 Memory 是记忆内容管理，全局 Memory 是记忆后端配置；Bot 的 Computers 是这个 Bot 可用的位置，全局 Computers 管理连接的机器。

## 五个核心名词

| 名词 | 当前 UI 能确认的含义 | 移动端需要保留的区别 |
| --- | --- | --- |
| Bot | 有名称、状态、独立设置、文件、会话和记忆的主体 | 多会话所属对象，不等于一次执行 |
| Agent | Bot 可以添加的执行实现，添加表单列出 Codex、Claude Code、ACP；General 也显示内建 Memoh Agent | 不等于模型或电脑；可以沿用 Bot/Agent 字样并辅以说明 |
| Model | 聊天或任务选择的模型，可附带推理强度；内建 Memoh Agent 使用 Chat Model | 一个模型选择不代表改变执行环境 |
| Computer | Bot 可使用的工作位置，包括 Cloud Computer 与连接的其他电脑 | 要明确文件读写和命令运行在哪里 |
| Workspace | Bot 编辑文件、执行命令的隔离运行环境；有资源、快照和生命周期管理 | 与 Team、客户端面板布局和普通文件夹区分 |

实际聊天的 `Continue on` 菜单提供 Cloud Computer 和一台连接电脑；Bot Computers 页面同时列出这两者。可确认存在工作位置选择，未执行切换，不能推断切换会自动迁移文件、同步目录或迁移运行中的进程。

“workspace”在不同界面文案还有其他用法：Keyboard 的 workspace tab 指面板标签，Billing 的 workspace 指订阅语境。移动端建议使用“会话面板”“团队”“执行环境”等明确名称；实际 Cloud 对象关系还需与 maintainer 确认。

## 聊天、文件与自主任务

下表“界面已见”表示看到了相关内容或入口，不代表逐项执行功能测试。

| ID | 功能 | 本次实际观察 | 移动端建议落点 / 首版程度 |
| --- | --- | --- | --- |
| C01 | Bot 切换 | 左上角 Switch bot；当前工作区按 Bot 组织 | 顶部上下文选择器；会话页支持当前 Team 内按 Bot 筛选 |
| C02 | 会话管理 | New Chat、Folders、新建文件夹、Recents、会话搜索与 Session actions 入口 | 会话页；首版提供创建、搜索/筛选、最近会话，文件夹管理可后续 |
| C03 | 聊天正文 | Markdown、代码块、工具摘要、文件操作数量与 diff 计数、带执行位置的工具记录 | 核心聊天原生实现；过程折叠、详情展开 |
| C04 | 消息操作 | Copy、Edit、Try again、More 入口 | 长按与明确菜单；重试/编辑要对接原有 turn 语义，不只改本地气泡 |
| C05 | 文件产物 | 聊天中有 HTML、JSON、压缩包卡片，文件可与工作路径关联 | 聊天产物卡片 → 全屏查看 → 回原阅读位置；首版查看/下载/分享 |
| C06 | 输入设置 | 附件菜单、执行位置选择、模型与推理强度、Start voice input | 输入区操作面板；首版文本/附件/位置/模型，语音独立排期 |
| C07 | 多面板 | 顶部标签；New panel 菜单有 Terminal、Browser、Desktop、Split right/down | 手机使用栈导航；首版不移植桌面分屏布局 |
| F01 | 文件浏览 | Files 为当前 Bot 文件树，可见目录、Markdown 与 HTML 文件 | 资源 → 文件；独立完整页面，明确 Bot 与文件所在环境 |
| F02 | 文件管理入口 | New File、New Folder、Upload、Upload Folder、Select items、Refresh | 首版浏览/上传/下载；文件夹上传须转译为手机系统能力，不机械复制 |
| F03 | 单文件菜单 | Open、Open to the Side、Download、Rename、Delete | 打开/分享/更多；Open to the Side 改为全屏查看或返回聊天 |
| F04 | 编辑/预览 | 实际打开 Markdown 标签，存在 Open preview to the side；Keyboard 列出 Save active file | 首版阅读优先；编辑进入明确模式，后续做版本冲突检测 |
| S01 | 定时任务列表 | 主导航 Schedule 与 Bot Schedule 均有入口；当前为空 | 首页中的自动化入口及 Bot 详情；聚合视图为移动提案 |
| S02 | 创建定时任务 | 实际打开表单：任务名、启用、描述、执行指令、运行会话、模型、运行次数上限 | 移动全屏分步表单；首版日/周等常用频率与执行上下文 |
| S03 | 调度频率 | 频率菜单实际列出每 N 分钟、每小时、每日、每周、每月、Advanced cron | 常用频率直接选择；cron 收入高级项，展示时区和下次执行时间是建议新增的体验要求 |

当前没有运行中的用户任务和待审批样例，本次没有通过发送消息制造它们。因此不能把“跨会话待处理首页”“完整队列交互”“审批闭环”写成已经观察到的现有页面。其协议基础见上一轮源码调查，移动布局仍待设计与实现。

## Bot 设置

| ID | 功能 | 本次实际观察 | 移动端建议落点 / 首版程度 |
| --- | --- | --- | --- |
| B01 | Overview | Bot 状态、配置提醒、平台连接、Runtime 状态、资源统计、用量与记忆摘要 | Bot 详情首页；摘要与待处理入口优先 |
| B02 | General | URL name、语言、时区、默认 Agent、Chat Model、IM 工具调用展示、搜索/抓取/记忆和多媒体配置 | Bot → 默认行为；高频设置前置，高级配置分组 |
| B03 | Bot 备份 | 导出/导入完整 `.memoh.zip` 的说明与按钮 | 管理 → Bot → 备份；首版可后置，独立于 Workspace 快照 |
| B04 | Platforms | 空列表；添加选择器列出 DingTalk、Discord、Feishu、LINE、Matrix、Misskey、QQ、Slack、Telegram、WeChat Official Account、WeCom、WeChat | Bot → 渠道；先查看已连接状态，新增接入后续做引导 |
| B05 | Memory 内容 | 已有条目、搜索、分类、时间分组、数值标记、Memory Graph、新建与 Compact | Bot → 记忆；手机优先列表、搜索和条目详情，关系图二级入口 |
| B06 | Memory 运维 | Index & sync 面板显示 Built-in Memory、Healthy、Manual sync | 记忆页状态详情；手动同步不与列表下拉刷新混用 |
| B07 | Tool Approval 策略 | 每个工作位置分别设置文件读、文件写、Shell 的 Allow / Ask / Deny | Bot → 权限，执行位置清晰；不要与某次运行的审批卡片混为一页 |
| B08 | Hooks | 事件列表、JSON 配置、规则/动作计数、模板、测试 payload 和 Run test | 高级管理后置；运行测试可能执行动作，不作为普通预览 |
| B09 | Agents | 空列表；添加表单实际提供 Codex、Claude Code、ACP 和名称 | Bot → Agents；首版查看/选择已就绪 Agent，安装和授权后续独立设计 |
| B10 | Connectors | Connected services、Browse connectors，当前无连接 | Bot → 能力 → 连接服务；首版查看已有连接 |
| B11 | MCP | 空列表与 New Server | Bot → 能力 → MCP；连接状态与工具范围先行，原始配置后置 |
| B12 | Skills | Skill Paths、New Skill、Skill library；本环境返回 Failed to load skills / Not Found | Bot → 能力 → Skills；存在页面但当前成功加载未验证，不能伪造技能列表 |
| B13 | Desktop | 说明可观察/接管屏幕；前台复查出现 Live view、Desktop disconnected、Reconnect | 执行环境 → 远程桌面；连接与手势需单独验证，首版可后置 |
| B14 | Computers | 默认工作位置、Cloud Computer 与连接电脑、Online 状态、Manage computers | 资源 → 执行环境；Bot 详情提供已授权位置入口 |
| B15 | Workspace | Running、资源监控不受后端支持、Resource Limits、Snapshots & restore、Details、Stop、Delete | 资源 → 环境详情；首版状态/能力/文件，运维动作后续谨慎增加 |
| B16 | 资源限制 | 实际打开表单：CPU 核数、Memory GiB、Storage GiB；存储字段说明 VM hard limit 与容器 soft limit 的差别 | 高级资源设置；按 backend 能力解释，不承诺所有配额都硬限制 |
| B17 | 快照与恢复 | 实际打开管理面板：New snapshot、Create、No snapshots | 快照列表/详情；创建和恢复未执行，不确认快照具体覆盖范围 |
| B18 | Workspace 详情 | 镜像、运行/任务状态、ID、namespace、path、GPU 设备、时间 | 首屏显示可理解状态，标识与路径进详情/诊断 |
| B19 | Network | Private network 说明：稳定地址、可选择出口位置 | 高级环境配置；本次未验证成功配置链路 |
| B20 | Compaction | 自动压缩开关、阈值、保留上下文比例、模型与日志区 | Bot → 上下文；首版状态可见，策略调整后续 |
| B21 | Access | Channel Members / Team Members、黑/白名单、Chat / Manage 说明、规则 | Bot → 访问权限；与工具权限分开，服务端授权为准 |
| B22 | Email | Provider bindings 与 outbox 状态表；当前无绑定/邮件 | Bot → 渠道/邮件；不为手机再造完整邮件客户端 |

## 全局、Team 与账号设置

| ID | 功能 | 本次实际观察 | 移动端建议落点 / 首版程度 |
| --- | --- | --- | --- |
| G01 | Bots | Bot 列表、Import Bot、New Bot | 管理 → Bots；首页与会话选择器也能打开 Bot 详情 |
| G02 | Computers | This computer 为当前桌面机器；Ready、Connect another computer、Other computers | 资源 → 执行环境；手机默认是控制端，不把手机自动注册成执行电脑 |
| G03 | Supermarket | Connectors / Skills 入口；服务目录有 Connect 与 Unavailable 两种状态 | 管理 → 能力目录；不能把目录中所有服务都算成已可用 |
| G04 | Providers | 已配置 Provider 与模型数量；另有多个预设厂商入口 | 管理 → 模型与能力；聊天只选可用模型，完整 Provider 编辑后续 |
| G05 | Memory 后端 | Built-in、embedding model、Advanced、Mem0、OpenViking | 管理 → 记忆服务，与 Bot 的记忆内容页分开 |
| G06 | Web Search / Fetch | web_search 与 web_fetch 分组，内建与其他 Provider | 管理 → 搜索与网页读取；一般用户不需每次聊天接触 |
| G07 | Voice / Video | 朗读与转录分组；多个服务入口；视频 Provider 目录 | 先接好聊天语音链路，再补服务管理；“目录存在”不等于所有服务已配置 |
| G08 | Email 服务 | Generic SMTP/IMAP、Gmail OAuth2、Mailgun 等入口 | 管理 → 邮件服务，按 Bot 绑定使用 |
| T01 | 账号/团队菜单 | Account Settings、Team Settings、Project Usage、Billing、团队切换、New Team、About、Sign Out | 顶部团队切换与管理入口；切换需隔离缓存和 outbox |
| T02 | Team | 名称、头像、离开/删除与 Team 标识 | 管理 → 团队；重要操作与账号退出分开 |
| T03 | Members | 成员角色、加入时间、成员额度、邀请与待处理邀请 | 团队 → 成员；首版查看，管理动作后续接正式 API |
| T04 | Usage | 按 Bot、时间、Session 类型、模型筛选；token、推理、cache、按日图与记录 | 管理 → 用量；移动摘要加筛选，不照搬宽表格 |
| T05 | Billing | 方案、额度、余额、超额、策略、兑换与模型用量 | 管理 → 订阅；首版只读概览，购买与充值发布前单独设计 |
| G09 | Appearance | 语言、主题、配色、UI/代码字号与字体、代码与图表外观 | App 设置；首版语言、明暗、系统字号支持 |
| G10 | Keyboard | 面板关闭、保存文件、侧栏、设置与媒体预览快捷键 | 手机不需要完整复制；保留 Android 返回和可发现的触控操作 |
| G11 | Account / About | Account 入口；About 实际查看版本、文档、反馈和更新 | 账号基础设置与诊断；本次未进一步读取私人资料表单 |

## 目前能确认和不能确认的状态

- Skills 在窗口可见时重新进入仍显示加载失败，这是可复现的 UI 观察；本轮没有追查后端原因。
- Workspace 明确显示资源监控不受当前 backend 支持，不能把 `--` 解释为 CPU/内存为零或电脑离线。
- Desktop 当前显示断开和重连入口；未点击重连或远程操作，不能宣称实时桌面已成功连接。
- 若干页面间曾残留 `Not Found` toast。已识别其为独立通知，不将每个出现过该 toast 的页面都记作接口失败。
- 没有实际创建的 Schedule、外部 Agent、MCP、平台绑定等样例。表单/空状态足以证明入口和字段，但不足以证明创建、授权和运行成功。
- 当前会话没有被用来测试后台恢复、停止、审批、多设备竞争或推送。上一轮的协议验收计划仍需实施。

## 对上一轮计划的调整

1. React Native + Expo 已由用户确认，删除双框架样例工作。
2. Files、执行环境和定时任务值得有清晰的日常入口，不能全部埋入“管理”。
3. Bot / Agent / Model / Computer 的选择与作用范围必须显式区分。
4. 手机中的执行环境页以观察、定位文件与关联任务为主；完整运维放到详情的高级区域。
5. Memory 的首屏改用可搜索条目，关系图作为次级浏览方式；不同于文件树。
6. Team 界面已被实际观察，兼容规划可以更具体；正式 API、权限和租户隔离保证仍待对齐。

移动端分区与具体工作流程见 [移动端功能分区与执行环境设计](06-mobile-feature-areas.md)。
