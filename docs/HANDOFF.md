# Memoh-Go 开发 Handoff

> 更新时间：2026-09-28（UTC+8）
>
> 当前阶段：Android 实体机与模拟器均可运行 development build；P0.3 已通过，Git 基线已提交，下一步 P0.5。

## 1. 当前结论

Memoh 移动客户端已经完成 React Native + TypeScript + Expo SDK 57 的初始工程基线，并成功在实体 Android 设备上编译、安装、连接 Metro 和显示 UI。

手机首版已决定锁定竖屏；横屏和大屏/平板布局不属于当前 P0.2 验收范围，后续单独设计与验证。

当前 App 可显示四个底部入口：

- 首页
- 会话
- 资源
- 管理

四个入口目前仍是静态占位页，尚未实现业务功能。

## 2. 已完成进度

### 2.1 工程与导航基线

- Expo SDK 57 + React Native + TypeScript strict + Expo Router 已可用。
- 四个 Tab 路由均能在真机正确切换并显示各自内容。
- 已为四个 Tab 配置 Ionicons：
  - `home` / `home-outline`
  - `chatbubble-ellipses` / `chatbubble-ellipses-outline`
  - `folder-open` / `folder-open-outline`
  - `settings` / `settings-outline`
- 已增加精确版本依赖：
  - `@expo/vector-icons@15.0.3`
  - `expo-font@57.0.4`
- 根布局会在渲染 Router 前预加载 Ionicons 字体。
- `tabBarHideOnKeyboard: true` 已启用。
- 缺字方框问题已消失，四个图标均在真机正常显示。

### 2.2 Android 原生构建

- Android 原生 debug build 已成功：`BUILD SUCCESSFUL`。
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- 包名：`ai.memoh.mobile`
- APK 已安装到实体设备。
- 手机首版已锁定竖屏：Expo 配置为 `orientation: portrait`，当前 APK manifest 的 `screenOrientation=1`（portrait），并已重新安装到真机。
- 使用的原生工具链：
  - Android SDK：`D:\AndroidSDKs`
  - NDK：`27.1.12297006`（r27b）
  - CMake：`3.22.1`
  - compileSdk / targetSdk：36
  - Build Tools：36.0.0
  - 构建 JDK：17
- Android Studio 自带 JBR 25 不适合当前 Prefab/CMake 构建；已改用 JDK 17。

### 2.3 本地开发工作流

已创建本机专用的 `mise.local.toml`，并由 `.gitignore` 忽略。关键配置：

```toml
[tools]
java = "liberica-17.0.16+12"

[env]
ANDROID_HOME = "D:\\AndroidSDKs"
ANDROID_SDK_ROOT = "D:\\AndroidSDKs"
NODE_ENV = "development"
REACT_NATIVE_PACKAGER_HOSTNAME = "192.168.71.101"

[tasks.android]
description = "Build, install, and launch Memoh on the connected Android device"
run = "npm run android:device 2206123SC"
```

用户当前通过以下命令拥有并运行长驻开发进程：

```powershell
mise run android
```

不要在没有必要或未经说明时终止、替换或重启这个用户终端中的 Metro 进程。

### 2.4 Metro LAN 链路

已验证的网络拓扑：

- 主机 Ethernet：`192.168.71.101/24`
- 手机 Wi-Fi：`192.168.71.109/24`
- Metro：`http://192.168.71.101:8081`
- development client URL：

```text
exp+memoh-mobile://expo-development-client/?url=http%3A%2F%2F192.168.71.101%3A8081
```

真机现已正常进入：

```text
ai.memoh.mobile/.MainActivity
```

UI hierarchy 中包含“首页”，且不再包含：

- `Unable to load script`
- `There was a problem loading the project`

### 2.5 已完成验证

- `npm run typecheck`：通过。
- `npx expo install --check`：通过。
- Android development build 在新增原生模块后重新构建并安装：`BUILD SUCCESSFUL`。
- 四个 Tab：通过。
- Tab 图标：通过。
- 从“管理”页按 Android 系统返回：正确回到首页，未崩溃、未退出进程。
- 竖屏安全区：通过；内容未覆盖状态栏，Tab Bar 未覆盖底部手势区。
- 设备字体缩放：`font_scale=1.0`。
- 设备显示：1080 × 2400，density 440。

### 2.6 输入与键盘续测

- 已增加隐藏路由 `memoh://diagnostics`，路由仍位于 Tabs navigator 内，但通过 `href: null` 不显示第五个正式 Tab。
- 页面包含单行输入、多行输入和底部可见标记。
- 单行英文输入：通过。
- 多行输入、换行、删除后重新输入、切换焦点后保留文本：通过。
- 键盘出现时四个正式 Tab 隐藏，关闭键盘后四个 Tab 恢复：通过。
- Android 系统返回先关闭键盘，诊断路由与输入内容保留：通过。
- 键盘避让的实测边界：IME 顶部 `y=1491`，底部标记结束于 `y=1469`，无重叠。
- 输入诊断页使用 `KeyboardAvoidingView`，并以安全区顶部加默认 header 高度计算 `keyboardVerticalOffset`。
- 中文候选词组合输入仍需人工使用真实中文 IME 验证；ADB 文本注入不能证明组合输入正确。

当前真机只安装 `com.android.inputmethod.latin/.LatinIME`，当前 subtype 为 `en_AU`，没有中文/拼音 subtype。该项保留为有中文键盘时的人工复核，不阻塞 P0.3。

### 2.7 SQLite、SecureStore 与生命周期恢复探针

- 已安装并原生重建：
  - `expo-sqlite ~57.0.3`
  - `expo-secure-store ~57.0.4`
  - `expo-splash-screen ~57.0.9`
- 已增加隐藏路由 `memoh://storage-diagnostics`；它通过 `href: null` 留在 Tabs navigator 内，不增加正式 Tab。
- SQLite 诊断库启用 WAL 和外键，并通过参数绑定与 exclusive transaction 写入公开探针。
- SecureStore 保存独立的秘密标记；诊断页只显示存在性和匹配结果，不显示或记录秘密值。
- 初始探针 ID：`probe-1775838849153-7ox02xuw2f`，设备记录时间为 `2026/4/11 00:34:09`。设备系统时间与开发机日期不一致，因此该时间只用来比较恢复前后是否保持相同。
- 正常后台/前台后，生命周期记录数从 2 增至 4，最新事件为 `change · active`。
- 第一次强制终止前 PID 为 `10479`；`am force-stop` 后 PID 为空；冷启动后 PID 为 `10766`。
- 冷启动后同一探针仍存在，SecureStore 记录存在且匹配 SQLite，秘密值出现在 SQLite 为“否”，生命周期记录数增至 6。
- 补装 `expo-splash-screen` 并覆盖安装后，探针仍保持不变；第二次强制终止/冷启动后 PID 为 `11259`，生命周期记录数增至 10。
- SQLite 文件位于 App 私有目录 `files/SQLite/memoh-go-diagnostics.db`（含 WAL/SHM），SecureStore Android backing file 位于私有 `shared_prefs/SecureStore.xml`。
- 除 SQL 查询外，又对 SQLite 主文件、WAL、SHM 与 logcat 搜索秘密标记前缀 `secure-only`，均无匹配；测试输出没有暴露实际秘密值。
- 最终 logcat 未出现 `SplashScreenManager` 缺类、`FATAL EXCEPTION`、`Unable to load script` 或 development client 项目加载错误。
- Metro 全程保持 `packager-status:running`，没有停止或替换用户的开发服务器。

## 3. 当前下一项

2026-09-28 补充：

- 新增模拟器 `Medium_Phone`（Android 15 / API 35，x86_64，`emulator-5554`），通过 `mise run android:emu` 构建 x86_64 并经 localhost + adb reverse 连接 Metro；已确认 `MainActivity` 在前台。模拟器只用于日常开发与回归，不用于性能结论。
- 中文 IME 复核按用户决定跳过。
- 总路线图与功能优先级见 `docs/09-roadmap.md`；当前冲刺的第一项是初始化 Git 仓库（PF-01），随后 P0.5。

P0.3 已完成。按当前风险顺序继续：

1. **P0.5 上游移动契约对齐**
   - 明确 discovery、历史/live 边界、invocation 结果查询、幂等首次建会话和设备登录。
   - 把已确认能力、缺口、owner 和脱敏 fixtures 写入 `contracts/`。
2. **P0.4 长文本与流式渲染基准**
   - 建立 100 增量/秒、长消息、历史前插和阅读锚点恢复的确定性夹具。
   - 在 release 真机记录基线，再选择列表和 Markdown 实现。
3. **外部人工复核：中文 IME**
   - 设备安装中文键盘后，验证候选词上屏、换行、删除、重新聚焦和候选栏遮挡。

每轮修改后继续运行：

```powershell
npm run typecheck
npx expo install --check
```

## 4. 后续实施顺序

依据 `docs/08-implementation-priorities.md`：

1. P0.5：协议契约对齐。
2. P0.4：长文本与流式渲染 benchmark。
3. 有中文 IME 的设备可用时补做 P0.2 人工复核。
4. P1：可靠聊天纵切，优先实现只读真实会话。

## 5. 本轮 Pitfalls

### 5.1 LAN 地址少了一位数字

错误地址：

```text
192.168.7.101
```

正确地址：

```text
192.168.71.101
```

手机对错误地址 ping 丢包、TCP 8081 超时；对正确地址 ping 和 TCP 8081 均成功。以后不要再次使用 `192.168.7.101`。

### 5.2 修改环境变量不会更新正在运行的 Metro

虽然 `mise.local.toml` 已改为正确地址，但旧 Metro 进程仍继续发布启动时捕获的旧地址。读取 manifest 后曾确认：

```text
hostUri=192.168.7.101:8081
launchAssetUrl=http://192.168.7.101:8081/...
```

因此，仅重新发送正确的 development client URL 不够；必须由用户停止并重新运行：

```powershell
mise run android
```

重启后 Metro 才会重新读取 `REACT_NATIVE_PACKAGER_HOSTNAME` 并发布正确 bundle URL。

### 5.3 TCP 可达不等于 development client 一定可加载 bundle

`adb shell toybox nc` 只能证明端口可连。还要检查 Expo manifest 中的 `hostUri` 与 `launchAsset.url`。manifest 指向旧主机时，development client 仍会得到 `isMetroRunning() = false`，随后尝试从 APK assets 加载不存在的 debug bundle，并显示 `Unable to load script`。

### 5.4 已存在的错误 Activity 可能压在 MainActivity 上方

把正确 URL 投递给现有任务时，旧的 `DevLauncherErrorActivity` 可能仍停留在最上层。需要先确保 Metro manifest 正确，然后再冷启动 App；不要把“intent 已投递”误判为“页面已恢复”。

### 5.5 不要使用 Android Studio JBR 25 构建当前项目

JBR 25 会在 Prefab/CMake 阶段出现 Java restricted-method 警告并导致失败。使用兼容的 JDK 17。已知可用路径：

```text
C:\Users\Dustella\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2
```

`mise.local.toml` 当前声明 Liberica 17，也已通过 mise 环境验证。

### 5.6 Android SDK 必须保持在 D 盘

本项目必须使用：

```text
D:\AndroidSDKs
```

不要配置为：

```text
C:\Users\Dustella\AppData\Local\Android\Sdk
```

Android Studio/JBR 安装位置也应保持在 `D:\Programs` 体系内；构建 JDK 17 的兼容性例外路径如上。

### 5.7 重复 NDK 目录只是警告，但应避免混淆

当前存在：

```text
D:\AndroidSDKs\ndk\27.1.12297006
D:\AndroidSDKs\ndk\27.1.12297006-2
```

两份均为有效 r27b，但 `-2` 是冗余副本，会产生 non-blocking inconsistent-location warning。无需为当前 P0.2 阻塞开发；以后清理时先确认没有进程引用，再由用户决定删除。

### 5.8 adb 长工作流不要塞进一个同步 shell 调用

Shell 调用会同步等待进程退出。不要把以下操作组合到一个调用：

- 终止进程
- 启动长驻 Metro
- 长时间 sleep / polling
- App 启动
- 截图与 UI dump

正确方式是让用户在终端拥有 Metro，并把状态检查、App 启动、截图和日志读取拆成短调用。

### 5.9 截图可能滞后；Activity 与 UI hierarchy 更可靠

Dashboard 中看到的画面可能落后于刚完成的 adb 操作。判断是否恢复时优先检查：

1. `topResumedActivity`
2. `uiautomator dump`
3. 精确文本或错误文本
4. 最后再用截图做视觉确认

四 Tab 自动测试期间，页面实际已经切换，但截图与错误的 XML 汇总方式一度造成误判。

### 5.10 Android UI XML 是单行文件，PowerShell 属性读取易误判

`uiautomator dump` 输出常为单行 XML。节点的 `text` 是 XML attribute；直接使用对象的 `.text` 可能与 XML 节点文本属性发生冲突。必要时使用精确 grep，或显式读取 attribute。不要仅凭空输出认为页面没有文本。

### 5.11 MIUI 强制旋转命令不可靠

已尝试并恢复以下旋转设置：

- `settings put system accelerometer_rotation`
- `settings put system user_rotation`
- `cmd window user-rotation`
- `cmd window fixed-to-user-rotation`

MIUI 接受了部分命令但没有实际旋转当前显示。最终状态已恢复为：

```text
accelerometer_rotation=1
user_rotation=0
cmd window user-rotation=free
cmd window fixed-to-user-rotation=default
```

这组命令不能作为可靠的横屏测试手段。产品随后决定手机首版固定竖屏：`app.json` 使用 `"orientation": "portrait"`，当前 MainActivity manifest 同步为 `screenOrientation="portrait"`。横屏和大屏/平板布局后置，不再作为 P0.2 阻塞项。

### 5.12 ScrollView 内的底部标记不会自动证明键盘避让

初版输入诊断页把底部标记放在 `ScrollView` 的 `flexGrow` 内容中。键盘出现后 Tab Bar 正确隐藏，但标记仍留在原内容底部，被 IME 覆盖。仅检查 hierarchy 中“节点存在”会误判通过。

修正方式是把标记放到缩放后视口的固定页脚，并让 `KeyboardAvoidingView` 使用 `height` 行为和包含安全区/header 的 `keyboardVerticalOffset`。验收时同时比较真实 IME frame 与标记 bounds，并查看截图。

### 5.13 Expo SQLite 的 Android 文件不在标准 databases 目录

`run-as ai.memoh.mobile ls databases` 看不到诊断库并不表示未落盘。`expo-sqlite` 当前把它放在：

```text
files/SQLite/memoh-go-diagnostics.db
```

恢复验证应读取应用 UI/SQL 结果并核对该目录；不要只检查 `databases/`。

### 5.14 新增原生 Expo 模块后必须重建 development client

只安装 JS 包不足以让现有 APK 获得 `expo-sqlite`、`expo-secure-store` 或 `expo-splash-screen` 的原生代码。使用现有 Metro 时可执行：

```powershell
mise exec -- npm run android:device -- 2206123SC --no-bundler
```

这样会构建、覆盖安装并连接已有 8081 Metro，不会另起 bundler。缺少 `expo-splash-screen` 时 DevLauncher 曾记录 `ClassNotFoundException: expo.modules.splashscreen.SplashScreenManager`；补装并重建后该错误消失。

### 5.15 当前是保留原生目录的混合配置，app.json 不会自动同步

`npm run doctor` 当前通过 20/21 项。唯一警告是项目同时存在 `android/` 原生目录与 `app.json` 中的 Prebuild 配置；Expo Doctor 提醒 EAS Build 不会自动把 `scheme`、`orientation`、`plugins` 等字段同步到已有原生工程。当前 Android 竖屏已同时写入 manifest，新增模块也已通过原生重建验证。以后修改原生配置时必须明确选择运行 Prebuild 或手工同步，不能只改 `app.json` 就假定 APK 已生效。

### 5.16 冷启动后的 UI hierarchy 可能暂时只包含开发工具层

development client 冷启动并下载/执行 Metro bundle 时，`uiautomator dump` 可能短暂只看到 `Tools` 浮层。当前首次冷启动约 12 秒完成，依赖变更后的首次 bundle 重载更久；应轮询业务文本并结合截图与 `ReactNativeJS: Running \"main\"` 日志，不能把一次空 hierarchy 当作永久白屏。

### 5.17 不要直接执行 npm audit 的自动降级修复

当前 `npm audit --omit=dev` 报告 14 个 moderate、0 high、0 critical，均沿 Expo/Router 工具链的传递依赖展开。报告给出的主要自动修复会把 `expo` 从 SDK 57 降到 46，或把 `expo-router` 降到 5.x；这会破坏已经通过真机验证的 SDK 组合。不要执行 `npm audit fix --force`。后续应在 Expo SDK 57 的兼容升级范围内跟踪上游修复，再重新运行 Expo 依赖检查、原生构建和真机恢复测试。

## 6. 快速恢复命令

### 6.1 确认设备

```powershell
D:\AndroidSDKs\platform-tools\adb.exe devices -l
```

期望：

```text
d611eea3 device product:mayfly model:2206123SC
```

### 6.2 启动开发工作流

```powershell
mise run android
```

### 6.3 检查 Metro

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8081/status
```

期望：

```text
packager-status:running
```

如遇 LAN 加载问题，还需读取 Expo manifest，确认 `hostUri` 与 `launchAsset.url` 均使用 `192.168.71.101:8081`。

### 6.4 检查前台 Activity

```powershell
$adb = 'D:\AndroidSDKs\platform-tools\adb.exe'
& $adb -s d611eea3 shell dumpsys activity activities |
  Select-String -Pattern 'topResumedActivity' |
  Select-Object -First 1
```

成功状态应为 `ai.memoh.mobile/.MainActivity`，不能是 `DevLauncherErrorActivity`。

## 7. 当前关键文件

- `mise.local.toml`：本机 JDK、D 盘 Android SDK、Metro LAN 地址和 Android task。
- `.gitignore`：忽略 `mise.local.toml`。
- `src/app/_layout.tsx`：Ionicons 字体预加载。
- `src/app/(tabs)/_layout.tsx`：四 Tab 图标与键盘时隐藏 Tab Bar。
- `src/app/(tabs)/diagnostics.tsx`：隐藏输入诊断路由。
- `src/features/diagnostics/InputDiagnosticsScreen.tsx`：单行、多行输入和键盘避让探针。
- `src/app/(tabs)/storage-diagnostics.tsx`：隐藏存储恢复诊断路由。
- `src/features/diagnostics/StorageDiagnosticsScreen.tsx`：SQLite、SecureStore 与 AppState 真机诊断界面。
- `src/application/diagnostics/storageProbe.ts`：诊断探针的写入、读取、恢复和清理编排。
- `src/data/local/diagnosticsDatabase.ts`：诊断 SQLite schema、事务与读取。
- `src/platform/diagnosticsSecureStore.ts`：不向 UI/日志暴露秘密值的 SecureStore 适配。
- `src/ui/components/PlaceholderScreen.tsx`：四页共享占位 UI。
- `docs/08-implementation-priorities.md`：当前优先级与验收门槛。

## 8. 仓库状态提示

2026-09-28 已初始化 Git（默认分支 `main`）并完成基线提交。`mise.local.toml`、`android/local.properties`、`.kiro/settings/`、构建产物与 `node_modules` 均被忽略。尚未配置远端。

[STEERING steer-c523d76dce4542bbbb0f29405a8d646b: Android SDK 与构建工具链已固定到 D 盘；项目使用 `D:\AndroidSDKs`，未回退到用户目录下的默认 SDK。JBR 25 的兼容问题通过单独使用 JDK 17 解决，而不是改变 SDK 位置。]
