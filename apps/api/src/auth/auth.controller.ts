import { Body, Catch, Controller, ExceptionFilter, ForbiddenException, Get, HttpCode, HttpException, Inject, Post, Req, Res, UseFilters, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { authConfig } from './auth.config';
import { authInput } from './auth.input';
import { LoginLimiter } from './login-limiter.service';

@Catch()
class AuthErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const message = error instanceof HttpException ? error.message : '认证服务暂时不可用，请稍后重试';
    if (status === 429) response.setHeader('Retry-After', '900');
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ statusCode: status, message });
  }
}

@Controller('auth')
@UseFilters(AuthErrors)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(LoginLimiter) private readonly limiter: LoginLimiter) {}
  private token(request: Request) {
    const name = authConfig().cookieName;
    const tokens = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
    const token = tokens.length === 1 ? tokens[0]!.slice(name.length + 1) : undefined;
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  }
  private checkWrite(request: Request) {
    if (request.headers.origin !== authConfig().origin || request.headers['sec-fetch-site'] === 'cross-site'
      || request.headers['x-weavefield-request'] !== '1' || !request.is('application/json')) {
      throw new ForbiddenException('请求来源或格式不受信任');
    }
  }
  private respond(response: Response, result: Awaited<ReturnType<AuthService['login']>>) {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(authConfig().cookieName, result.token, { ...authConfig().cookie, expires: result.expiresAt });
    return { user: result.user, sessionExpiresAt: result.expiresAt.toISOString() };
  }
  @Post('register')
  async register(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    this.checkWrite(request);
    const input = authInput(body, true);
    this.limiter.check(request.ip ?? 'unknown', input.email, true);
    return this.respond(response, await this.auth.register(input, this.token(request)));
  }
  @Post('login')
  @HttpCode(200)
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    this.checkWrite(request);
    const input = authInput(body, false);
    this.limiter.check(request.ip ?? 'unknown', input.email, false);
    return this.respond(response, await this.auth.login(input, this.token(request)));
  }
  @Get('me')
  async me(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try { return await this.auth.me(this.token(request)); }
    catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401) response.clearCookie(authConfig().cookieName, authConfig().cookie);
      throw error;
    }
  }
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.checkWrite(request);
    await this.auth.logout(this.token(request));
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(authConfig().cookieName, authConfig().cookie);
  }
}
