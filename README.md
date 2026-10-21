# Weavefield · 织域

> 把需求、流程和任务编织成同一个可协作的项目空间。

Weavefield 是一个面向 2–8 人小团队的实时协作工作台：**多人文档（BlockNote + Yjs）→ 结构化流程图 → 关联开发任务 → AI 审查建议**。不是重新写富文本引擎，也不是做一个功能更少的 Notion。

## 当前交付状态

- [x] 独立 Git 仓库结构、PRD、架构、数据模型、ADR、开发路线图、Codex 任务清单
- [x] `pnpm` workspace / Turborepo 工程配置
- [x] React + Vite Web 初始界面与 BlockNote/Hocuspocus **本地协作演示代码**
- [x] NestJS `/health` 基础模块、Hocuspocus 本地开发服务
- [x] M0 依赖安装、锁文件、类型检查、单元测试与构建验证（Node 22 LTS）
- [x] M1.1 PostgreSQL 16 / Prisma 初始迁移与数据库包已通过本地验收，待人工审查（见 [M1.1 报告](docs/reports/M1.1.md)）
- [ ] **正式认证、工作空间 CRUD、Yjs PostgreSQL 持久化尚未实现**；M0 协作仍使用本地二进制文件
- [x] GitHub 仓库已创建，本地 `origin` 已配置
- [x] M0 及后续测试、演示体验修复已推送，Linux GitHub Actions 已通过

> ⚠️ `apps/collab` 的默认实现**仅用于 localhost 的开发验证**：静态开发令牌、文件系统 Yjs 快照。强制拒绝在 `NODE_ENV=production` 下启动。部署前必须实现服务端鉴权与访问控制，将快照迁移到 PostgreSQL（见架构文档和路线图）。

## 技术栈

- **Web**：React 19、Vite、TypeScript、BlockNote、React Flow（后续里程碑）、Zustand（后续）
- **业务 API**：NestJS、Prisma、PostgreSQL
- **协作服务**：Yjs、Hocuspocus v4；在独立服务中负责 CRDT 同步
- **工程化**：pnpm Workspaces、Turborepo、Vitest、GitHub Actions
- **AI**：第二阶段在 NestJS 服务端接入可替换的文本 LLM；第一版不需要模型

## 目录结构

```text
weavefield/
├─ apps/
│  ├─ web/                 # React + Vite + BlockNote
│  ├─ api/                 # NestJS HTTP API
│  └─ collab/              # Hocuspocus + Yjs 开发协作服务
├─ packages/
│  ├─ database/            # Prisma schema、迁移、统一服务端 Client 入口
│  └─ shared/              # 公共协议、校验
├─ docs/
│  ├─ PRD.md
│  ├─ ARCHITECTURE.md
│  ├─ DATA_MODEL.md
│  ├─ ROADMAP.md
│  ├─ CODEX_TASKS.md
│  └─ decisions/
├─ infra/                  # Docker Compose
├─ .github/workflows/      # CI 草案
├─ AGENTS.md               # Codex 项目约束
└─ package.json
```

## 本地运行

**环境：Node.js 22 LTS、pnpm 10.18.0、Docker（M0 可选，M1.1 数据库验收必需）。** 项目以实际验证过的 **Node.js 22.23.3** 为开发与 CI 基准：`.nvmrc` 固定该版本，CI 从同一文件读取；`package.json` 的 `engines.node` 为 `>=22.23.3 <23`，`packageManager` 固定 `pnpm@10.18.0`。系统 Node 26 不在项目声明的支持范围内；engines 是版本声明，不会自动切换运行时。Web `5173`、API `3001`、协作 WebSocket `1234`。

### Windows 开发环境准备

先由开发者通过已有的版本管理器手动安装或切换到 Node.js 22.23.3，也可从 [Node.js 官方归档](https://nodejs.org/en/download/archive/v22.23.3) 获取适合本机架构的 Windows 安装包或 ZIP。使用 ZIP 时应保存在长期使用的开发工具目录，并由开发者选择运行时。项目不会自动安装或替换系统 Node，也不修改全局 PATH；临时验证目录中的 Node 不作为后续开发环境。

选择运行时后，新开 PowerShell，在仓库根目录检查：

```powershell
node --version
node -p "process.execPath"
Get-Command node | Select-Object Source
pnpm --version
```

预期 Node 为 `v22.23.3`，pnpm 为 `10.18.0`。若仍显示系统 Node 26，应先手动完成版本选择，再安装依赖或启动项目；已运行的服务也需要由开发者在选好版本后重启，才会改用新的运行时。若尚未配置 pnpm，可在所选 Node 22 环境中手动执行下方 Corepack 两条命令；已有正确 pnpm 版本时可跳过它们。

### 安装与启动

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env
cp apps/collab/.env.example apps/collab/.env
cp apps/api/.env.example apps/api/.env
pnpm dev
```

打开 `http://127.0.0.1:5173/?doc=demo-project`。在两个浏览器窗口打开**相同 URL**，输入文字，检查协作与光标。开发演示会将 Yjs 二进制快照写到 `apps/collab/.local/snapshots/doc-demo-project.bin`，通常在最后编辑后 800 ms 写入（持续编辑时最多等待 2500 ms）。第一次启动若协作服务还没准备好，页面会显示连接状态。

上述 `cp` 在 PowerShell 中也可用。需要分别查看日志时，在三个终端运行 `pnpm dev:web`、`pnpm dev:api`、`pnpm dev:collab`。三个服务均绑定 `127.0.0.1`；此演示不提供局域网或公网访问。

Windows 文件名不能直接使用房间名里的冒号，因此磁盘使用 `doc-<id>.bin`，WebSocket 房间名仍为 `doc:<id>`。旧演示的 `doc:<id>.bin` 不会自动迁移；如有旧数据，应先备份。Yjs 二进制格式保持不变。

### M1.1：PostgreSQL 16 与 Prisma

先安装并启动 [Docker Desktop](https://docs.docker.com/desktop/)。以下命令在仓库根目录执行，Mac 使用终端，Windows 使用 PowerShell。确认 `docker info` 成功，`docker compose version` 可用；M0 编辑器演示仍可不启动数据库。

Mac 复制本地配置：

```bash
cp infra/.env.example infra/.env
cp packages/database/.env.example packages/database/.env
```

Windows 复制本地配置：

```powershell
Copy-Item infra/.env.example infra/.env
Copy-Item packages/database/.env.example packages/database/.env
```

只在目标文件不存在时复制，已有配置请手动核对。两个文件均被 Git 忽略。`infra/.env` 的 `POSTGRES_*` 用于 Compose，数据库包 `.env` 的 `DATABASE_URL` 用于 Prisma CLI，两者账号、密码、库名、端口必须匹配；URL 中密码的特殊字符需要百分号编码。示例凭据只适用于隔离的本地开发，不得用于公网或生产环境。

示例固定开发项目名 `weavefield-m11-dev`。已有 Compose 数据时先核对项目名和卷标签，沿用其归属；更换项目名会使用另一个卷。先检查已有容器与卷的项目标签，确认归属；如果本机 `5432` 已有数据库，修改 `POSTGRES_PORT` 和 `DATABASE_URL` 为一个空闲端口，不要停止或迁移其他项目的服务。

```bash
docker ps -a
docker volume ls
docker compose --env-file infra/.env -p weavefield-m11-dev -f infra/docker-compose.yml config --volumes
docker compose --env-file infra/.env -p weavefield-m11-dev -f infra/docker-compose.yml up -d --wait postgres
docker compose --env-file infra/.env -p weavefield-m11-dev -f infra/docker-compose.yml ps
docker compose --env-file infra/.env -p weavefield-m11-dev -f infra/docker-compose.yml exec -T postgres pg_isready -U weavefield -d weavefield
pnpm db:generate
pnpm --filter @weavefield/database db:validate
pnpm --filter @weavefield/database db:deploy
pnpm --filter @weavefield/database db:status
```

`pg_isready` 中账号和库名按本地配置调整。容器仅监听 `127.0.0.1`，使用命名卷保存数据。已有卷的账号/密码不会因修改 `.env` 自动更新。初始迁移包含全部 10 张草案表；User / Workspace / Membership / Document 是 M1 数据基础，DocumentSnapshot、Board、BoardNode、BoardEdge、Task、EntityLink 暂只有结构，没有对应业务功能。非空且无迁移历史的数据库需先评估、备份和制定基线方案，不能直接套用初始迁移，更不能 reset。

`db:deploy` 只应用已审查的迁移，不生成迁移，也不生成 Client；重复部署不会重复应用同一迁移。日后改 Schema 时，在独立开发库使用 `pnpm --filter @weavefield/database db:migrate --name <change>` 生成并审查 SQL；开发迁移需要 shadow database，不要指向共享库。不要修改已应用的迁移。

#### 独立数据库集成测试

复制 `infra/.env.example` 为 `infra/.env.test`，将 `POSTGRES_DB` 改为 `weavefield_test_m11`、`POSTGRES_PORT` 改为 `55432`（被占用则换空闲端口）；核对数据库包 `.env` 的 `DATABASE_TEST_URL`。保持独立项目名，测试不会使用日常开发卷。

```bash
docker compose --env-file infra/.env.test -p weavefield-m11-test -f infra/docker-compose.yml up -d --wait postgres
pnpm --filter @weavefield/database db:test
```

测试只接受本机、库名以 `weavefield_test_` 开头、`public` schema 的 URL；对该测试库应用迁移，创建随机标识的记录，验证读写、唯一/外键约束、事务回滚、重复部署保留数据、级联删除及其他空间数据保留，最后只清理本次记录。此测试不等于服务端租户授权测试。

GitHub Actions 使用独立的 PostgreSQL 16 临时服务运行相同检查；`weavefield_ci_only` 是该临时库的示例密码，不使用本地或生产凭据。未推送的修改仍需后续真实 CI 验收。

数据库重启验证应在同一测试卷中写入已提交记录，记录 ID 和内容，再执行：

```bash
docker compose --env-file infra/.env.test -p weavefield-m11-test -f infra/docker-compose.yml restart postgres
docker compose --env-file infra/.env.test -p weavefield-m11-test -f infra/docker-compose.yml up -d --wait postgres
```

用新建 Prisma 连接查询原 ID，并精确比较内容后，才算持久化通过；单纯再次运行会自行清理记录的 `db:test` 不能证明重启恢复。停止测试服务可使用相同参数的 `stop postgres`。不要使用 `down -v`、删除已有卷或 `prisma migrate reset`。

统一入口位于 `packages/database/src/index.ts`，先 `pnpm --filter @weavefield/database build`，服务端通过 workspace 依赖 `@weavefield/database` 导入 `prisma` 与生成类型。每个服务进程共享一个 Client/连接池；连接使用该进程的 `DATABASE_URL`。Prisma CLI 会读取数据库包 `.env`，普通 Node/NestJS 导入不会自动加载该文件。API 本轮仍只有 `/health`，尚未接入数据库；后续 NestJS provider 负责注入此实例、启动连接和关闭断开。Web 不得导入该包。

健康检查：`http://127.0.0.1:3001/health`。

## 质量检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

仓库已包含 `pnpm-lock.yaml`，CI 使用 `--frozen-lockfile`。pnpm 安装脚本仅允许 Prisma 和 esbuild；数据库 schema 可在不启动 PostgreSQL 的情况下通过 `pnpm db:generate` 生成客户端。修改依赖后请同步更新锁文件。

双窗口协作回归：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
# 本机展示两个浏览器窗口
pnpm test:e2e --headed
```

测试会自动启动独立的 Web/API/Collab（端口 `15173` / `13001` / `11234`），使用临时快照目录，验证 `/health`、双向编辑、刷新、断连期间双方编辑、重连收敛，以及清除浏览器内存并重启服务后的磁盘恢复。运行结束自动清理，不使用日常 `.local` 数据。测试失败时，trace 和截图在 `test-results/`。

手工恢复检查：编辑后等待至少 3 秒，关闭两个窗口并重启协作服务，重新打开相同 URL。确认原内容恢复；协作服务停止时保持窗口打开并输入，重启后确认双方内容合并。连接状态“已同步”表示客户端已同步，不是磁盘写入确认；进程在防抖写入前被强杀，最近修改仍可能丢失。

安装网络问题：若 npm registry 连接重置，可显式指定可用镜像，例如 `pnpm install --frozen-lockfile --registry=https://registry.npmmirror.com`。Prisma 引擎使用独立下载站；若引擎下载超时，可在当前终端设置 `PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma` 后重试 `pnpm db:generate`，无需修改业务代码。

M0 已验证的依赖组合：React/React DOM 19.3.1、BlockNote 0.52.1（三包同版）、Mantine 8.3.18、Yjs 13.6.33、Hocuspocus provider/server 4.7.1、NestJS 11.2.7、Prisma/client 6.19.3。BlockNote 协作入口需要显式安装可选 peer `y-prosemirror` / `y-protocols`。Nest CLI 的 webpack 固定版本暂配合 `schema-utils` 4.3.3；升级 CLI 时应重新核对并移除此约束。

## GitHub 远程仓库

GitHub 仓库 [muddyrain/weavefield](https://github.com/muddyrain/weavefield) 已有公开推送，`main` 跟踪 `origin/main`，当前本机远程使用 SSH。M0 与后续修复已通过 Linux CI；[M1.1 开发前的 main CI](https://github.com/muddyrain/weavefield/actions/runs/39539876436) 为 success。该结果不代表未提交的 M1.1 改动已通过远端验收；M0 历史报告保持原记录。

```bash
git status --short --branch
git remote -v
git branch -vv
git log -1 --oneline
git ls-remote origin
```

提交、推送和修改远程配置均需另行获得用户明确授权；上述只读检查不代表代码已经提交或发布。

本项目的源代码尚未决定对外许可，**不要把它视为可自由再发布**；依赖的开源许可证按各自规定遵守。

## 开工文档

1. [PRD · 用户与产品边界](docs/PRD.md)
2. [技术架构 · 数据流、安全与演进](docs/ARCHITECTURE.md)
3. [数据模型与跨视图关联](docs/DATA_MODEL.md)
4. [路线图与阶段验收](docs/ROADMAP.md)
5. [可直接交给 Codex 的第一轮指令](docs/CODEX_TASKS.md)

## 技术决策 / 参考

- BlockNote Yjs 协作：https://www.blocknotejs.org/docs/features/collaboration
- Hocuspocus v4：https://tiptap.dev/docs/hocuspocus/server/configuration
- Hocuspocus 二进制持久化：https://tiptap.dev/docs/hocuspocus/guides/persistence
- Prisma v6 文档：https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/generating-prisma-client
- Turborepo workspace：https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository

> 本项目为 AI 辅助开发学习/作品集工程，技术选择需以真实运行和测试结果为准，不能因为代码是 AI 生成就跳过验证。
