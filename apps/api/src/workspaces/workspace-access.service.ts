import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@weavefield/database';

@Injectable()
export class WorkspaceAccess {
  async require(tx: Prisma.TransactionClient, userId: string, workspaceId: string, owner = false) {
    const membership = await tx.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { role: true } });
    if (!membership) throw new NotFoundException('工作空间不存在或不可访问');
    if (owner && membership.role !== 'OWNER') throw new ForbiddenException('此操作需要 OWNER 权限');
    return membership.role;
  }
}
