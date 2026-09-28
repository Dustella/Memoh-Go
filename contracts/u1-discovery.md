# U1 能力发现

## 现状

`GET /ping`（无需鉴权，`internal/handlers/ping.go`）：

```ts
interface PingResponse {
  status: string;              // "ok"
  container_backend: string;   // "docker" | "containerd" | "apple"
  snapshot_supported: boolean;
  connectors: boolean;
  version: string;             // 构建版本，开发构建为 "dev"
  commit_hash: string;         // 7 位
}
```

另有 `HEAD /health`（存活）与 `GET /api/swagger.json`（Swagger 2.0，与 `spec/swagger.json` 一致；`@memohai/sdk` 由其生成）。

## 缺口

无面向客户端的特性列表，也无最低兼容客户端版本；`version` 在自部署开发构建中是 `dev`，无法据此判断能力。

## 建议（服务端）

在 `/ping` 追加，保持向后兼容：

```ts
interface PingCapabilities {
  api_version: number;          // 协议整数版本，破坏性变更时递增
  min_client?: string;          // 低于此版本的客户端应提示升级
  features: string[];           // 例如 "invocation_lookup", "runtime_snapshot_http", "session_client_request_id", "device_refresh_token"
}
```

## 客户端降级（当前实现）

1. 添加部署时调用 `/ping`：`status === "ok"` 才允许继续；记录 `version`、`commit_hash`。
2. 若响应含 `features[]`，直接使用；否则能力表为空集合，U2–U5 全部走降级路径。
3. 不根据 `version` 字符串猜测能力；只有显式 feature 才启用增强路径。
4. `/ping` 不可达时区分“地址错误/网络不可达/非 Memoh 服务”（响应不含 `status` 字段）。
