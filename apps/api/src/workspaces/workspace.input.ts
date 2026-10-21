import { BadRequestException } from '@nestjs/common';

export function fields(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new BadRequestException('请求字段不合法');
  return value as Record<string, unknown>;
}
export function workspaceName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException('空间名称须为 1–80 个字符，不能含控制字符');
  }
  return value.trim();
}
export function workspaceSlug(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9-]{3,64}$/.test(value)) throw new BadRequestException('空间标识须为 3–64 位小写字母、数字或连字符');
  return value;
}
export function resourceId(value: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw new BadRequestException('资源标识不合法');
  return value;
}

export function memberRole(value: unknown) {
  if (value !== 'OWNER' && value !== 'EDITOR' && value !== 'VIEWER') throw new BadRequestException('角色必须为 OWNER、EDITOR 或 VIEWER');
  return value;
}
