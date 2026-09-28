# 与 Memoh 上游的契约

本目录目前为空契约占位，不是已经可调用的 SDK。当前服务器调查见 [02](../docs/02-upstream-investigation.md)，新增移动协议提案见 [03](../docs/03-sync-contract.md)。

后续保存：

- 经 maintainer 确认的 schema/OpenAPI 版本、来源和兼容说明；
- 真实脱敏响应与能力样例；提案样例必须单独标注 proposal；
- 生成 DTO 的输入与更新说明；生成结果放 src/data/remote 内，领域类型独立维护；
- 当前协议与移动扩展的对应关系、幂等期限和降级行为。

服务端实现留在 ../Memoh；不在本项目复制 Runtime 或伪造接口保证。契约验收需要真实测试部署，不能仅通过 mock 宣称可靠恢复。
