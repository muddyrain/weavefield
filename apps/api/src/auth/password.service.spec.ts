import { expect, it } from 'vitest';
import { PasswordService } from './password.service';
import { LoginLimiter } from './login-limiter.service';

it('rejects transient password saturation with 503 and accepts work after capacity returns', async () => {
  const service = new PasswordService();
  const password = 'Review secure password 42!';
  const running = [service.hash(password), service.hash(password)];
  try {
    await expect(service.hash(password)).rejects.toMatchObject({ status: 503 });
  } finally { await Promise.all(running); }
  const hash = await service.hash(password);
  await expect(service.verify(password, hash)).resolves.toBe(true);
});

it('keeps actual login attempt limits at 429', () => {
  const limiter = new LoginLimiter();
  for (let index = 0; index < 10; index++) limiter.check('127.0.0.1', 'review@example.invalid', false);
  expect(() => limiter.check('127.0.0.1', 'review@example.invalid', false)).toThrow(expect.objectContaining({ status: 429 }));
});
