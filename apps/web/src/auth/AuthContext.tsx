import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthSession } from '@weavefield/shared';
type Status = 'loading' | 'anonymous' | 'authenticated' | 'unavailable';
type AuthState = { status: Status; session: AuthSession | null; sessionNotice: string; refresh: () => Promise<void>; cancelRefresh: () => void; acceptSession: (session: AuthSession) => void; clearSession: () => void };
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionNotice, setSessionNotice] = useState('');
  const revision = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
      if (!mounted.current || current !== revision.current) return;
      if (response.status === 401) {
        setSession(null); setStatus('anonymous');
        return;
      }
      if (!response.ok) throw new Error('无法验证登录状态');
      const data: AuthSession = await response.json();
      if (!mounted.current || current !== revision.current) return;
      setSession(data); setStatus('authenticated');
    } catch {
      if (!mounted.current || current !== revision.current) return;
      setSession(null); setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    return () => {
      mounted.current = false; revision.current++;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.sessionExpiresAt) - Date.now();
    const timeout = window.setTimeout(() => {
      revision.current++; setSession(null); setStatus('anonymous'); setSessionNotice('会话已到期，请重新登录');
    }, Math.max(remaining, 0));
    return () => clearTimeout(timeout);
  }, [session]);

  const cancelRefresh = useCallback(() => { revision.current++; }, []);
  const acceptSession = useCallback((data: AuthSession) => {
    revision.current++; setSession(data); setStatus('authenticated'); setSessionNotice('');
  }, []);
  const clearSession = useCallback(() => {
    revision.current++; setSession(null); setStatus('anonymous'); setSessionNotice('');
  }, []);
  return <Context.Provider value={{ status, session, sessionNotice, refresh, cancelRefresh, acceptSession, clearSession }}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('AuthProvider is required');
  return value;
}
