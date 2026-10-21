import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../auth/auth.http';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { fields, resourceId } from '../workspaces/workspace.input';
import { DocumentsService } from './documents.service';

function titleInput(body: unknown) {
  const { title } = fields(body, ['title']);
  if (typeof title !== 'string' || !title.trim() || Array.from(title.trim()).length > 200 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new BadRequestException('文档标题须为 1–200 个字符，不能含控制字符');
  }
  return title.trim();
}

@Controller('workspaces/:workspaceId/documents')
@UseGuards(SessionGuard)
@UseFilters(ApiErrors)
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}
  @Get()
  list(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.documents.list(request.identity.user.id, resourceId(workspaceId));
  }
  @Post()
  create(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return this.documents.create(request.identity.user.id, resourceId(workspaceId), titleInput(body));
  }
  @Get(':documentId')
  detail(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string) {
    return this.documents.detail(request.identity.user.id, resourceId(workspaceId), resourceId(documentId));
  }
  @Patch(':documentId')
  rename(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string, @Body() body: unknown) {
    return this.documents.rename(request.identity.user.id, resourceId(workspaceId), resourceId(documentId), titleInput(body));
  }
  @Post(':documentId/archive')
  @HttpCode(200)
  archive(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string, @Body() body: unknown) {
    fields(body, []);
    return this.documents.archive(request.identity.user.id, resourceId(workspaceId), resourceId(documentId));
  }
}
