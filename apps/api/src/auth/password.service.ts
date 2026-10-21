import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PasswordService {
  private active = 0;
  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.active >= 2) throw new ServiceUnavailableException('密码计算暂时繁忙，请稍后重试');
    this.active++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, derived) => error ? reject(error) : resolve(derived));
      });
    } finally { this.active--; }
  }
  async hash(password: string) {
    const salt = randomBytes(16);
    const key = await this.derive(password, salt);
    return `scrypt$32768$8$3$${salt.toString('hex')}$${key.toString('hex')}`;
  }
  async verify(password: string, encoded: string | null) {
    const parts = encoded?.match(/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
    // 未注册或旧账号也执行同等成本的派生，统一返回登录失败。
    const salt = parts ? Buffer.from(parts[1]!, 'hex') : Buffer.alloc(16);
    const expected = parts ? Buffer.from(parts[2]!, 'hex') : Buffer.alloc(64);
    const actual = await this.derive(password, salt);
    return timingSafeEqual(actual, expected) && Boolean(parts);
  }
}
