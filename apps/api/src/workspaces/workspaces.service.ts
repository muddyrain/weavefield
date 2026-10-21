import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, WorkspaceRole } from '@weavefield/database';
import { DatabaseService } from '../database/database.module';
import { WorkspaceAccess } from './workspace-access.service';

const workspaceSelect = { id: true, name: true, slug: true, createdAt: true } as const;
const memberSelect = { role: true, createdAt: true, user: { select: { id: true, email: true, displayName: true } } } as const;

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(WorkspaceAccess) private readonly access: WorkspaceAccess) {}
  async create(userId: string, name: string, slug: string) {
    try {
      const workspace = await this.database.client.$transaction(async tx => {
        const workspace = await tx.workspace.create({ data: { name, slug }, select: workspaceSelect });
        await tx.membership.create({ data: { workspaceId: workspace.id, userId, role: 'OWNER' } });
        return workspace;
      });
      return { ...workspace, role: 'OWNER' as const };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('空间标识已存在');
      throw error;
    }
  }
  async list(userId: string) {
    const memberships = await this.database.client.membership.findMany({ where: { userId },
      select: { role: true, workspace: { select: workspaceSelect } }, orderBy: [{ createdAt: 'asc' }, { workspaceId: 'asc' }] });
    return memberships.map(({ role, workspace }) => ({ ...workspace, role }));
  }
  members(userId: string, workspaceId: string) {
    return this.database.client.$transaction(async tx => {
      await this.access.require(tx, userId, workspaceId);
      return tx.membership.findMany({ where: { workspaceId }, select: memberSelect, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] });
    }, { isolationLevel: 'RepeatableRead' });
  }
  detail(userId: string, workspaceId: string) {
    return this.database.client.$transaction(async tx => {
      const role = await this.access.require(tx, userId, workspaceId);
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: workspaceSelect });
      return { ...workspace, role };
    }, { isolationLevel: 'RepeatableRead' });
  }
  private write<T>(userId: string, workspaceId: string, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.database.client.$transaction(async tx => {
      // 同一空间的所有写入按同一行串行化；等待锁后再读取成员身份和 OWNER 数量。
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
      await this.access.require(tx, userId, workspaceId, true);
      return operation(tx);
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 });
  }
  rename(userId: string, workspaceId: string, name: string) {
    return this.write(userId, workspaceId, async tx => ({
      ...await tx.workspace.update({ where: { id: workspaceId }, data: { name }, select: workspaceSelect }), role: 'OWNER' as const,
    }));
  }
  addMember(userId: string, workspaceId: string, email: string, role: WorkspaceRole) {
    return this.write(userId, workspaceId, async tx => {
      const user = await tx.user.findFirst({ where: { emailCanonical: email, passwordHash: { not: null } }, select: { id: true } });
      if (!user) throw new NotFoundException('已注册账号不存在');
      try { return await tx.membership.create({ data: { workspaceId, userId: user.id, role }, select: memberSelect }); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('该用户已是空间成员');
        throw error;
      }
    });
  }
  private async protectOwner(tx: Prisma.TransactionClient, workspaceId: string, userId: string, nextRole?: WorkspaceRole) {
    const target = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
    if (!target) throw new NotFoundException('空间成员不存在');
    if (target.role === 'OWNER' && nextRole !== 'OWNER'
      && await tx.membership.count({ where: { workspaceId, role: 'OWNER' } }) <= 1) {
      throw new ConflictException('工作空间必须至少保留一个 OWNER');
    }
  }
  changeRole(userId: string, workspaceId: string, targetId: string, role: WorkspaceRole) {
    return this.write(userId, workspaceId, async tx => {
      await this.protectOwner(tx, workspaceId, targetId, role);
      return tx.membership.update({ where: { workspaceId_userId: { workspaceId, userId: targetId } }, data: { role }, select: memberSelect });
    });
  }
  removeMember(userId: string, workspaceId: string, targetId: string) {
    return this.write(userId, workspaceId, async tx => {
      await this.protectOwner(tx, workspaceId, targetId);
      await tx.membership.delete({ where: { workspaceId_userId: { workspaceId, userId: targetId } } });
    });
  }

}
