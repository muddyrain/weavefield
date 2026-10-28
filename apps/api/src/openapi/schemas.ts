import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';

// 仅用于接口声明，不参与运行时校验；真实校验仍由 Controller 的手写函数负责。
const object = (properties: Record<string, SchemaObject | ReferenceObject>, required = Object.keys(properties)): SchemaObject =>
  ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const idSchema: SchemaObject = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,80}$', minLength: 1, maxLength: 80 };
const date: SchemaObject = { type: 'string', format: 'date-time' };
const role: SchemaObject = { type: 'string', enum: ['OWNER', 'EDITOR', 'VIEWER'] };
const email: SchemaObject = {
  type: 'string', maxLength: 254, pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$',
  description: '原始输入最多 254 个 UTF-16 代码单元；trim 后转小写。使用服务端邮箱正则，不要求 RFC email 格式。',
};
// 外部空白不计入 trim 后的长度；空间名称和标题在 trim 前就拒绝控制字符。
function trimmedText(max: number, controlsBeforeTrim: boolean): SchemaObject {
  const padding = controlsBeforeTrim ? '[^\\S\\u0000-\\u001f\\u007f]*' : '\\s*';
  const edge = '[^\\s\\u0000-\\u001f\\u007f]';
  return { type: 'string', pattern: `^${padding}${edge}(?:[^\\u0000-\\u001f\\u007f]{0,${max - 2}}${edge})?${padding}$`,
    description: `trim 后为 1–${max} 个 Unicode 字符；${controlsBeforeTrim ? '原始输入' : 'trim 后'}不能含 U+0000–001F、U+007F 控制字符。` };
}
const password: SchemaObject = { type: 'string', format: 'password', writeOnly: true, minLength: 8, maxLength: 128,
  description: '8–128 个 Unicode 字符，另受 UTF-8 最多 256 字节限制；不 trim、不回显。' };

export const schemas = {
  RegisterInput: object({ email, password, displayName: trimmedText(50, false) }),
  LoginInput: object({ email, password }),
  CreateWorkspaceInput: object({ name: trimmedText(80, true),
    slug: { type: 'string', minLength: 3, maxLength: 64, pattern: '^[a-z0-9-]{3,64}$' } }),
  RenameWorkspaceInput: object({ name: trimmedText(80, true) }),
  AddMemberInput: object({ email, role: { ...role, default: 'VIEWER', description: '仅省略时默认 VIEWER；null 非法。' } }, ['email']),
  ChangeRoleInput: object({ role }),
  DocumentTitleInput: object({ title: trimmedText(200, true) }),
  EmptyInput: object({}),
  User: object({ id: idSchema, email: { type: 'string' }, displayName: { type: 'string' } }),
  AuthSession: object({ user: ref('User'), sessionExpiresAt: date }),
  Workspace: object({ id: idSchema, name: { type: 'string' }, slug: { type: 'string' }, createdAt: date, role }),
  Member: object({ user: ref('User'), role, createdAt: date }),
  Document: object({ id: idSchema, workspaceId: idSchema, title: { type: 'string' }, createdAt: date,
    updatedAt: date, archivedAt: { ...date, nullable: true } }),
  ApiError: object({ statusCode: { type: 'integer' }, message: { type: 'string' } }),
  Health: object({ ok: { type: 'boolean', enum: [true] }, service: { type: 'string', enum: ['weavefield-api'] },
    version: { type: 'string', enum: ['0.1.0'] } }),
} satisfies Record<string, SchemaObject>;

export type SchemaName = keyof typeof schemas;
