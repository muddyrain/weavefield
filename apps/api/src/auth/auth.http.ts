import { Catch, ForbiddenException, HttpException, type ExceptionFilter, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { authConfig } from './auth.config';

@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const message = error instanceof HttpException ? error.message : '认证服务暂时不可用，请稍后重试';
    if (status === 429) response.setHeader('Retry-After', '900');
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ statusCode: status, message });
  }
}

export function sessionToken(request: Request) {
  const name = authConfig().cookieName;
  const tokens = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  const token = tokens.length === 1 ? tokens[0]!.slice(name.length + 1) : undefined;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function checkWrite(request: Request) {
  if (request.headers.origin !== authConfig().origin || request.headers['sec-fetch-site'] === 'cross-site'
    || request.headers['x-weavefield-request'] !== '1' || !request.is('application/json')) {
    throw new ForbiddenException('请求来源或格式不受信任');
  }
}
