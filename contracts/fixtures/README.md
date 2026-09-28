# Fixtures

全部为 **derived**：依据 commit `3e45c438` 的 Go 结构体与 `apps/web` TS 镜像类型手写，ID 与文本均为虚构，不是真实抓包。拿到测试部署后，用真实脱敏响应替换并在此注明来源与服务端版本。

- `runtime-snapshot.json`：运行中的 run，seq 12。
- `runtime-deltas.json`：seq 13–17，文本追加、工具调用开始/进度/完成、run 终态。
- `history-page.json`：两轮 turn；第二轮即上述 run 完成后写入的历史。
- `messages.json`：`/ping`、登录、Bot 列表、会话列表、`run_accepted`（含 duplicate）、`run_rejected`、过期 `control_ack`。
