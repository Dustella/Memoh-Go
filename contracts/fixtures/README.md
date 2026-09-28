# Fixtures

全部为 **derived**：依据 commit `3e45c438` 的 Go 结构体与 `apps/web` TS 镜像类型手写，ID 与文本均为虚构，不是真实抓包。拿到测试部署后，用真实脱敏响应替换并在此注明来源与服务端版本。

- `runtime-snapshot.json`：运行中的 run，seq 12。
- `runtime-deltas.json`：seq 13–17，文本追加、工具调用开始/进度/完成、run 终态。
- `history-page.json`：两轮 turn；第二轮即上述 run 完成后写入的历史。
- `messages.json`：`/ping`、登录、Bot 列表、会话列表、`run_accepted`（含 duplicate）、`run_rejected`、过期 `control_ack`。

## captured/

**真实抓包**：本地 `mise run dev` 开发栈，server 基于 PR #1405 分支 `4beb11db7`（main `eb735bd01` + invocation lookup），2026-09-28。ID 为开发库 UUID，不含凭据。

- `markdown-turn.frames.json`：新会话中一轮纯文本 Markdown 回复的全部 WS 帧（snapshot → `run_accepted` → `model_preference_settled` → 16 个 delta，run 终态 `completed`）。
- `markdown-turn.history.json`：同一会话 run 结束后的 `GET /bots/:bot_id/messages` 响应。

与手写 fixture 的差异（已在真实帧中观察到）：`run_accepted` 带 `turn_position` 与 `epoch/seq`；delta 会整体下发 `current_run_view`（含 `status:"admitting"`、`user_turns`、`request_user_turn`、`fencing_token`）；存在 `model_preference_settled` 帧。
