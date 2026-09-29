# M4 资源契约（文件、环境、定时任务、记忆、模型、位置）

来源：Memoh 源码（commit 3e45c438 之后的本地 clone，只读）与 2026-09-29 对本地 dev stack 的实测。下文“实测”指 dev stack 的真实响应。

## 文件（FL-01..04，U7）

全部在 `/bots/:bot_id/container` 下，读需要 `workspace_read`，写需要 `workspace_write`。路径为容器内绝对路径，服务端做 `path.Clean`，拒绝 `..`。

| 请求 | 响应（实测） |
| --- | --- |
| `GET /container` | `{container_id, workspace_backend, image, status, container_path:"/data", task_running, ...}`；`container_path` 是 Bot 的家目录，文件浏览从这里开始 |
| `GET /container/fs/list?path=` | `{path, entries:[{name, path, size, mode, modTime, isDir}]}`；不递归；符号链接 `mode` 以 `L` 开头、`isDir:false` |
| `GET /container/fs?path=` | 单个条目，字段同上 |
| `GET /container/fs/read?path=` | `{path, content, size, revision:"sha256:…"}`；不区分文本/二进制，二进制请用 download |
| `GET /container/fs/download?path=` | 二进制流，`Content-Type` 按扩展名；目录返回 `.tar.gz` |
| `POST /container/fs/upload` | multipart：`path`（目标完整路径）+ `file` → `{path, size}` |
| `POST /container/fs/write` | `{path, content, expectedRevision?}` → `{ok, revision}`；版本不符 409 |

错误：404 不存在，403 无权限，503 工作区不可达（`workspace_unreachable`），客户端映射为“无法连接”。

没有 HTTP ETag；`revision` 在 JSON 里。服务端代码里没有看到读/上传大小上限（可能在 gRPC 桥上），客户端对 512 KB 以上的文本不做预览。

## 文件夹（workdir）

`GET /bots/:bot_id/workdirs` → `{workdirs:[{id, name, target_kind:"native"|"remote", workspace_target_id, path, archived?}]}`。一个文件夹 = 某个执行位置 + 路径；会话在创建时绑定文件夹。Web 端叫 “Folders”。

## 执行环境（EN-01..03，U8）

- `GET /bots/:bot_id/workspace-targets` → `{targets:[{target_id:"native", kind, name:"Server Workspace", primary, online, status}]}`。`status` ∈ `online | offline | revoked | owner_mismatch | client_update_required`。**没有心跳时间**，状态是请求当时计算的。
- `GET /container/metrics` → `{supported, unsupported_reason?, status:{exists, task_running}, metrics:{cpu:{usage_percent}, memory:{usage_bytes, limit_bytes}, storage:{used_bytes}}, resource_limits, sampled_at}`。`supported:false` 显示“不支持监控”。
- `/bots/:id/checks` 是 Bot 健康检查，与环境状态分开（AD-01 页面显示）。

## 定时任务（SC-01..05）

- `GET /bots/:bot_id/schedule` → `{items:[{id, name, description, pattern, enabled, command, max_calls, current_calls, run_target, ...}]}`。
- `POST /schedule` `{name, description?, pattern, command, enabled?, run_target:"new_session"}` → 201（实测）。
- `PUT /schedule/:id` 部分更新；**没有单独的启用/停用接口**，改 `enabled`。
- `GET /schedule/logs?limit=` 与 `/schedule/:id/logs` → `{items:[{id, schedule_id, session_id, status:"success"…, result_text, error_message, started_at, completed_at}], total_count}`；`session_id` 指向这次运行产生的会话（实测）。
- `pattern` 用 robfig/cron 解析（可选秒 + 5 段 + `@daily` 等），**按 Bot 的时区**执行；没有单任务时区字段，也不返回下次执行时间。

## 记忆（MM-01/02）

- `GET /bots/:bot_id/memory?no_stats=true` → `{results:[{id, memory, hash, created_at, updated_at, metadata}] | null}`；没有分页和分类参数。
- `POST /memory/search` `{query, limit?, no_stats?}` → 同形状，按相关度排序（实测：搜 “concise” 时匹配项排第一，其余仍返回）。
- 没有单条详情接口；`/memory/usage` 的 `count` 在新增后未立即更新（实测为 0），列表长度更可靠。

## 模型与推理强度（CH-17）

- `GET /models` → 数组：`[{id, model_id, name, type:"chat", enable, reasoning:{supported, can_disable, efforts?, default_effort?}}]`。`efforts` 是可选的档位（不含“关”），`can_disable` 表示能否关闭。
- 单条消息覆盖：WS `message`（以及 `retry_message` / `edit_message`）带 `model_id`、`reasoning_effort`、`workspace_target_id`。实测带 `model_id` 的消息正常被接受并回复。
- 会话级偏好（`preferred_chat_model_id` 等）需要带 `expected_model_preference_revision` 的比较并设置；App 目前不改会话偏好，只做单条覆盖。

## 执行位置（CH-18）

`workspace_target_id` 就是上面的 `target_id`；服务端会检查权限并验证目标，失败返回 409。离线目标在选择器里不可选。

## 聊天附件（CH-16）

没有单独的聊天附件上传接口。Web 端（`useComposerAttachments.ts#fileToAttachment`）把文件读成 data URL，直接放进 WS `message` 帧：

```json
{ "type": "message", "invocation_id": "…", "session_id": "…", "text": "",
  "attachments": [{ "type": "image", "base64": "data:image/png;base64,…", "mime": "image/png", "name": "chart.png", "size": 7720 }] }
```

- 服务端 `parseWSClientAttachments` → `attachment.ParseToolInputBundles`：每项需要 `base64`、`path`、`url`、`platform_key`、`content_hash` 之一，否则被忽略；`base64` 可以是 data URL。
- 文本可以为空，只要有附件（`message text or attachments required`）。
- WS 连接没有 `SetReadLimit`，单个资源上限是 `media.MaxAssetBytes` = 200 MiB。App 自己限制每个 20 MB、每条 9 个，因为发送时整段 data URL 在 JS 内存里。
- 另一条路是先上传到工作区再用 `{type, path}` 引用；没有采用，因为模型能否直接“看到”图片取决于服务端解析，Web 端走的是 base64，这条路径最稳。
- `retry_message` / `edit_message` 不带附件。

## 推送（NT-02）

服务端没有。见 `docs/12-notifications.md`。
