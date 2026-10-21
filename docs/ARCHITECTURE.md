# Weavefield · 技术架构说明

> 状态：v0.1 设计基线；M1.1 增加数据库基础设施（验收结果见 [M1.1 报告](reports/M1.1.md)）。M1.2 认证已通过 PR #2 合并并通过 Linux CI。M1.3 已实现工作空间 API、成员管理及服务端 RBAC（本地验收见 [M1.3 报告](reports/M1.3.md)，Linux CI 待验证）。**文档 CRUD、正式协作鉴权及 PostgreSQL 协作持久化仍未实现，以下协作生产流程仍为目标设计。**

## 1. 系统分层

```mermaid
flowchart TB
    U[React Web · BlockNote · React Flow] -->|REST HTTPS| A[NestJS API]
    U -->|Yjs / WebSocket WSS| H[Hocuspocus Server]
    A -->|Prisma| P[(PostgreSQL)]
    H -->|load/store Yjs binary| P
    H -->|verify membership/token| A
    A -->|later: server-only AI request| L[LLM Provider]
```

**边界约束：**

- **Web：** 负责 UI、协作 Y.Doc、本地可视状态。只持有短期授权凭据，无服务端 API Key。
- **NestJS：** 工作空间、用户、邀请、角色权限、文档/任务/流程图元数据、AI 建议与操作审计的唯一业务入口。
- **Hocuspocus：** 维护在线 Yjs 连接、传输/合并 CRDT 更新、意识状态（cursor / presence）与快照。不是第二套业务 API。
- **PostgreSQL：** 业务关系与 Yjs 二进制持久化（目标）；`docSnapshots` 及 audit 提供恢复和排错基础。
- **packages/shared：** 跨端 DTO 与运行时校验，禁止客户端决定权限。

### M1.1 数据库基础设施

- `infra/docker-compose.yml` 使用 PostgreSQL 16，仅向 `127.0.0.1` 发布端口，命名卷保存数据，`pg_isready` 健康检查配合 `up --wait`；密码从被忽略的环境文件注入。开发与验收使用不同 Compose 项目、端口和数据库，操作前需确认卷归属。
- `packages/database/prisma/schema.prisma` 是模型定义的唯一来源；`prisma/migrations` 保存初始 SQL 与迁移历史定义。初始迁移包括 10 张现有草案表，没有删除后续模型；M1.2 另增认证迁移，不修改初始迁移。`db:deploy` 应用迁移，`db:generate` 将 Prisma 6.19.3 Client 生成到 `packages/database/generated/client`，生成物不入库。
- `packages/database/src/index.ts` 将生成类型与进程内共享 `prisma` 实例统一导出，编译为 CommonJS 供后续 NestJS 使用。导入不会立即连接；各服务管理连接生命周期，并为自身进程注入 `DATABASE_URL`。不同服务进程各有连接池，不共享跨进程单例。M1.2 的 DatabaseService 已通过 NestJS Provider 连接该实例，应用启用关闭钩子；M1.3 工作空间模块复用同一 Provider，不新建连接池。
- `Membership` 用 `(workspaceId, userId)` 复合主键防止重复成员；新增 `userId` 索引补足按用户查询和外键删除检查。Document 的 `(workspaceId, updatedAt)` 索引用于空间内文档列表。删除空间级联删除成员关系、文档及其快照；删除用户只删除成员关系，不删除工作空间。
- 数据库外键和唯一约束验证关系完整性，不能替代授权。Workspace 没有自动生成 owner 的数据库约束；M1.3 使用事务一起创建空间与 OWNER。M1.2 实现邮箱规范化，M1.3 在 Workspace / Membership 接口实施角色与租户检查，尚不覆盖文档等后续实体。
- DocumentSnapshot（`Bytes`）、Board、BoardNode、BoardEdge、Task、EntityLink 当前仅有表结构。BoardEdge 的端点 ID、Task 的 assigneeId 和 EntityLink 的多态引用尚无目标实体外键；启用这些业务前须验证对象存在、归属及删除策略。本轮未把普通二进制字段读写等同于 Yjs PostgreSQL 持久化。
- `packages/database/test/integration.cjs` 在显式指定的本机测试库验证真实迁移、CRUD、约束、事务和级联删除；测试不执行 reset，也不重启或清空用户已有数据库。服务重启持久化需在保留同一卷的情况下另行精确比较已提交记录。

### M1.2 认证数据流

```mermaid
sequenceDiagram
    participant W as React / Vite
    participant A as NestJS AuthController
    participant S as AuthService / PasswordService
    participant P as PostgreSQL / Prisma
    W->>A: POST /auth/register 或 login (JSON + Origin + 自定义头)
    A->>A: CSRF / 输入 / 限流检查
    A->>S: 规范化邮箱及密码
    S->>S: scrypt 哈希或定时安全比较
    S->>P: 用户与 Session 摘要写入事务
    A-->>W: HttpOnly Cookie + 公开用户信息 + 绝对过期时间
    W->>A: GET /auth/me (Cookie)
    A->>P: 查询摘要、过期与撤销状态
    A-->>W: 公开用户信息或 401
    W->>A: POST /auth/logout
    A->>P: 删除当前 Session
    A-->>W: 204 + 清除 Cookie
```

数据库包实例由 DatabaseService 在 onModuleInit/onModuleDestroy 中连接和断开。Session 为随机不透明凭据，七天绝对过期；不把 Token 放进 React 状态、localStorage 或 JSON 响应。M1.3 将真实身份与会话刷新集中到 AuthProvider，AuthPanel 和 WorkspacePanel 共享状态，并处理过期、网络错误和请求竞争。Nova、协作演示访客及协作令牌仍与认证账号分离，登录不创建 Membership，不发放协作权限。

生产 Cookie、CSRF、防暴力尝试、旧数据兼容和当前限制统一记录在 [ADR-0004](decisions/ADR-0004-database-cookie-sessions.md)。本轮仍为单实例、loopback API，没有提供公网部署或共享限流。

### M1.3 工作空间与权限数据流

`WorkspacesModule` 复用 AuthModule / DatabaseModule。`SessionGuard` 严格解析 Cookie，调用 AuthService.me 验证过期与撤销，把已验证用户放入请求；写请求复用 Origin / JSON / 自定义头校验。Controller 校验字段白名单、名称、slug、角色及 ID，不接收客户端创建者。Service 明确 select 安全 DTO，不返回密码或 Session。

- 列表按当前用户 ID 查询 Membership；详情与成员读取在 RepeatableRead 事务内先检查 Membership，再读取同一快照。非成员与不存在空间均为相同 404，避免通过 ID 枚举区分存在性。
- 创建在同一事务内写 Workspace + OWNER Membership，任一步失败全部回滚。
- 名称和成员的所有写入在 ReadCommitted 事务内先 `SELECT ... FROM "Workspace" ... FOR UPDATE`，等待锁后重新读取操作者角色。仅 OWNER 继续；目标成员按 `(workspaceId,userId)` 读取，禁止跨租户引用。
- 删除或降级 OWNER 前计数；最后一个 OWNER 返回 409。有两位 OWNER 时允许自降级或退出。父行锁将同空间写入串行化，ReadCommitted 保证锁等待后的查询看见最新已提交状态，防止双降级、双退出以及已经被移除的操作者继续写入。
- `WorkspaceAccess.require` 接受事务 Client，集中成员与 OWNER 判断并由模块导出，供后续文档 API 复用；M1.4 仍须在相应资源查询中落实 workspace 归属，不能仅挂 Guard 即宣称完成文档授权。

React 的 `AuthProvider` 是身份唯一来源。`WorkspacePanel` 按用户 ID 隔离实例，打开时加载列表与所选空间/成员；持久化仅为按用户分组的选择 ID，不存角色或成员信息。响应序号和组件生命周期检查丢弃旧请求；401 清理认证与受保护状态，404 移除失效选择，403 显示拒绝并重新加载真实角色。窗口打开期间提供手动、聚焦和每分钟刷新；没有成员变动推送。Nova 和 M0 编辑器保持静态演示，真实空间不关联这些共享文档。

当前约束只覆盖通过该 Service 的写入口。数据库本身没有“至少一位 OWNER”的跨行约束；直接 SQL、脚本或未来 User 删除的级联可绕过，新增入口必须沿用父行锁协议。还未提供 Workspace 删除、邮件邀请、文档 CRUD、协作票据或审计日志。并发与性能取舍见 [ADR-0005](decisions/ADR-0005-workspace-membership-rbac.md)。

## 2. 开发与生产的安全边界

当前 `apps/collab` 是**强制仅 localhost + 强制拒绝 production**的开发演示服务；`COLLAB_DEV_TOKEN` 是测试配置，可在浏览器看到，不能代表真实身份。只用于验证两浏览器同步和 Yjs 文件快照。正式协同必须先落地下列流程：

1. Web 登录 NestJS，拿到访问令牌/安全会话。
2. 通过 `/documents/:id/collab-ticket` 请求**短期、绑定用户与 documentId** 的一次性或可限制的票据。
3. Hocuspocus `onAuthenticate` 对票据签名、过期、房间 ID、成员权限进行**服务端验证**，拒绝不匹配/已吊销成员。
4. viewer 必须从服务端禁止写入；仅仅禁用 BlockNote 的编辑按钮不够。
5. 用用户 ID + workspace ID + room ID 记录脱敏审计日志；建立速率限制和连接/文档大小上限。
6. 使用 WSS + 可信 Origin 校验 + 反向代理，严禁让匿名用户随便构造 room 订阅私有文档。

## 3. 实时文档的数据流

```mermaid
sequenceDiagram
    participant A as 浏览器 A
    participant B as 浏览器 B
    participant API as NestJS
    participant HP as Hocuspocus
    participant DB as PostgreSQL
    A->>API: 登录 / 获得 doc ticket
    B->>API: 登录 / 获得 doc ticket
    A->>HP: 加入 doc room + ticket
    HP->>API: 校验可读写权限
    HP->>DB: 读取上次 Yjs Binary Snapshot
    HP-->>A: 增量同步
    B->>HP: 加入相同房间
    HP-->>B: 同步共享文档
    A->>HP: Yjs 增量更新
    HP-->>B: 广播更新与 awareness
    HP->>DB: debounced binary snapshot
```

**持久化：** 用 `Y.encodeStateAsUpdate(ydoc)` 保存完整状态（`Uint8Array / Bytes`），读取时 `Y.applyUpdate`；不能在编辑后把 BlockNote JSON 重新生成一份新 Y.Doc 来充当持久数据，否则可能出现重复内容和 CRDT 历史异常。Presence 是临时状态，不应当保存进文档正文。

**本地演示：** 二进制 `.bin` 文件位于 `apps/collab/.local`。开发版默认写入不是业务数据库；仅验证 API 交互契约。M2 接入 PostgreSQL 时，删除 dev-only 读写逻辑和令牌后才能发布。

## 4. 文档 ↔ 流程图 ↔ 任务的统一业务身份

三个视图不应存三份独立的「登录需求」文本。核心做法：

- `Document` 有自己的 `docId` 和 `ydocRoomName`。
- BlockNote 中重要的需求块通过持久 ID（例如 `blockId` + `documentId`）建立 `RequirementRef`。
- `BoardNode` 拥有 `nodeId`（属于 board，带坐标、类型和 version）。
- `Task` 拥有 `taskId`、状态与负责人。
- `EntityLink` 以 `(sourceType, sourceId, targetType, targetId, relation)` 记录跨视图引用。

**不要将文档文字自动复制到流程图 / 任务并相互覆盖。** 关联保存 ID，UI 根据权限异步加载实体摘要。实体删除时应显式标记断链或清除，并提供 UI 提示。

## 5. 任务与图表同步的设计决策

- 第一版 React Flow 的节点布局从 API 获取并保存；后期共享编辑需要一个可验证的冲突模型。
- 不把 Y.Doc 直接当作所有业务数据的唯一存储；业务权限/状态/索引仍归 Postgres。
- 对任务 CRUD 可以先采用乐观锁 `version`、WebSocket 推送状态变化；流程画布若多人同改节点，后期使用 Yjs Map 或服务端串行化事件，并说明取舍。
- 保留 HTTP REST 请求用于 CRUD 和持久元数据，不使用纯广播替代持久层。

## 6. AI 协作架构（M4，尚未实现）

```mermaid
flowchart LR
  Client[用户发起审查] --> API[带身份的 NestJS AI Controller]
  API --> Context[权限过滤 + 引用上下文]
  Context --> Model[文本 LLM]
  Model --> Patch[结构化 SuggestedPatch]
  Patch --> Review[客户端 Diff / 引用 / 确认]
  Review -->|确认 + 基线版本校验| API
  API -->|事务 + 审计| Database[(数据库 / Yjs)]
```

- 模型只返回建议，不拥有直接改文档或执行本地命令的能力。
- 建议应用必须携带 base version / 状态向量；冲突时提示重新计算或人工合并。
- 所有 LLM 请求从 NestJS 服务端发出。支持模型可替换与 token 预算，但 MVP 可以完全没有 AI。

## 7. 运维与部署建议

- Web 可静态部署；API 与 Collab 独立 Node 容器；Postgres 托管或 Docker。
- M2 单实例 Hocuspocus 起步，不急于引入 Redis。未来多实例时评估分布式 Yjs 同步与存储一致性。
- 日志：`traceId`、userId hash、workspaceId、roomId、请求耗时、错误码；敏感内容及 token 不进日志。
- CI：独立 PostgreSQL 16 服务，Schema、数据库集成与升级、Auth / Workspace API 集成、类型检查、单元测试、构建及完整 Playwright E2E。M1.3 新增步骤尚待真实 Linux PR 运行。
- 监控：WebSocket 活跃连接数、存储失败次数、内容写入延迟、未授权请求、堆内存和文档尺寸。

## 8. 技术风险清单

| 风险 | 对策 |
|---|---|
| CRDT 文档重复/丢失 | Binary state；重启/断线/并发 E2E |
| WebSocket 权限漏洞 | 独立 `onAuthenticate` + membership query + write guard |
| 项目范围膨胀 | 按 Roadmap 门禁推进；先文档再流程和 AI |
| 富文本升级兼容性 | 锁文件 + 兼容测试，BlockNote v0.52+ 使用 `withCollaboration` |
| Hocuspocus v4 协议变更 | 统一 v4 provider/server，Node 22+，参考官方迁移指南 |
| 多视图状态漂移 | 关联稳定 ID，独立关系表，不复制文字 |
| AI 覆盖人类修改 | SuggestedPatch + 版本校验 + 人工确认 |

## 9. ADR

- [ADR-0001 NestJS 和 Hocuspocus 分离](decisions/ADR-0001-separate-api-and-collab.md)
- [ADR-0002 Yjs Binary 为协同权威状态](decisions/ADR-0002-yjs-binary.md)
- [ADR-0003 跨视图稳定实体关系](decisions/ADR-0003-entity-links.md)
- [ADR-0004 数据库 Cookie Session](decisions/ADR-0004-database-cookie-sessions.md)

- [ADR-0005 Workspace 与 Membership RBAC 及并发 OWNER 保护](decisions/ADR-0005-workspace-membership-rbac.md)
