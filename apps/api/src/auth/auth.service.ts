import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.module';
import { PasswordService } from './password.service';
import { authConfig } from './auth.config';
import type { authInput } from './auth.input';

const userSelect = { id: true, email: true, displayName: true } as const;
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService) {}
  private get db() { return this.database.client; }
  private session() {
    const token = randomBytes(32).toString('base64url');
    return { token, expiresAt: new Date(Date.now() + authConfig().sessionMs) };
  }
  async register(input: ReturnType<typeof authInput>, previous?: string) {
    const passwordHash = await this.passwords.hash(input.password);
    const session = this.session();
    try {
      const user = await this.db.$transaction(async tx => {
        const user = await tx.user.create({ data: {
          email: input.email, emailCanonical: input.email, displayName: input.displayName, passwordHash,
        }, select: userSelect });
        if (previous) await tx.session.deleteMany({ where: { tokenHash: tokenHash(previous) } });
        await tx.session.create({ data: { tokenHash: tokenHash(session.token), userId: user.id, expiresAt: session.expiresAt } });
        return user;
      });
      return { user, ...session };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('该邮箱已注册');
      }
      throw error;
    }
  }
  async login(input: ReturnType<typeof authInput>, previous?: string) {
    const user = await this.db.user.findUnique({ where: { emailCanonical: input.email } });
    const valid = await this.passwords.verify(input.password, user?.passwordHash ?? null);
    if (!valid || !user) throw new UnauthorizedException('邮箱或密码不正确');
    const session = this.session();
    await this.db.$transaction(async tx => {
      if (previous) await tx.session.deleteMany({ where: { tokenHash: tokenHash(previous) } });
      await tx.session.create({ data: { tokenHash: tokenHash(session.token), userId: user.id, expiresAt: session.expiresAt } });
    });
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, ...session };
  }
  async me(token?: string) {
    if (!token) throw new UnauthorizedException('请先登录');
    const session = await this.db.session.findUnique({ where: { tokenHash: tokenHash(token) },
      select: { expiresAt: true, revokedAt: true, user: { select: userSelect } } });
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('会话已失效，请重新登录');
    return { user: session.user, sessionExpiresAt: session.expiresAt.toISOString() };
  }
  async logout(token?: string) {
    if (token) await this.db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
}
