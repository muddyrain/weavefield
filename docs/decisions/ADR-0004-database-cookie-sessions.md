# ADR-0004 · 密码认证与数据库 Cookie Session

- Date: 2026-10-21
- Status: Accepted for M1.2 local implementation; pending human review

## Context

M1.2 需要真实账号、刷新恢复、立即退出及撤销；业务 API 使用 NestJS，关系数据库和统一 Prisma Client 已在 M1.1 落地。当前尚未实现工作空间权限或正式协作票据。

## Decision

- 使用不透明的数据库 Session，不使用 JWT。每次登录生成 32 字节安全随机 Token；浏览器只通过 HttpOnly Cookie 保存，数据库存 SHA-256 摘要。Session 保存 userId、创建时间、绝对过期时间和 revokedAt，默认 7 天，不自动滑动续期。每次 `/auth/me` 查询有效性；退出删除当前 Session，重新登录轮换当前 Token。
- 使用 Node.js 内置异步 scrypt：N=32768、r=8、p=3、maxmem=64 MiB、16 字节随机盐、64 字节结果，使用 timingSafeEqual 比较。每进程最多同时进行两个密码派生。未注册账号和没有密码的旧账号也执行相同成本的派生后统一拒绝。
- emailCanonical 为规范化查询/唯一键，新注册统一 trim + lowercase。旧账号回填 canonical，保留原 email、ID、昵称与创建时间；密码字段可空，不生成默认密码。迁移前发现旧邮箱规范化冲突时明确停止；其余 DDL 和回填放在事务内。
- 开发 Cookie 为 weavefield_session；生产为 __Host-weavefield_session，固定 Secure、HttpOnly、SameSite=Lax、Path=/，不设置 Domain。生产 WEB_ORIGIN 必须是精确 HTTPS Origin。部署需使用同站 Web/API 与 HTTPS 反向代理；本轮 API 仍绑定 loopback，不开放公网演示协作服务。
- 所有认证写请求要求精确 WEB_ORIGIN、application/json 和 X-Weavefield-Request: 1，拒绝 Sec-Fetch-Site: cross-site。CORS 仅允许配置的 Origin 携带 Credentials；自定义头用于触发浏览器预检，并不是身份凭据。全局 JSON 大小限制 4 KiB。
- 单实例内存限流：注册每 IP 10 次、登录每 IP 20 次、每规范化账号共 10 次 / 15 分钟；不信任客户端 X-Forwarded-For。最多 10000 个计数桶。达到限制返回 429；重启会重置计数，生产多实例需另行实现共享限流。
- NestJS DatabaseService 注入数据库包唯一实例，在模块启动/关闭时连接/断开，应用启用关闭钩子。认证响应只选择 id/email/displayName 与会话过期时间，设置 no-store；不输出密码摘要或 Token。

## Consequences

数据库查询换取立即退出、撤销及简单可审查的生命周期。数据库不可用时认证失败关闭，不生成虚假用户。JWT 的无状态优势目前不足以抵消撤销列表、轮换等复杂性。scrypt 避免新增原生依赖，代价是显著的 CPU/内存成本，需要限流和并发上限。

登录不创建 Workspace 或 Membership，不授予 Nova 演示空间或 Hocuspocus 的正式权限。旧无密码账号无法登录，安全设置密码/找回密码、邮箱验证、过期 Session 定期清理、共享限流及生产部署属于后续工作，不能描述为已实现。

## References

- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
