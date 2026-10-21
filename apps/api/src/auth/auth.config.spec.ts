import { afterEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from './auth.config';

afterEach(() => vi.unstubAllEnvs());
describe('production session configuration', () => {
  it('requires HTTPS and sets host-only HttpOnly secure cookies', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('WEB_ORIGIN', 'http://localhost:5173');
    expect(() => authConfig()).toThrow('HTTPS');
    vi.stubEnv('WEB_ORIGIN', 'https://weavefield.example');
    const config = authConfig();
    expect(config.cookieName).toBe('__Host-weavefield_session');
    expect(config.cookie).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(config.sessionMs).toBe(604800000);
  });
  it('rejects wildcard, paths and non-local development origins', () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const origin of ['*', 'http://localhost:5173/path', 'http://evil.invalid']) {
      vi.stubEnv('WEB_ORIGIN', origin); expect(() => authConfig()).toThrow();
    }
  });
});
