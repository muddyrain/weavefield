import { ApiContract } from '../openapi/api-contract';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { normalizeEmail } from '../auth/auth.input';
import { ApiErrors } from '../auth/auth.http';
import { fields, memberRole, resourceId, workspaceName, workspaceSlug } from './workspace.input';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(SessionGuard)
@UseFilters(ApiErrors)
export class WorkspacesController {
  constructor(@Inject(WorkspacesService) private readonly workspaces: WorkspacesService) {}
  @Post()
  @ApiContract({ tag: 'Workspace', summary: '创建空间并成为 OWNER', status: 201, session: true, body: 'CreateWorkspaceInput', response: 'Workspace', errors: [400, 401, 403, 409, 413, 503] })
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = fields(body, ['name', 'slug']);
    return this.workspaces.create(request.identity.user.id, workspaceName(input.name), workspaceSlug(input.slug));
  }
  @Get()
  @ApiContract({ tag: 'Workspace', summary: '列出当前用户加入的空间', status: 200, session: true, response: 'Workspace', list: true, errors: [401, 503] })
  list(@Req() request: AuthenticatedRequest) { return this.workspaces.list(request.identity.user.id); }
  @Get(':workspaceId/members')
  @ApiContract({ tag: 'Workspace', summary: '成员读取安全的成员列表', status: 200, session: true, params: ['workspaceId'], response: 'Member', list: true, errors: [400, 401, 404, 503] })
  members(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.members(request.identity.user.id, resourceId(workspaceId));
  }
  @Get(':workspaceId')
  @ApiContract({ tag: 'Workspace', summary: '成员读取空间详情', status: 200, session: true, params: ['workspaceId'], response: 'Workspace', errors: [400, 401, 404, 503] })
  detail(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.detail(request.identity.user.id, resourceId(workspaceId));
  }
  @Patch(':workspaceId')
  @ApiContract({ tag: 'Workspace', summary: 'OWNER 重命名空间', status: 200, session: true, params: ['workspaceId'], body: 'RenameWorkspaceInput', response: 'Workspace', errors: [400, 401, 403, 404, 413, 503] })
  rename(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = fields(body, ['name']);
    return this.workspaces.rename(request.identity.user.id, resourceId(workspaceId), workspaceName(input.name));
  }
  @Post(':workspaceId/members')
  @ApiContract({ tag: 'Workspace', summary: 'OWNER 按邮箱添加已注册账号', description: '不发送邮件、不创建待邀请账号；未知账号 404，已有成员 409。', status: 201, session: true, params: ['workspaceId'], body: 'AddMemberInput', response: 'Member', errors: [400, 401, 403, 404, 409, 413, 503] })
  add(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = fields(body, ['email', 'role']);
    return this.workspaces.addMember(request.identity.user.id, resourceId(workspaceId), normalizeEmail(input.email), memberRole(input.role === undefined ? 'VIEWER' : input.role));
  }
  @Patch(':workspaceId/members/:userId')
  @ApiContract({ tag: 'Workspace', summary: 'OWNER 修改成员角色', description: '最后一个 OWNER 不可降级；有其他 OWNER 时可自降级。', status: 200, session: true, params: ['workspaceId', 'userId'], body: 'ChangeRoleInput', response: 'Member', errors: [400, 401, 403, 404, 409, 413, 503] })
  changeRole(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @Body() body: unknown) {
    const input = fields(body, ['role']);
    return this.workspaces.changeRole(request.identity.user.id, resourceId(workspaceId), resourceId(userId), memberRole(input.role));
  }
  @Delete(':workspaceId/members/:userId')
  @HttpCode(204)
  @ApiContract({ tag: 'Workspace', summary: 'OWNER 移除成员', description: 'JSON 空对象；最后一个 OWNER 不可移除；有其他 OWNER 时可自行退出。', status: 204, session: true, params: ['workspaceId', 'userId'], body: 'EmptyInput', errors: [400, 401, 403, 404, 409, 413, 503] })
  remove(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @Body() body: unknown) {
    fields(body, []);
    return this.workspaces.removeMember(request.identity.user.id, resourceId(workspaceId), resourceId(userId));
  }

}
