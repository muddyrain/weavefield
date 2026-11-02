# ADR-0007 · Workspace 任务的条件更新

- Date: 2026-10-30
- Status: Proposed，随 M3-01 等待人工 Code Review

## Context

现有 Task 已有 description、三态 status 和 version，尚无正式业务入口。M3-01 只交付真实任务看板，不能借此恢复 M2、加入未验证的 assigneeId 权限模型或改变原有 Session/RBAC。

## Decision

复用现有模型，不新增 Migration。Task DTO 只返回 id、workspaceId、title、description、status、version。创建固定 TODO/version=1；允许同名任务。指派、截止日期、删除、关联、评论和实时广播不在本轮范围。

所有路由沿用 SessionGuard、Cookie、写入来源及 JSON 限制。读操作先在 RepeatableRead 事务中验证成员。写操作与成员管理锁定同一个 Workspace 父行，ReadCommitted 下等待后重新读取成员角色；OWNER/EDITOR 可写，VIEWER 只读。任务必须属于路径中的空间，缺失/跨空间按 404 隐匿；资源检查先于可写角色检查。

PATCH 要求 version 和至少一个可修改字段，使用 id+workspaceId+version 条件更新并递增 version。条件不匹配返回 409，不自动覆盖或重试。前端保留草稿，明确加载最新版本后重新编辑。

前端写入使用同步 ref，覆盖请求和其后必要的读取；自动刷新不能推进写入中的请求代际。网络或 5xx 导致结果不明时不重复 POST，先刷新核对。账号/空间/页面生命周期变化使旧响应失效，独立 Session 检查不受写入锁阻挡。

## Consequences

复用父行锁使同空间成员变更与任务写入串行，便于验证排队撤权；代价是同空间任务写吞吐受该锁限制。version 防止不同客户端静默覆盖，不能提供实时看板或离线合并。Task 列表暂不分页，也不返回模型中未启用的 assigneeId/dueAt。

未增加幂等键或任务标题唯一规则。客户端无法确认创建结果时，由用户刷新并核对；不会以同名记录推断某次创建必然成功。M2 严格协作撤权、持久化和作者 Undo 仍不属于本决策的完成范围。
