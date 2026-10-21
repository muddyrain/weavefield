import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class LoginLimiter {
  private readonly buckets = new Map<string, { count: number; until: number }>();
  check(ip: string, email: string, register: boolean) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) if (bucket.until <= now) this.buckets.delete(key);
    const account = createHash('sha256').update(email).digest('hex');
    for (const [key, limit] of [[`ip:${ip}:${register}`, register ? 10 : 20], [`account:${account}`, 10]] as const) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        if (this.buckets.size >= 10000) throw new HttpException('认证请求过于频繁，请稍后重试', 429);
        bucket = { count: 0, until: now + 15 * 60 * 1000 };
        this.buckets.set(key, bucket);
      }
      if (bucket.count >= limit) throw new HttpException('认证请求过于频繁，请稍后重试', 429);
      bucket.count++;
    }
  }
}
