# ADR-0003 · 稳定实体 ID 优于跨视图复制内容

- Date: 2026-10-20
- Status: Accepted

## Context

文档、流程图和任务各自编辑相同描述会出现数据漂移，且不能可靠追踪需求变更。

## Decision

文档块引用以 `(documentId, blockId)` 定位，流程节点以 `(boardId,nodeId)` 定位，任务以 `taskId` 定位。`EntityLink` 维护关联并强制同 workspace 边界。

## Consequences

好处：跨视图双向跳转、审计及 AI 建议建立在稳定上下文上。代价：需要断链提示、实体解析缓存和权限过滤；不允许任意客户端直接构造跨租户链接。
