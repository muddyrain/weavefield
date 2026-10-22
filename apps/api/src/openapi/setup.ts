import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { authConfig } from '../auth/auth.config';
import { schemas } from './schemas';

export function setupOpenApi(app: INestApplication) {
  if (process.env.ENABLE_OPENAPI_DOCS !== '1'
    || ![undefined, 'development', 'test'].includes(process.env.NODE_ENV)) return;

  const config = new DocumentBuilder().setTitle('Weavefield M1 REST API').setVersion('0.1.0')
    .setDescription([
      '仅供 localhost 开发使用。现有 18 个 REST 操作；不提供正文、协作票据或 Yjs 持久化接口。',
      '身份认证使用 HttpOnly Cookie Session（七天绝对过期），不是 JWT Bearer。注册/登录设置 Cookie，退出撤销当前 Session。',
      '所有写请求要求精确 WEB_ORIGIN、Content-Type: application/json、X-Weavefield-Request: 1；拒绝 Sec-Fetch-Site: cross-site；JSON 最多 4 KiB。',
      '解析 JSON 先于 Guard（无效/过大为 400/413）；受保护路由随后依次检查 Session(401)、写请求来源(403)、Controller 输入(400)、服务端成员/角色/资源。',
      'Auth 写路由先检查来源，再校验输入及限流；logout 幂等，不要求有效 Session，也不读取请求体字段。',
      '非成员与不存在空间统一 404。OWNER 管理空间及成员；OWNER/EDITOR 可写文档，VIEWER 只读。最后 OWNER 不可移除或降级(409)。',
      '文档重命名/归档先验证空间成员，再查未归档文档(404)，随后验证可写角色(403)；不存在/错空间/已归档文档优先 404。',
      'Swagger UI 只提供浏览，禁用 Try it out；使用 README 的 Cookie jar 示例调用，所有真实请求仍接受原有认证、CSRF 与权限检查。',
    ].join('\n\n'))
    .addCookieAuth(authConfig().cookieName, { type: 'apiKey', in: 'cookie', description: '浏览器自动携带 HttpOnly Cookie；不要粘贴真实 Session 值。' }, 'cookieSession')
    .build();
  // createDocument 只扫描 Controller 元数据；不调用 Service 或执行数据库查询。
  const document = SwaggerModule.createDocument(app, config, { autoTagControllers: false });
  document.components = { ...document.components, schemas };
  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: '/openapi.json', raw: ['json'],
    swaggerOptions: { supportedSubmitMethods: [], validatorUrl: null, persistAuthorization: false },
  });
}
