# U2 登录与续期

## 现状

| 端点 | 鉴权 | 请求 | 响应 |
| --- | --- | --- | --- |
| `POST /auth/login` | 否 | `{username, password}` | `{access_token, token_type:"Bearer", expires_at, user_id, role, display_name, username, timezone?}` |
| `POST /auth/refresh` | 需要**未过期** Bearer | 无 body | `{access_token, token_type, expires_at}` |
| `GET /users/me` | 是 | — | `Account`（id、username、display_name、avatar_url、timezone、is_active…） |

- JWT HS256，claims `sub`、`user_id`、`iat`、`exp`；默认有效期 `24h`（`internal/config/config.go:33`，部署可覆盖；dev stack 实测为 7 天）。
- refresh 是对同一 access token 的滑动重签，**没有独立 refresh token**；token 过期后只能重新输入密码。
- 错误体均为 `{message}`（2026-09-28 dev stack 实测）：错误密码与未知用户都是 `401 invalid credentials`；缺字段 `400 username and password are required`；无 token `401 missing or malformed jwt`；无效/过期 token `401 invalid or expired jwt`。
- 没有服务端注销；Web 仅清除本地 token。
- 所有受保护路由（含 WS 升级）接受 `Authorization: Bearer` 或 `?token=`（`internal/auth/jwt.go:37`）。
- OSS 部署只有一个 Team，固定 id `00000000-0000-0000-0000-000000000001`（`db/postgres/migrations/0001_init.up.sql`）；没有 `/teams` 路由（404）。

## 缺口

手机常在后台超过 24h，当前机制会迫使频繁重新登录；被盗 token 在到期前无法撤销。

## 建议（服务端）

- 登录返回可撤销的设备 refresh token（不透明，服务端存储），`POST /auth/token {grant_type:"refresh_token"}` 换发 access token。
- `POST /auth/logout` 撤销当前设备会话；access token 增加 `jti`。
- 在 U1 `features` 中以 `device_refresh_token` 声明。

## 客户端降级（当前实现）

实现：`src/application/access/connectService.ts`（`ConnectionManager`）、`src/core/identity/credential.ts`、`src/platform/secureCredentialVault.ts`。

- access token 只存 SecureStore，key 为本机不透明的 connection id（不含地址或用户名）；SQLite 的 `connections` 表只存部署、账号 id、用户名、服务端版本，不存凭据。
- 过期时间换算到设备时钟：用响应的 `Date` 头修正设备与服务端的时钟差；提前 60 秒视为过期。
- 剩余有效期 < 25% 时，下一次请求前先调用 `/auth/refresh`；并发请求共用同一次 refresh。refresh 因网络失败时继续使用仍有效的旧 token（离线可用）。
- 启动不访问网络：有未过期 token 直接进入；token 缺失或已过期进入"重新登录"，**保留本地缓存与 Outbox**。
- 401：refresh 一次并重试；仍 401 则进入"重新登录"。重新登录必须是同一账号，换账号需先退出。
- 退出登录：删除该账号的 token、该 scope 的全部本地数据（含未发送消息）与 connection 记录。
- 本地 scope 的 `accountId` 取 `/users/me` 的 `id`；`teamId` 暂固定为 OSS 默认 Team，Cloud Team 契约另定。
