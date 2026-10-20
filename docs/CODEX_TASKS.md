# Weavefield · Codex 任务包

> 从本仓库根目录启动 Codex。执行前读 `AGENTS.md`、`docs/PRD.md`、`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`。严格一次只做一个任务。

所有任务均遵循 [AGENTS.md 的开发流程](../AGENTS.md#execution-workflow)：任务规划 → 实现 → 验证 → 生成报告 → 人工审查。普通小任务在最终回复中给出简短摘要；重要里程碑按该规范保存详细报告到 `docs/reports/<里程碑>.md`。任务包不授权自动进入下一阶段，也不授权提交、推送或重写 Git 历史；这些操作须由用户明确要求。

## Task 0 — 工程骨架验证

复制以下指令给 Codex：

```text
你正在 Weavefield 独立仓库中工作。这是一个前端 + NestJS + Yjs/Hocuspocus + Prisma 的作品集项目。

先阅读 AGENTS.md、README.md、docs/PRD.md、docs/ARCHITECTURE.md、docs/DATA_MODEL.md、docs/ROADMAP.md。
目标：只完成 M0 的工程验证，不要提前实现登录/任务/AI。

1. 检查当前 pnpm workspace 的 package 版本/peer 兼容，保证 Node 22 LTS 可用；必要时只做最小修正。
2. pnpm install，生成或更新 pnpm-lock.yaml；确认 CI 使用 --frozen-lockfile。
3. 启动 web、api、collab。确认 /health 可访问，打开同一个 ?doc=demo-project 的两个窗口可以看到同步。
4. 测试刷新后文档状态从本地 Yjs Binary 恢复，检查禁止 production 启动的守卫。
5. 执行 pnpm typecheck、pnpm test、pnpm build，修正所有错误。
6. 添加一个 Playwright 两窗口同步冒烟测试（如果运行环境能安装浏览器）；否则明确写出阻塞原因，不谎报通过。
7. 按 AGENTS.md 保存详细报告到 docs/reports/M0.md，在最终回复中展示交付摘要和完整任务 Diff，等待人工审查；不自动提交或推送。

约束：不要接外部 AI 模型；不要修改 valley-mas；不要把固定开发 token 当正式权限；不要大规模重构既定目录。
验收：可以从零按 README 本地启动，两个窗口同步并可刷新恢复，项目构建/类型检查通过。
```

## Task 1 — NestJS 工作空间 + 安全认证

```text
只开发 M1：User/Workspace/Membership/Document 的数据库迁移、注册登录、owner/editor/viewer、文档 CRUD。
所有 API 添加鉴权与租户校验；非成员不得通过 ID 枚举读取任何文档。
编写 API 集成测试：授权成功、viewer 拒绝写、非成员拒绝访问、跨租户实体引用拒绝。
不要触碰 AI、流程图、协作服务器的 production token 设计。
完成后给出 OpenAPI 使用示例和可重复的本地迁移说明。
```

## Task 2 — 生产协同认证与 Postgres Yjs Binary

```text
只开发 M2：通过 NestJS 签发短期 document-scoped collab token，Hocuspocus onAuthenticate 验证、阻止 viewer 写入，Y.Doc binary snapshot PostgreSQL 持久化。替换 .local 文件写入以及 demo token。
对跨 workspace、伪造 doc room、过期/撤销 token、生产环境安全配置编写集成测试。确保 onLoadDocument/onStoreDocument 不丢失历史。
说明如何使用本地两账号、两浏览器测试，同步/重启/断线恢复均要验证。
```

## Task 3 — 关联视图

```text
只开发 M3 的第一条竖切片：一个文档块引用一个需求实体；一张 React Flow 画布与一个 Task 相连接；EntityLink 通过稳定 ID 双向跳转。
先保存 API/DB、单人编辑、权限与并发冲突，然后再扩展多人实时画布。
测试节点移动不会破坏关系，删除实体有断链策略，跨租户链接失败。
```

## Task 4 — AI 审查（在前三项稳定后）

```text
只实现可替换的文本 LLM 审查：读取授权的需求文档与关联任务，返回引用来源与 SuggestedPatch。展示 Diff，用户点确认后才应用。
服务端不得把凭证发送浏览器；AI 不可执行任意代码；基线版本变化必须拒绝盲目覆盖。
使用 mock provider 完成单测和集成测试，真实模型 API 作为可选配置。
```

## 提交 PR 模板

- What/Why：一句话描述可见价值
- Changed packages：受影响包与数据库变更
- Security & correctness：鉴权/并发/数据一致性影响
- Tested：列出真实执行命令和结果；未验证的明确写未验证
- Demo：截图或录屏链接
- Follow-up：刻意留到下一 PR 的内容
