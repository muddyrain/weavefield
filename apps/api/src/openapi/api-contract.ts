import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { idSchema, ref, type SchemaName } from './schemas';

const errors: Record<number, string> = {
  400: '无效 JSON、字段、路径参数或输入；未知字段被拒绝',
  401: '未登录，或 Session 无效、过期、已退出或撤销',
  403: '写请求来源/格式不可信，或已认证成员角色不足',
  404: '工作空间/成员/文档不存在或不可访问；非成员统一 404；文档必须属于当前空间且未归档',
  409: '唯一约束冲突，或最后一个 OWNER 不可移除/降级',
  413: 'JSON 请求体超过 4 KiB',
  429: '认证尝试过于频繁（Retry-After: 900）',
  503: '服务暂时不可用，或密码计算并发容量不足；不返回内部异常',
};

// 组合的都是 Swagger 元数据，不安装 Pipe、Guard、Interceptor 或修改请求/返回值。
export function ApiContract(options: {
  tag: 'Auth' | 'Workspace' | 'Document' | 'Health'; summary: string; description?: string;
  status: 200 | 201 | 204; response?: SchemaName; list?: boolean; body?: SchemaName; write?: boolean;
  session?: boolean; params?: ('workspaceId' | 'userId' | 'documentId')[]; errors?: number[];
}) {
  return applyDecorators(
    ApiTags(options.tag),
    ApiOperation({ summary: options.summary, description: options.description }),
    ...(options.session ? [ApiSecurity('cookieSession')] : []),
    ...(options.params ?? []).map(name => ApiParam({ name, required: true, schema: idSchema })),
    ...(options.body ? [ApiBody({ required: true, schema: ref(options.body), description: 'application/json；最多 4 KiB；禁止未知字段。' })] : []),
    ...(options.write && !options.body ? [ApiBody({ required: false, schema: { oneOf: [
      { type: 'object', additionalProperties: true }, { type: 'array', items: {} },
    ] }, description: '可省略；若提供，必须为有效 JSON 对象或数组，内容会被忽略。' })] : []),
    ...(options.body || options.write ? [
      ApiHeader({ name: 'Origin', required: true, description: '必须与 WEB_ORIGIN 完全相同；浏览器自动设置。', schema: { type: 'string' } }),
      ApiHeader({ name: 'X-Weavefield-Request', required: true, schema: { type: 'string', enum: ['1'] } }),
    ] : []),
    ApiResponse({ status: options.status, description: options.status === 204 ? '操作成功，无响应体' : '操作成功',
      ...(options.response ? { schema: options.list ? { type: 'array', items: ref(options.response) } : ref(options.response) } : {}) }),
    ...(options.errors ?? []).map(status => ApiResponse({ status, description: errors[status], schema: ref('ApiError') })),
  );
}
