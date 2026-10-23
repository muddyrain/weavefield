import { ApiContract } from '../openapi/api-contract';
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
  @ApiContract({ tag: 'Document', summary: '成员列出未归档文档', description: '按 updatedAt 降序、id 升序。', status: 200, session: true, params: ['workspaceId'], response: 'Document', list: true, errors: [400, 401, 404, 503] })
  list(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) {
    return this.documents.list(request.identity.user.id, resourceId(workspaceId));
  }
  @Post()
  @ApiContract({ tag: 'Document', summary: 'OWNER / EDITOR 创建文档元数据', status: 201, session: true, params: ['workspaceId'], body: 'DocumentTitleInput', response: 'Document', errors: [400, 401, 403, 404, 409, 413, 503] })
  create(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) {
    return this.documents.create(request.identity.user.id, resourceId(workspaceId), titleInput(body));
  }
  @Get(':documentId')
  @ApiContract({ tag: 'Document', summary: '成员读取文档元数据', status: 200, session: true, params: ['workspaceId', 'documentId'], response: 'Document', errors: [400, 401, 404, 503] })
  detail(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string) {
    return this.documents.detail(request.identity.user.id, resourceId(workspaceId), resourceId(documentId));
  }
  @Patch(':documentId')
  @ApiContract({ tag: 'Document', summary: 'OWNER / EDITOR 重命名文档', status: 200, session: true, params: ['workspaceId', 'documentId'], body: 'DocumentTitleInput', response: 'Document', errors: [400, 401, 403, 404, 413, 503] })
  rename(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string, @Body() body: unknown) {
    return this.documents.rename(request.identity.user.id, resourceId(workspaceId), resourceId(documentId), titleInput(body));
  }
  @Post(':documentId/archive')
  @HttpCode(200)
  @ApiContract({ tag: 'Document', summary: 'OWNER / EDITOR 软归档文档', description: 'JSON 空对象；返回含 archivedAt 的元数据，保留快照；详情、改名与重复归档返回 404。', status: 200, session: true, params: ['workspaceId', 'documentId'], body: 'EmptyInput', response: 'Document', errors: [400, 401, 403, 404, 413, 503] })
  archive(@Req() request: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('documentId') documentId: string, @Body() body: unknown) {
    fields(body, []);
    return this.documents.archive(request.identity.user.id, resourceId(workspaceId), resourceId(documentId));
  }
}
