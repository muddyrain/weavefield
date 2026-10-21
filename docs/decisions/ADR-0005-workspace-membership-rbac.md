# ADR-0005 · Workspace RBAC 与最后 OWNER 的并发保护

- Date: 2026-10-21
- Status: Proposed for M1.3; local implementation verified, pending human review and Linux CI

## Context

现有 Workspace、Membership、WorkspaceRole 已有唯一约束和外键，M1.2 提供 Cookie Session。M1.3 需要多租户列表、成员管理及 OWNER / EDITOR / VIEWER 权限，但不包含文档 CRUD 或 Hocuspocus 正式鉴权。数据库没有自动创建 OWNER 或“至少一个 OWNER”的跨行约束。

单纯在事务中先计数再降级并不充分：两个 OWNER 可以各自读到两人，然后同时退出。前端禁用按钮或进程内互斥也无法保护多个 API 实例。

## Decision

1. 保留现有 Schema 与迁移。Workspace 和初始 OWNER 在同一 Prisma 事务中创建；成员复合主键、slug 唯一约束作为数据库最终防线。
2. 复用 Session 验证与 Origin / JSON / 自定义头保护，抽取 SessionGuard。WorkspaceAccess 在事务中读取当前 Membership，不接受客户端角色。列表由当前用户 ID 过滤；非成员与不存在空间返回相同 404，已加入但越权返回 403。公开 DTO 只 select 必要字段。
3. 所有空间写操作（名称、成员新增、角色变更、移除）通过同一事务入口，用参数化 SQL 锁定 Workspace 行 `FOR UPDATE`。获得锁后重新检查操作者是否仍是 OWNER，再检查目标成员和 OWNER 数量并更新。采用 ReadCommitted，保证锁等待结束后的新查询读取最新提交；事务退出自动释放锁。
4. 详情与成员读取使用 RepeatableRead，令成员校验与返回数据处于同一快照；已开始的合法读取可能在并发撤权后完成，后续请求重新鉴权，不承诺终止已发出的响应。
5. React 只保留一个 AuthProvider 身份源，工作空间状态按真实用户隔离；localStorage 只存所选 ID，恢复时仍走服务端校验。M0 的静态 Nova 与共享文档保持独立，真实角色不授予演示协作权限。

## Alternatives and consequences

- Serializable 事务加有限重试也能处理写偏差，但当前写入天然按空间组织。父行锁使冲突范围、锁顺序和重新鉴权过程更直接，不需要重试整段业务。不同空间仍可并行，同一空间写入串行化；大量成员/高频管理的性能尚未压测。
- 数据库触发器可覆盖更多直接写入，但会增加迁移与隐式行为；当前所有业务写入口集中，暂采用明确的 Service 协议。后续脚本、管理员操作、新业务入口必须遵守该锁协议。特别是 User 删除级联 Membership 或直接 SQL 可以绕过；本轮不提供 User / Workspace 删除接口，不宣称数据库对所有写者强制 OWNER 不变量。
- 锁等待/事务超时失败关闭，未知数据库错误返回 503，不进行未经审查的自动重试。无物理空间删除 API，避免误触历史级联删除。
- 添加已有账号会对获授权的 OWNER 区分邮箱是否注册，属于该功能的必要反馈；未提供公开用户搜索、邮件邀请、分页或审计日志。
- 前端窗口打开时手动、聚焦及每分钟刷新，无成员变化推送。界面可短暂显示旧角色，但每次写入均由服务端重新判断；403 后刷新真实角色，401 清理身份，404 清理失效选择。

## Verification

真实 HTTP + 隔离 PostgreSQL 16 集成覆盖多租户、角色、输入、会话、CSRF、最后 OWNER 及锁等待后的重新鉴权。并发测试用数据库成员行锁作为门闩，确认两个请求实际进入锁等待后释放；双降级和双退出各三轮，保留一位 OWNER。反向验证仅临时移除被 Git 忽略的编译产物中的父行锁，两个并发用例均检测到 OWNER 数量变为 0，恢复后全部通过。没有修改源码来绕过测试，也没有以固定延时碰运气。

React E2E 验证真实创建、切换、刷新恢复、成员管理、权限被撤销、Session 过期/退出及移动端失败反馈；完整检查及本地与 Linux 边界见 [M1.3 报告](../reports/M1.3.md)。

## References

- [PostgreSQL 16 显式锁](https://www.postgresql.org/docs/16/explicit-locking.html)
- [PostgreSQL 16 事务隔离](https://www.postgresql.org/docs/16/transaction-iso.html)
- [Prisma 6 事务与隔离级别](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions)
