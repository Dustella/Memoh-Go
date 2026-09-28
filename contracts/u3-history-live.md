# U3 历史与实时投影的交接

## 现状

- 运行中的 turn **只**存在于 WS 运行投影（`CurrentRunView`）；run 进入终态后，user + assistant 才一起写入历史，出现在 `GET /bots/:bot_id/messages`。
- 历史 turn 与 live run 通过 `turn_id` 对应；`CurrentRunView.invocation_id` 回显发起方的意图 ID。
- 历史排序键：`UITurn.turn_position`（不可变准入序号）。live `(epoch, seq)` 不持久，不能作为历史水位。
- 不存在“历史已提交到 X”的标记，也没有 HTTP 形式的运行快照。
- Web（`realtime.ts`）做法：订阅并缓冲投影 → 并行加载历史 → 等到首个快照后，**同一 tick 内**先应用历史再应用缓冲投影，避免闪烁。终态 run 且无流式内容时不再投影，以历史为准。

历史分页：`?session_id=&limit=&before_message_id=`（或 `before` 时间）；默认最新 30 条，页内旧→新，页首扩展到完整 turn。

## 缺口

冷启动后，本地缓存与服务端之间可能缺少：离线期间完成的 turn（只能靠重新拉历史）、以及运行中 turn 的部分输出（只能靠 WS）。两者没有原子交接点。

## 建议（服务端）

`GET /bots/:bot_id/sessions/:session_id/runtime-snapshot` 返回与 WS 首帧相同的 `Snapshot`，并在响应中附带该时刻历史最大 `turn_position`。客户端可在一次 HTTP 往返中完成交接，不必先建立 WS。

## 客户端降级（当前实现）

对单个 Session，恢复算法：

1. 从 SQLite 立即渲染本地历史与上次的运行投影（标记“同步中”）。
2. 订阅 WS，等待 `runtime_snapshot`；同时拉取最新一页历史。
3. 两者都到达后，在同一次状态提交中：
   - 历史按 `turn_id` 合并入本地（服务端版本覆盖本地同 `turn_id`）。
   - 若快照有 `current_run_view` 且其 `turn_id` **不在**历史中 → 作为尾部 live turn 展示。
   - 若 `turn_id` 已在历史中，或 run 已终态 → 丢弃 live 投影，历史为准。
4. 若本地最新 turn 比新拉取页更早且二者不相接（中间有缺口），继续向前翻页直到相接或达到上限（默认 5 页），超过上限标记“有更早未同步内容”，按需加载。
5. 之后 delta 正常应用；run 进入终态时再拉一次最新页，替换 live turn。

测试夹具：`fixtures/history-page.json`、`fixtures/runtime-snapshot.json`、`fixtures/runtime-deltas.json`。
