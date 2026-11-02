import { BadRequestException } from '@nestjs/common';
import { fields } from '../workspaces/workspace.input';
import type { TaskStatus } from '@weavefield/database';

function title(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException('任务标题须为 1–200 个字符，不能含控制字符');
  }
  return value.trim();
}
function description(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || Array.from(value).length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new BadRequestException('任务描述最多 1000 个字符，只接受普通文本');
  }
  return value.replace(/\r\n?/g, '\n').trim() || null;
}
export function createTaskInput(body: unknown) {
  const data = fields(body, ['title', 'description']);
  return { title: title(data.title), description: data.description === undefined ? null : description(data.description) };
}
export function updateTaskInput(body: unknown) {
  const data = fields(body, ['title', 'description', 'status', 'version']);
  if (!Number.isInteger(data.version) || (data.version as number) < 1 || (data.version as number) > 2147483646) {
    throw new BadRequestException('version 必须为 1–2147483646 的整数');
  }
  if (!['title', 'description', 'status'].some(key => key in data)) throw new BadRequestException('至少修改标题、描述或状态中的一项');
  if ('status' in data && !['TODO', 'IN_PROGRESS', 'DONE'].includes(data.status as string)) throw new BadRequestException('任务状态不合法');
  return { version: data.version as number, ...('title' in data ? { title: title(data.title) } : {}),
    ...('description' in data ? { description: description(data.description) } : {}), ...('status' in data ? { status: data.status as TaskStatus } : {}) };
}
