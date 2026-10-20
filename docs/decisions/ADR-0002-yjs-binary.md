# ADR-0002 · 以 Yjs 二进制状态作为协作文档权威数据

- Date: 2026-10-20
- Status: Accepted

## Context

多人协同需要保留 CRDT 的操作与状态语义。简单 JSON 是展示快照，不等于持久的 CRDT 历史。

## Decision

对实时文档使用 `Y.encodeStateAsUpdate` 的 binary 保存、`Y.applyUpdate` 恢复；当前 localhost 演示保存到 `.local`，M2 迁移到 PostgreSQL Bytes。BlockNote Markdown/HTML 导出仅用于展示与互操作。

## Consequences

好处：重启后正确恢复协同结构；避免重复内容。代价：不能直接 SQL 搜索富文本文字，后期需构建只读索引/文本派生视图。历史压缩和更新日志策略需单独评估。
