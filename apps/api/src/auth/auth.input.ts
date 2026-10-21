import { BadRequestException } from '@nestjs/common';

export function authInput(value: unknown, register: boolean) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('请提交有效的认证表单');
  const input = value as Record<string, unknown>;
  const allowed = register ? ['email', 'password', 'displayName'] : ['email', 'password'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new BadRequestException('表单包含不支持的字段');
  const email = normalizeEmail(input.email);
  if (typeof input.password !== 'string' || Array.from(input.password).length < 12
    || Array.from(input.password).length > 128 || Buffer.byteLength(input.password, 'utf8') > 256) {
    throw new BadRequestException('密码须为 12–128 个字符，UTF-8 编码不超过 256 字节');
  }
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (register && (!displayName || Array.from(displayName).length > 50 || /[\u0000-\u001f\u007f]/.test(displayName))) {
    throw new BadRequestException('昵称须为 1–50 个字符，不能含控制字符');
  }
  return { email, password: input.password, displayName };
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 254) throw new BadRequestException('请输入有效邮箱');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('请输入有效邮箱');
  return email;
}
