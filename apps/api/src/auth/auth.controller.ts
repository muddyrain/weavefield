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
  async register(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    const input = authInput(body, true);
    this.limiter.check(request.ip ?? 'unknown', input.email, true);
    return this.respond(response, await this.auth.register(input, sessionToken(request)));
  }
  @Post('login')
  @HttpCode(200)
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    const input = authInput(body, false);
    this.limiter.check(request.ip ?? 'unknown', input.email, false);
    return this.respond(response, await this.auth.login(input, sessionToken(request)));
  }
  @Get('me')
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
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    checkWrite(request);
    await this.auth.logout(sessionToken(request));
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(authConfig().cookieName, authConfig().cookie);
  }
}
