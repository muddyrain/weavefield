import { useRef, useState, type FormEvent } from 'react';
import type { AuthSession as Session } from '@weavefield/shared';
import { useAuth } from '../auth/AuthContext';

export default function AuthPanel({ onOpenWorkspaces }: { onOpenWorkspaces: () => void }) {
  const { status, session, sessionNotice, refresh, cancelRefresh, acceptSession, clearSession } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  async function write(route: string, body: unknown) {
    const response = await fetch(`/api/auth/${route}`, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Weavefield-Request': '1' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.message === 'string' ? data.message : '认证请求失败，请重试');
    }
    return response;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const displayName = String(form.get('displayName') ?? '').trim();
    if (Array.from(password).length < 12 || Array.from(password).length > 128 || new TextEncoder().encode(password).length > 256) {
      setError('密码须为 12–128 个字符，UTF-8 编码不超过 256 字节'); return;
    }
    if (mode === 'register' && (!displayName || Array.from(displayName).length > 50)) { setError('昵称须为 1–50 个字符'); return; }
    cancelRefresh(); setPending(true); setError(''); setNotice('');
    try {
      const response = await write(mode, { email, password, ...(mode === 'register' ? { displayName } : {}) });
      const data: Session = await response.json();
      acceptSession(data); dialog.current?.close();
      setNotice(mode === 'register' ? '注册成功，已登录' : '登录成功');
    } catch (error) { setError(error instanceof Error ? error.message : '连接认证服务失败，请重试'); }
    finally { setPending(false); }
  }
  async function logout() {
    cancelRefresh(); setPending(true); setError(''); setNotice('');
    try {
      await write('logout', {});
      clearSession(); setNotice('已退出登录');
    } catch {
      setNotice('退出响应异常，请检查连接和当前登录状态');
      await refresh();
    }
    finally { setPending(false); }
  }
  function open() { setError(''); setMode('login'); dialog.current?.showModal(); }

  return <div className="auth-control">
    {status === 'authenticated' && session ? <>
      <button className="account-button" onClick={() => { void refresh(); onOpenWorkspaces(); }} title={`当前账号：${session.user.email}；打开我的工作空间`}>
        <span className="account-initial" aria-hidden="true">{Array.from(session.user.displayName)[0]}</span>
        <span className="account-name" data-testid="current-user">{session.user.displayName}</span>
      </button>
      <button className="auth-text-button" onClick={logout} disabled={pending}>{pending ? '退出中…' : '退出'}</button>
    </> : <button className="account-button" onClick={open} disabled={status === 'loading'}>
      {status === 'loading' ? '验证账号…' : status === 'unavailable' ? '账号连接失败' : '登录 / 注册'}
    </button>}
    {(notice || sessionNotice) && <p className="auth-notice" role="status">{sessionNotice || notice}</p>}
    <dialog ref={dialog} className="auth-dialog" onClose={() => { dialog.current?.querySelector('form')?.reset(); setError(''); }} aria-labelledby="auth-heading" onCancel={event => { if (pending) event.preventDefault(); }}>
      <div className="auth-dialog-head"><span>WEAVEFIELD · 织域</span><button type="button" aria-label="关闭认证窗口" disabled={pending} onClick={() => dialog.current?.close()}>×</button></div>
      <h2 id="auth-heading">{mode === 'login' ? '登录你的账号' : '创建织域账号'}</h2>
      <p className="auth-intro">保存真实账号与登录状态。Nova 空间仍为本地演示，账号暂不授予协作文档权限。</p>
      <form onSubmit={submit} aria-busy={pending} key={mode}>
        {mode === 'register' && <label>昵称<input name="displayName" autoComplete="nickname" required maxLength={50} disabled={pending}/></label>}
        <label>邮箱<input name="email" type="email" autoFocus autoComplete="email" required maxLength={254} disabled={pending}/></label>
        <label>密码<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required disabled={pending} aria-describedby="password-help"/></label>
        <small id="password-help">12–128 个字符，UTF-8 编码不超过 256 字节。</small>
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button className="auth-submit" disabled={pending}>{pending ? '正在验证…' : mode === 'login' ? '登录' : '注册并登录'}</button>
      </form>
      <button type="button" className="auth-switch" disabled={pending} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'login' ? '还没有账号？注册' : '已有账号？登录'}
      </button>
    </dialog>
  </div>;
}
