import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WorkspaceRole } from '@weavefield/database';
import { DatabaseService } from '../database/database.module';
import { WorkspaceAccess } from '../workspaces/workspace-access.service';
import type { createTaskInput, updateTaskInput } from './tasks.input';

const metadata = { id: true, workspaceId: true, title: true, description: true, status: true, version: true } as const;
@Injectable()
export class TasksService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  private async task(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    const task = await tx.task.findFirst({ where: { id, workspaceId }, select: metadata });
    if (!task) throw new NotFoundException('任务不存在或不可访问');
    return task;
  }
  list(userId: string, workspaceId: string) {
    return this.database.client.$transaction(async tx => {
      await this.access.require(tx, userId, workspaceId);
      return tx.task.findMany({ where: { workspaceId }, select: metadata, orderBy: [{ status: 'asc' }, { id: 'asc' }] });
    }, { isolationLevel: 'RepeatableRead' });
  }
  detail(userId: string, workspaceId: string, id: string) {
    return this.database.client.$transaction(async tx => {
      await this.access.require(tx, userId, workspaceId);
      return this.task(tx, workspaceId, id);
    }, { isolationLevel: 'RepeatableRead' });
  }
  private write<T>(userId: string, workspaceId: string, operation: (tx: Prisma.TransactionClient, role: WorkspaceRole) => Promise<T>) {
    return this.database.client.$transaction(async tx => {
      // 与成员管理共享父行锁；等待后重新读取角色，避免排队写入沿用旧权限。
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
      return operation(tx, await this.access.require(tx, userId, workspaceId));
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 });
  }
  private writable(role: WorkspaceRole) { if (role === 'VIEWER') throw new ForbiddenException('此操作需要 OWNER 或 EDITOR 权限'); }
  create(userId: string, workspaceId: string, input: ReturnType<typeof createTaskInput>) {
    return this.write(userId, workspaceId, async (tx, role) => {
      this.writable(role);
      return tx.task.create({ data: { workspaceId, ...input }, select: metadata });
    });
  }
  update(userId: string, workspaceId: string, id: string, input: ReturnType<typeof updateTaskInput>) {
    return this.write(userId, workspaceId, async (tx, role) => {
      await this.task(tx, workspaceId, id);
      this.writable(role);
      const { version, ...changes } = input;
      const updated = await tx.task.updateMany({ where: { id, workspaceId, version }, data: { ...changes, version: { increment: 1 } } });
      if (!updated.count) throw new ConflictException('任务已被其他人修改，请加载最新版本后重新编辑');
      return this.task(tx, workspaceId, id);
    });
  }
}
