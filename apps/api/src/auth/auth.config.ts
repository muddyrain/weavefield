export function authConfig() {
  const production = process.env.NODE_ENV === 'production';
  const origin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password
    || (production ? parsed.protocol !== 'https:' : !['http:', 'https:'].includes(parsed.protocol))) {
    throw new Error('WEB_ORIGIN must be an exact origin; production requires HTTPS');
  }
  if (!production && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Development authentication requires a loopback WEB_ORIGIN');
  }
  return {
    origin, production,
    cookieName: production ? '__Host-weavefield_session' : 'weavefield_session',
    sessionMs: 7 * 24 * 60 * 60 * 1000,
    cookie: { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' },
  };
}
