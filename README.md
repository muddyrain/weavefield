# Weavefield · 织域

> 把需求、流程和任务编织成同一个可协作的项目空间。

Weavefield 是一个面向 2–8 人小团队的实时协作工作台：**多人文档（BlockNote + Yjs）→ 结构化流程图 → 关联开发任务 → AI 审查建议**。不是重新写富文本引擎，也不是做一个功能更少的 Notion。

## 当前交付状态

- [x] 独立 Git 仓库结构、PRD、架构、数据模型、ADR、开发路线图、Codex 任务清单
- [x] `pnpm` workspace / Turborepo 工程配置
- [x] React + Vite Web 初始界面与 BlockNote/Hocuspocus **本地协作演示代码**
- [x] NestJS `/health` 基础模块、Hocuspocus 本地开发服务、Prisma 数据模型草案
- [x] M0 依赖安装、锁文件、类型检查、单元测试与构建验证（Node 22 LTS）
- [ ] **正式认证、数据库持久化、工作空间 CRUD 均尚未实现**
- [x] GitHub 仓库已创建，本地 `origin` 已配置
- [ ] 待审查的 M0 改动尚未提交，首次公开推送尚未执行；写入认证仍需验证

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
│  ├─ database/            # Prisma schema (DB 接入 M1/M2)
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

**环境：Node.js 22 LTS、pnpm 10.18.0、Docker（可选）。** 项目以实际验证过的 **Node.js 22.23.3** 为开发与 CI 基准：`.nvmrc` 固定该版本，CI 从同一文件读取；`package.json` 的 `engines.node` 为 `>=22.23.3 <23`，`packageManager` 固定 `pnpm@10.18.0`。系统 Node 26 不在项目声明的支持范围内；engines 是版本声明，不会自动切换运行时。Web `5173`、API `3001`、协作 WebSocket `1234`。

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

启动 PostgreSQL（后续工作空间/用户模型使用，当前演示无需连接）：

```bash
docker compose -f infra/docker-compose.yml up -d
cp packages/database/.env.example packages/database/.env
pnpm --filter @weavefield/database db:generate
pnpm --filter @weavefield/database db:migrate
```

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

GitHub 仓库 [muddyrain/weavefield](https://github.com/muddyrain/weavefield) 已创建，本地 `origin` 的 fetch/push 地址均为 `https://github.com/muddyrain/weavefield.git`。2026-10-20 的 `git ls-remote origin` 检查成功且未返回任何引用，远程仓库仍为空。仓库已创建不代表代码已推送。

本地 `main` 已有历史提交，但待审查的 M0 工程改动、开发规范调整和验收报告尚未提交，首次公开推送尚未执行；`main` 尚无远程跟踪分支。本机 Git 的写入认证仍需验证，不能从公开仓库的只读访问成功推断有写入权限。本次在 PATH 和常见安装位置未找到 GitHub CLI，未执行 CLI 认证命令；即使后续 CLI 认证可用，也不必然证明 Git 使用同一套凭据。

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
