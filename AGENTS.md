# Codex / Coding Agent instructions — Weavefield

This repository is **a portfolio-grade realtime collaboration product**. The human developer owns architecture, decisions, code review and verification. Make focused, reviewable changes.

## What to read first

1. `README.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DATA_MODEL.md`
5. `docs/ROADMAP.md`
6. `docs/CODEX_TASKS.md`

## Product priorities

- First vertical slice: localhost two-tab collaborative rich-text editing with server-side persisted Yjs binary state; then authenticated workspaces.
- Second: link document block/requirement, workflow node and task via stable IDs; do not merely synchronize duplicate text.
- Later: AI-assisted review as **proposed** patches with human approval, not silent overwrites.
- No generic Figma/Notion replacement, no spreadsheet engine, no multi-agent orchestration in MVP.

## Architecture rules

- `apps/web`: UI and local interaction state. No database credentials, third-party API secrets, or filesystem access.
- `apps/api`: NestJS business resources, auth, membership checks, access policy and AI gateway.
- `apps/collab`: Yjs/Hocuspocus sync and binary persistence. Dev-token demo MUST NEVER be deployed publicly.
- `packages/database`: single Prisma schema/source of migrations.
- `packages/shared`: transport DTO/schema contract.
- Use existing BlockNote and React Flow libraries; never implement CRDT or rich-text engine from scratch.
- Maintain Yjs binary format on persistence; do not rehydrate a historical CRDT from JSON.
- Validate object permissions **on the server** before subscription/read/write; never trust client room names or role flags.
- Treat AI output and imported HTML as untrusted; no arbitrary execution.

## Execution practice

- BEFORE editing: state the slice, affected packages, risks, and acceptance test.
- Split work into small, coherent commits. Never change `valley-mas` or unrelated repos.
- Tests required for functional changes; run `pnpm typecheck && pnpm test && pnpm build` when dependencies are installed.
- If tooling or network unavailable, say so. Do not claim success for commands not run.
- Add ADR when changing protocol, storage format, or auth design.
- Prefer accessible components, keyboard support and reduced-motion friendly UI.
- Secrets must remain in `.env` (gitignored). No hardcoded production tokens.
- If creating any temporary bypass for development, bind localhost and refuse production, with TODO and docs.

## Immediate next task

Follow `docs/CODEX_TASKS.md` **Task 0: bootstrap verification**, then Task 1. Do not implement all roadmap phases at once.
