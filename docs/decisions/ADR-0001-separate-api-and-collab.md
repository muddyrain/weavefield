# ADR-0001 · 业务 API 与协同服务分离

- Date: 2026-10-20
- Status: Accepted

## Context

NestJS 负责访问控制、元数据与业务事件；富文本文档并发语义是 Yjs/Hocuspocus 已成熟解决的问题。

## Decision

采用 `apps/api` NestJS 和 `apps/collab` Hocuspocus 两个服务，均属于一个 Monorepo。协同票据/ACL 由 NestJS 维护，Collab 必须校验权限后才能允许连接或写入。

## Consequences

好处：职责边界明确；可以独立扩容；复用成熟 CRDT 生态。代价：身份与文档权限需要在两个服务之间共享校验协议，部署多一个组件。

## Rejected alternatives

- 自己用 NestJS WebSocket Gateway 重写 Yjs 同步：实现风险与维护成本不必要。
- 全部数据都存在 Y.Doc：不便业务查询、权限管理、索引及任务事务。
