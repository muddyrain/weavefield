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
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = fields(body, ['name', 'slug']);
    return this.workspaces.create(request.identity.user.id, workspaceName(input.name), workspaceSlug(input.slug));
  }
  @Get()
  list(@Req() request: AuthenticatedRequest) { return this.workspaces.list(request.identity.user.id); }
  @Get(':workspaceId/members')
  members(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.members(request.identity.user.id, resourceId(workspaceId));
  }
  @Get(':workspaceId')
  detail(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.detail(request.identity.user.id, resourceId(workspaceId));
  }
  @Patch(':workspaceId')
  rename(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = fields(body, ['name']);
    return this.workspaces.rename(request.identity.user.id, resourceId(workspaceId), workspaceName(input.name));
  }
  @Post(':workspaceId/members')
  add(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    const input = fields(body, ['email', 'role']);
    return this.workspaces.addMember(request.identity.user.id, resourceId(workspaceId), normalizeEmail(input.email), memberRole(input.role === undefined ? 'VIEWER' : input.role));
  }
  @Patch(':workspaceId/members/:userId')
  changeRole(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @Body() body: unknown) {
    const input = fields(body, ['role']);
    return this.workspaces.changeRole(request.identity.user.id, resourceId(workspaceId), resourceId(userId), memberRole(input.role));
  }
  @Delete(':workspaceId/members/:userId')
  @HttpCode(204)
  remove(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('userId') userId: string, @Body() body: unknown) {
    fields(body, []);
    return this.workspaces.removeMember(request.identity.user.id, resourceId(workspaceId), resourceId(userId));
  }

}
