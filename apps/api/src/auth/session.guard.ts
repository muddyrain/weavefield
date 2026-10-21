import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { checkWrite, sessionToken } from './auth.http';
export type AuthenticatedRequest = Request & { identity: Awaited<ReturnType<AuthService['me']>> };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.identity = await this.auth.me(sessionToken(request));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) checkWrite(request);
    return true;
  }
}
