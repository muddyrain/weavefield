import { PrismaClient } from '../generated/client';

// 每个服务进程共享一个连接池；导入时不连接，生命周期由服务启动/关闭管理。
// 仅限服务端使用。NestJS 通过 provider 注入此实例，不再自行 new PrismaClient。
export const prisma = new PrismaClient();

export { Prisma, WorkspaceRole, TaskStatus } from '../generated/client';
export type {
  User, Session, Workspace, Membership, Document, DocumentSnapshot,
  Board, BoardNode, BoardEdge, Task, EntityLink,
} from '../generated/client';
