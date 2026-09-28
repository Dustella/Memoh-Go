# U2 登录与续期

## 现状

| 端点 | 鉴权 | 请求 | 响应 |
| --- | --- | --- | --- |
| `POST /auth/login` | 否 | `{username, password}` | `{access_token, token_type:"Bearer", expires_at, user_id, role, display_name, username, timezone?}` |
| `POST /auth/refresh` | 需要**未过期** Bearer | 无 body | `{access_token, token_type, expires_at}` |
| `GET /users/me` | 是 | — | `Account`（id、username、display_name、avatar_url、timezone、is_active…） |

- JWT HS256，claims `sub`、`user_id`、`iat`、`exp`；默认有效期 `24h`（`internal/config/config.go:33`，部署可覆盖）。
- refresh 是对同一 access token 的滑动重签，**没有独立 refresh token**；token 过期后只能重新输入密码。
- 过期/无效 token → 401（echo-jwt 中间件；响应体形状 **UNVERIFIED**，按 `{message}` 容错解析）。
- 没有服务端注销；Web 仅清除本地 token。
- 所有受保护路由（含 WS 升级）接受 `Authorization: Bearer` 或 `?token=`（`internal/auth/jwt.go:37`）。

## 缺口

手机常在后台超过 24h，当前机制会迫使频繁重新登录；被盗 token 在到期前无法撤销。

## 建议（服务端）

- 登录返回可撤销的设备 refresh token（不透明，服务端存储），`POST /auth/token {grant_type:"refresh_token"}` 换发 access token。
- `POST /auth/logout` 撤销当前设备会话；access token 增加 `jti`。
- 在 U1 `features` 中以 `device_refresh_token` 声明。

## 客户端降级（当前实现）

- access token 存 SecureStore，key 按部署 + 账号区分；不写 SQLite、不写日志。
- 应用启动、回前台、每次 REST 调用前：若剩余有效期 < 25%，调用 `/auth/refresh`。
- 401：尝试一次 refresh；仍失败则进入“需要重新登录”状态，**保留本地缓存与 Outbox**，重新登录同一账号后继续投递；换账号则按 scope 隔离，不投递旧账号的 Outbox。
- 退出登录：删除该部署+账号的 token 与本地数据（ID-07）。
- 本地 scope 的 `accountId` 取 `user_id`；`teamId` 在 OSS 部署固定为默认 Team（`00000000-0000-0000-0000-000000000001`），Cloud Team 契约另定。
