import { ApiContract } from '../openapi/api-contract';
import { Body, Controller, Get, HttpCode, HttpException, Inject, Post, Req, Res, UseFilters } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { authConfig } from './auth.config';
import { authInput } from './auth.input';
import { LoginLimiter } from './login-limiter.service';
import { ApiErrors, checkWrite, sessionToken } from './auth.http';

@Controller('auth')
@UseFilters(ApiErrors)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(LoginLimiter) private readonly limiter: LoginLimiter) {}
  private respond(response: Response, result: Awaited<ReturnType<AuthService['login']>>) {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(authConfig().cookieName, result.token, { ...authConfig().cookie, expires: result.expiresAt });
    return { user: result.user, sessionExpiresAt: result.expiresAt.toISOString() };
  }
  @Post('register')
  @ApiContract({ tag: 'Auth', summary: '注册并建立 Session', status: 201, body: 'RegisterInput', response: 'AuthSession', errors: [400, 403, 409, 413, 429, 503] })
  async register(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    const input = authInput(body, true);
    this.limiter.check(request.ip ?? 'unknown', input.email, true);
    return this.respond(response, await this.auth.register(input, sessionToken(request)));
  }
  @Post('login')
  @HttpCode(200)
  @ApiContract({ tag: 'Auth', summary: '登录并轮换当前 Session', status: 200, body: 'LoginInput', response: 'AuthSession', errors: [400, 401, 403, 413, 429, 503] })
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    const input = authInput(body, false);
    this.limiter.check(request.ip ?? 'unknown', input.email, false);
    return this.respond(response, await this.auth.login(input, sessionToken(request)));
  }
  @Get('me')
  @ApiContract({ tag: 'Auth', summary: '读取当前用户及 Session 过期时间', status: 200, session: true, response: 'AuthSession', errors: [401, 503] })
  async me(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try { return await this.auth.me(sessionToken(request)); }
    catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401) response.clearCookie(authConfig().cookieName, authConfig().cookie);
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(204)
  @ApiContract({ tag: 'Auth', summary: '退出并清除 Cookie', description: '幂等退出；不要求有效 Session；允许省略请求体，若提供 JSON 则忽略其内容。', status: 204, write: true, errors: [400, 403, 413, 503] })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    await this.auth.logout(sessionToken(request));
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(authConfig().cookieName, authConfig().cookie);
  }
}
