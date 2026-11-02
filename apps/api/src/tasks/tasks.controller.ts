import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../auth/auth.http';
import { SessionGuard, type AuthenticatedRequest } from '../auth/session.guard';
import { ApiContract } from '../openapi/api-contract';
import { resourceId } from '../workspaces/workspace.input';
import { createTaskInput, updateTaskInput } from './tasks.input';
import { TasksService } from './tasks.service';

@Controller('workspaces/:workspaceId/tasks')
@UseGuards(SessionGuard)
@UseFilters(ApiErrors)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}
  @Get()
  @ApiContract({ tag: 'Task', summary: '成员列出空间任务', status: 200, session: true, params: ['workspaceId'], response: 'Task', list: true, errors: [400, 401, 404, 503] })
  list(@Req() r: AuthenticatedRequest, @Param('workspaceId') workspaceId: string) { return this.tasks.list(r.identity.user.id, resourceId(workspaceId)); }
  @Get(':taskId')
  @ApiContract({ tag: 'Task', summary: '成员读取空间内任务', status: 200, session: true, params: ['workspaceId', 'taskId'], response: 'Task', errors: [400, 401, 404, 503] })
  detail(@Req() r: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string) { return this.tasks.detail(r.identity.user.id, resourceId(workspaceId), resourceId(taskId)); }
  @Post()
  @ApiContract({ tag: 'Task', summary: 'OWNER / EDITOR 创建待办任务', description: '允许同名任务；未指定的 description 为 null，status 为 TODO，version 为 1。', status: 201, session: true, params: ['workspaceId'], body: 'CreateTaskInput', response: 'Task', errors: [400, 401, 403, 404, 413, 503] })
  create(@Req() r: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Body() body: unknown) { return this.tasks.create(r.identity.user.id, resourceId(workspaceId), createTaskInput(body)); }
  @Patch(':taskId')
  @ApiContract({ tag: 'Task', summary: 'OWNER / EDITOR 条件更新任务', description: 'version 必填，至少提供 title/description/status 一项；description:null 清空描述。过期版本 409；缺失或跨空间任务 404，先于角色检查。成功递增 version。', status: 200, session: true, params: ['workspaceId', 'taskId'], body: 'UpdateTaskInput', response: 'Task', errors: [400, 401, 403, 404, 409, 413, 503] })
  update(@Req() r: AuthenticatedRequest, @Param('workspaceId') workspaceId: string, @Param('taskId') taskId: string, @Body() body: unknown) { return this.tasks.update(r.identity.user.id, resourceId(workspaceId), resourceId(taskId), updateTaskInput(body)); }
}
