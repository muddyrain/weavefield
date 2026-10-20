# Weavefield · 织域

> 把需求、流程和任务编织成同一个可协作的项目空间。

Weavefield 是一个面向 2–8 人小团队的实时协作工作台：**多人文档（BlockNote + Yjs）→ 结构化流程图 → 关联开发任务 → AI 审查建议**。不是重新写富文本引擎，也不是做一个功能更少的 Notion。

## 当前交付状态

- [x] 独立 Git 仓库结构、PRD、架构、数据模型、ADR、开发路线图、Codex 任务清单
- [x] `pnpm` workspace / Turborepo 工程配置
- [x] React + Vite Web 初始界面与 BlockNote/Hocuspocus **本地协作演示代码**
- [x] NestJS `/health` 基础模块、Hocuspocus 本地开发服务、Prisma 数据模型草案
- [ ] **依赖安装、类型检查、集成测试尚未执行**（创建环境无法访问 npm registry）
- [ ] **正式认证、数据库持久化、工作空间 CRUD 均尚未实现**
- [ ] 远程 GitHub 仓库未创建（请依照下方说明创建后推送本地仓库）

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

## 本地运行（已提供源码，需在有 npm 网络的机器执行）

**环境：Node.js 22.12+（建议近期 22 LTS）、pnpm 10、Docker（可选）。** 当前 Hocuspocus v4 需要 Node 22+。Web `5173`、API `3001`、协作 WebSocket `1234`。

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install
cp apps/web/.env.example apps/web/.env
cp apps/collab/.env.example apps/collab/.env
cp apps/api/.env.example apps/api/.env
pnpm dev
```

打开 `http://localhost:5173/?doc=demo-project`。在两个浏览器窗口打开**相同 URL**，输入文字，检查协作与光标。开发演示会将 Yjs 二进制快照写到 `apps/collab/.local/`。第一次启动若协作服务还没准备好，页面会显示连接状态。

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

首次依赖安装后应生成 `pnpm-lock.yaml` 并提交。出于本次环境网络限制，锁文件尚未生成；CI 暂使用 `--no-frozen-lockfile`，生成后应改为 `--frozen-lockfile`。

## 在 GitHub 新建独立仓库并推送

在 GitHub 新建 **空仓库** `weavefield`，建议先设为 Private，**不要选择自动创建 README / .gitignore / LICENSE**（本地已有提交）。

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/weavefield.git
git push -u origin main
```

如果本地尚未 git 初始化，先执行 `git init -b main && git add . && git commit -m "chore: bootstrap weavefield"`。

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
