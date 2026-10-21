import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WorkspaceRole } from '@weavefield/database';
import { DatabaseService } from '../database/database.module';
import { WorkspaceAccess } from '../workspaces/workspace-access.service';

const metadata = { id: true, workspaceId: true, title: true, createdAt: true, updatedAt: true, archivedAt: true } as const;
const active = (workspaceId: string, id: string) => ({ id, workspaceId, archivedAt: null });

@Injectable()
export class DocumentsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  private writable(role: WorkspaceRole) {
    if (role === 'VIEWER') throw new ForbiddenException('此操作需要 OWNER 或 EDITOR 权限');
  }
  private async document(tx: Prisma.TransactionClient, workspaceId: string, documentId: string) {
    const document = await tx.document.findFirst({ where: active(workspaceId, documentId), select: metadata });
    if (!document) throw new NotFoundException('文档不存在或不可访问');
    return document;
  }
  list(userId: string, workspaceId: string) {
    return this.database.client.$transaction(async tx => {
      await this.access.require(tx, userId, workspaceId);
      return tx.document.findMany({ where: { workspaceId, archivedAt: null }, select: metadata,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
    }, { isolationLevel: 'RepeatableRead' });
  }
  detail(userId: string, workspaceId: string, documentId: string) {
    return this.database.client.$transaction(async tx => {
      await this.access.require(tx, userId, workspaceId);
      return this.document(tx, workspaceId, documentId);
    }, { isolationLevel: 'RepeatableRead' });
  }
  private write<T>(userId: string, workspaceId: string, operation: (tx: Prisma.TransactionClient, role: WorkspaceRole) => Promise<T>) {
    return this.database.client.$transaction(async tx => {
      // 与成员管理共享父行锁；锁后重新鉴权，同时串行化文档归档和重命名。
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
      const role = await this.access.require(tx, userId, workspaceId);
      return operation(tx, role);
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 });
  }
  async create(userId: string, workspaceId: string, title: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.write(userId, workspaceId, async (tx, role) => {
          this.writable(role);
          return tx.document.create({ data: { workspaceId, title, ydocRoomName: `doc:${randomUUID()}` }, select: metadata });
        });
      } catch (error) {
        const conflict = error as { code?: string; meta?: { target?: string[] } };
        if (conflict.code !== 'P2002' || !conflict.meta?.target?.includes('ydocRoomName')) throw error;
        // 唯一冲突会终止 PostgreSQL 事务；下一次使用新事务，不能在失败事务内重试。
        if (attempt === 2) throw new ConflictException('文档标识冲突，请重试');
      }
    }
    throw new ConflictException('文档标识冲突，请重试');
  }
  rename(userId: string, workspaceId: string, documentId: string, title: string) {
    return this.write(userId, workspaceId, async (tx, role) => {
      await this.document(tx, workspaceId, documentId);
      this.writable(role);
      const changed = await tx.document.updateMany({ where: active(workspaceId, documentId), data: { title } });
      if (!changed.count) throw new NotFoundException('文档不存在或不可访问');
      return this.document(tx, workspaceId, documentId);
    });
  }
  archive(userId: string, workspaceId: string, documentId: string) {
    return this.write(userId, workspaceId, async (tx, role) => {
      await this.document(tx, workspaceId, documentId);
      this.writable(role);
      const changed = await tx.document.updateMany({ where: active(workspaceId, documentId), data: { archivedAt: new Date() } });
      if (!changed.count) throw new NotFoundException('文档不存在或不可访问');
      return tx.document.findFirstOrThrow({ where: { id: documentId, workspaceId }, select: metadata });
    });
  }
}
