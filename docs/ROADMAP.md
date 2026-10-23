# Weavefield · 开发路线图与质量门槛

> 时间为学习项目的参考节奏，不是承诺。**每个阶段只有在验收测试通过后才算完成。**

## M0 · 工程初始化（已交付）

**目标：** 建立独立仓库、PRD、ADR、Monorepo、React UI、NestJS API、Yjs/Hocuspocus 预览服务和测试框架。

- [x] 文件骨架 / 基本文档 / ADR
- [x] Web demo / `/health` / localhost collab 源代码
- [x] Prisma schema 草案与 Docker Compose
- [x] 在开发机安装依赖并生成锁文件，CI 使用 frozen-lockfile
- [x] Node 22 LTS 下运行 typecheck / unit / build；修正版本兼容问题
- [x] Playwright 双窗口同步、刷新、断线重连与服务重启后恢复
- [x] 创建远程 GitHub 独立仓库并推送；后续测试与演示体验修复已通过 Linux CI

**完成定义：** 三个 app 均可启动；单浏览器打开编辑器；两个浏览器共享文本；刷新保持内容；已有代码通过类型检查和测试。

## M1 · 工作空间与账号（估计 1–2 周）

**功能：** 账号注册/登录、workspace 创建/列表、Membership（OWNER/EDITOR/VIEWER）、文档 CRUD、权限 Guard。

**测试门槛：** 非成员访问返回 403/404；viewer 无法修改；数据库迁移可重复执行；API OpenAPI 文档可浏览。

**不包含：** 全部共享链接、SSO、复杂权限继承。

### M1.1 · PostgreSQL 与 Prisma 基础设施

- [x] 保留现有全部模型草案，增加初始 Migration 与 Membership 用户索引
- [x] Prisma 6.19.3 Client 统一服务端入口、生成和构建脚本
- [x] Compose 本地环境变量、健康检查、独立测试项目说明
- [x] PostgreSQL 16 容器、干净库迁移、重复部署、CRUD/约束/事务及重启持久化本地验收
- [x] typecheck / 单元测试 15/15 / build / 现有 Playwright E2E 8/8 无回归

已通过 PR #1 Squash 合入 main（a4b2a44），合并后 Linux CI 39560662066 为 success。实际执行与未验证项记录在 [M1.1 报告](reports/M1.1.md)。本阶段不包含注册登录、工作空间业务 API 或权限 Guard；M1 整体仍未完成。

### M1.2 · NestJS 密码认证与数据库 Session

- [x] 新增认证迁移，保留旧用户与 M1.1 初始 Migration
- [x] 注册 / 登录 / 退出 / 当前用户，密码哈希、Cookie 与服务端会话撤销
- [x] NestJS 数据库 Provider 生命周期、Origin / JSON / 输入保护与基础限流
- [x] React 真实账号交互、刷新恢复和会话失效反馈，M0 协作身份保持独立
- [x] 本地认证 API 12/12、原数据库检查、升级探针、typecheck、单元 19/19、build、完整 E2E 14/14 通过

M1.2 已通过 PR #2 Squash 合入 main（1c7418d），[合并后 Linux CI 39572948591](https://github.com/muddyrain/weavefield/actions/runs/39572948591) 为 success。[M1.2 报告](reports/M1.2.md) 保留当时的阶段记录，以上数量包含后续已合并审查修复。

### M1.3 · Workspace 与 Membership 权限系统（已合并）

- [x] Session Guard、明确的安全 DTO、当前用户空间列表与租户隔离
- [x] 事务创建空间及 OWNER，OWNER 修改空间名称、按邮箱添加已有账号、管理角色和移除成员
- [x] EDITOR / VIEWER 只读，非成员统一 404，最后 OWNER 的父行锁与事务并发保护
- [x] React 共享真实认证状态、创建 / 切换 / 成员管理、刷新恢复、失效状态清理及移动端反馈
- [x] Workspace API 集成及并发反向验证，原数据库 / 认证 / M0 协作回归，新增 CI 步骤
- [x] 人工审查后通过 PR #3 Squash 合并，main 提交 9327af9，合并后 Linux CI 39608231601 success

详见 [M1.3 报告](reports/M1.3.md)（保留阶段本地记录）。未新增 Schema / Migration，不提供空间删除或邮件邀请；真实空间与 M0 共享演示文档明确分开。

### M1.4 · 真实文档元数据 CRUD（已合并并通过最终 Linux CI）

- [x] 五个空间内文档 API，Session / 租户 / OWNER、EDITOR、VIEWER 权限与安全 DTO
- [x] 复用 Document 模型，随机唯一内部房间，无 Schema 或 Migration 变更
- [x] 标题重命名、稳定列表排序及软归档；保留快照，归档后不可继续修改或重复归档
- [x] 复用成员管理父行锁，覆盖归档 / 改名竞态及锁等待后的成员降级
- [x] React 真实元数据管理、刷新恢复、空间 / 账号隔离、迟到响应与错误反馈
- [x] 文档 API 集成和浏览器回归已加入本地验证，CI 增加 test:documents
- [x] 人工审查，PR #4 合并及 PR #5 生成竞态修复，最终 main Linux CI 全部通过

[PR #4](https://github.com/muddyrain/weavefield/pull/4) Squash 为 cdb1d5954e50fe1c51dc95c7be0d03020d55fa96；其合并后 CI 39713193967 在生成的 Prisma 类型中出现 TS1005。随后 [PR #5](https://github.com/muddyrain/weavefield/pull/5) 将生成改为单一任务，Squash 为 b6747406f165bb12c4cbcc60b8497d81cd767998，[最终 main Linux CI 39718582027](https://github.com/muddyrain/weavefield/actions/runs/39718582027) success，包含完整 E2E 36/36。并发生成是有执行日志支持的高概率历史根因，未取得失败瞬间文件快照。

原阶段命令与结果见 [M1.4 报告](reports/M1.4.md)（保留当时记录），设计见 [ADR-0006](decisions/ADR-0006-document-metadata-and-archive.md)。本阶段没有正文编辑、Yjs PostgreSQL 持久化、Hocuspocus 正式权限、恢复归档或物理删除。OpenAPI 和 M1 总验收在下述 M1.5 收尾，不自动进入 M2。

### M1.5 · OpenAPI、权限回归与 M1 验收（本地实现，待人工审查）

- [x] 18 个现有 REST 操作的 OpenAPI 3 / Swagger UI，Cookie 和写请求契约
- [x] 默认关闭、显式本地启用、production 强制关闭，声明不改变运行时校验
- [x] 明确 Auth / Workspace / Membership / Document 权限矩阵及 401 / 403 / 404 顺序
- [x] 新增独立 OpenAPI 检查并接入 CI，保留既有集成测试及 36 项 E2E
- [x] macOS / Linux ARM64 完整本地验收：OpenAPI 9/9、Auth 12/12、Workspace 10/10、Document 17/17、单测 19/19、typecheck、build、E2E 36/36；见 [M1.5 报告](reports/M1.5.md)
- [ ] 人工审查、后续授权的提交 / PR 和新增 CI 验证

M1.1–M1.4 的远程验收已完成。M1.5 本地结果与后续 GitHub Actions 分别记录；在最终验收及人工审查完成前，不把 M1 整体标为正式交付。M2 正文、协作鉴权及 Yjs PostgreSQL 持久化均未开始。

## M2 · 可靠的实时协作文档（估计 2–3 周）

**功能：** 去除演示令牌；NestJS 发放短时协同票据；Hocuspocus 校验 membership；Binary CRDT 存 PostgreSQL；在线光标；断线重连与权限校验。

**测试门槛：** 2–3 个浏览器并发编辑无内容丢失/重复；服务重启后恢复；非法 token 与跨空间访问必须失败；读者写入被拒。

**不包含：** 富文本引擎重写；完整离线多端冲突 UI。

## M3 · 流程图、任务与稳定关联（估计 2–3 周）

**功能：** React Flow 画布 CRUD、Task 看板、跨视图 EntityLink、从需求跳到流程节点/任务、乐观锁与简单版本冲突提示。

**测试门槛：** 修改任意视图不会复制覆盖其他视图内容；关联双向可跳转；跨 workspace 链接被拒；删除实体有断链提示。

## M4 · AI 建议与历史（估计 1–2 周）

**功能：** NestJS 代理可选文本模型；AI 审查所选文档与关联任务；带引用的结构化建议、Diff、人工确认；保存版本/事件审计。

**测试门槛：** AI 未经确认没有任何写权限；版本变化时建议不能盲目覆盖；模型失败/超时可安全恢复；请求记录去敏。

## M5 · 作品集级打磨（估计 1–2 周）

**功能：** Playwright 双窗口/断网 E2E、性能分析、可访问性审核、CI/CD、部署预览、演示视频、README 技术复盘。

**测试门槛：** 任意新开发者按 README 可启动；CI 全绿；清楚说明 CRDT、认证、二进制持久化、跨视图 ID 关联、AI 审批等取舍。

## 推荐开发节奏

- 一个 PR 一个用户价值闭环；建议每次改动集中在 1–2 个模块。
- 每个 PR 包括：目的、风险、测试过程、结果截图/日志、工程复盘。
- 每周一次真实体验：找朋友从零打开协作文档完成任务；记录卡住环节。
- 记录 Vibe Coding 使用：任务拆解、Codex prompt、人工审查、失败原因与最后修复。
- 如果 M1/M2 进度超出预期，暂缓 M3/M4，优先把第一条闭环做可靠。

## 面试素材清单

1. `README` 截图/演示视频：二人实时编辑、断线恢复、权限拒绝。
2. Mermaid 架构、数据流、跨视图实体结构。
3. 关键 ADR：为何拆 Hocuspocus、为何 Binary Yjs、为何稳定 ID。
4. 可复现测试、性能/延迟记录、一次真实 Bug 的根因分析。
5. Codex 任务记录：AI 生成了什么、本人审查修改了什么、怎样验证。
