import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorkspaceMember, WorkspaceSummary } from '@weavefield/shared';
import { useAuth } from '../auth/AuthContext';
import DocumentsPanel from './DocumentsPanel';
class WorkspaceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const selectionKey = (userId: string) => `weavefield.workspace.${userId}`;
function remember(userId: string, id: string) {
  try { if (id) localStorage.setItem(selectionKey(userId), id); else localStorage.removeItem(selectionKey(userId)); } catch { /* 隐私模式下仍可使用当前页面。 */ }
}

export default function WorkspacePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, session } = useAuth();
  const userId = status === 'authenticated' ? session?.user.id : undefined;
  const previousUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      remember(previousUser.current, ''); onClose();
    }
    previousUser.current = userId;
  }, [userId, onClose]);
  return userId ? <WorkspaceManager key={userId} userId={userId} open={open} onClose={onClose}/> : null;
}

function WorkspaceManager({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const { clearSession } = useAuth();
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [detail, setDetail] = useState<WorkspaceSummary | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const selected = useRef('');
  useEffect(() => {
    alive.current = true;
    try { selected.current = localStorage.getItem(selectionKey(userId)) ?? ''; } catch { /* 选择仍可保存在内存中。 */ }
    return () => { alive.current = false; revision.current++; };
  }, [userId]);

  const api = useCallback(async <T,>(route: string, method = 'GET', body?: unknown, stamp = revision.current): Promise<T> => {
    const response = await fetch(`/api${route}`, { method, credentials: 'include', cache: 'no-store',
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json', 'X-Weavefield-Request': '1' }, body: JSON.stringify(body ?? {}) }) });
    if (response.status === 401 && alive.current && stamp === revision.current) clearSession();
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new WorkspaceError(typeof result.message === 'string' ? result.message : '工作空间请求失败，请重试', response.status);
    }
    return response.status === 204 ? undefined as T : response.json();
  }, [clearSession]);

  const reload = useCallback(async (preferred = selected.current) => {
    const stamp = ++revision.current;
    setLoading(true); setDetail(null); setMembers([]);
    try {
      const list = await api<WorkspaceSummary[]>('/workspaces', 'GET', undefined, stamp);
      if (!alive.current || stamp !== revision.current) return;
      setItems(list);
      if (!preferred || !list.some(item => item.id === preferred)) {
        selected.current = ''; remember(userId, '');
        if (preferred) setNotice('所选空间已不可访问，请重新选择');
        return;
      }
      const [workspace, currentMembers] = await Promise.all([
        api<WorkspaceSummary>(`/workspaces/${preferred}`, 'GET', undefined, stamp),
        api<WorkspaceMember[]>(`/workspaces/${preferred}/members`, 'GET', undefined, stamp),
      ]);
      if (!alive.current || stamp !== revision.current) return;
      selected.current = preferred; remember(userId, preferred);
      setDetail(workspace); setMembers(currentMembers);
    } catch (error) {
      if (!alive.current || stamp !== revision.current) return;
      setItems([]);
      if (error instanceof WorkspaceError && error.status === 404) {
        selected.current = ''; remember(userId, '');
      }
      setError(error instanceof Error ? error.message : '无法连接工作空间服务');
    } finally { if (alive.current && stamp === revision.current) setLoading(false); }
  }, [api, userId]);
  useEffect(() => {
    if (open) { dialog.current?.showModal(); setError(''); void reload(); }
    else dialog.current?.close();
  }, [open, reload]);
  useEffect(() => {
    if (!open) return;
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(interval); };
  }, [open, reload]);
  async function perform(action: () => Promise<string | void>) {
    revision.current++; setPending(true); setError(''); setNotice('');
    try {
      const id = await action();
      if (!alive.current) return;
      setNotice('工作空间已更新'); await reload(id ?? selected.current);
    } catch (error) {
      if (!alive.current) return;
      setError(error instanceof Error ? error.message : '操作失败，请重试');
      await reload();
    } finally { if (alive.current) setPending(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    void perform(async () => {
      const workspace = await api<WorkspaceSummary>('/workspaces', 'POST', { name: data.get('name'), slug: data.get('slug') });
      form.reset(); return workspace.id;
    });
  }
  const owner = detail?.role === 'OWNER';
  const disabled = loading || pending;
  return <dialog ref={dialog} className="workspace-dialog" aria-labelledby="workspace-heading" onClose={onClose}>
    <div className="workspace-dialog-head"><div><small>真实账号 · 工作空间</small><h2 id="workspace-heading">我的工作空间</h2></div><button type="button" aria-label="关闭工作空间" onClick={() => dialog.current?.close()}>×</button></div>
    <p className="workspace-boundary">这里管理真实空间与成员，不包含 M0 演示文档。关闭后仍是 Nova 本地演示；工作空间成员身份暂不授予 Hocuspocus 协作权限。</p>
    <button type="button" className="workspace-secondary" disabled={pending} onClick={() => { setError(''); void reload(); }}>刷新工作空间</button>
    {loading && <p role="status">正在加载工作空间…</p>}
    {pending && <p role="status">正在保存…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!loading && !error && items.length === 0 && <p>还没有加入任何工作空间。可以先创建一个空间。</p>}
    <div className="workspace-grid">
      <section aria-label="工作空间选择与创建">
        <label>当前工作空间<select aria-label="当前工作空间" value={detail?.id ?? ''} disabled={disabled} onChange={event => { selected.current = event.target.value; setError(''); setNotice(''); void reload(event.target.value); }}>
          <option value="">请选择工作空间</option>{items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <form onSubmit={create}>
          <h3>创建工作空间</h3>
          <label>新空间名称<input name="name" required maxLength={80} disabled={disabled}/></label>
          <label>空间标识<input name="slug" required minLength={3} maxLength={64} pattern="[a-z0-9\-]{3,64}" aria-describedby="slug-help" disabled={disabled}/></label>
          <small id="slug-help">3–64 位小写字母、数字或连字符；创建后暂不修改。</small>
          <button className="workspace-primary" disabled={disabled}>创建工作空间</button>
        </form>
      </section>
      <section aria-label="当前空间详情">
        {detail ? <>
          <h3>{detail.name}</h3><p>当前角色：<strong data-testid="workspace-role">{detail.role}</strong></p>
          {owner ? <form key={detail.name} onSubmit={event => {
            event.preventDefault(); const data = new FormData(event.currentTarget);
            void perform(async () => { await api(`/workspaces/${detail.id}`, 'PATCH', { name: data.get('name') }); });
          }}><label>空间名称<input name="name" required maxLength={80} defaultValue={detail.name} disabled={disabled}/></label><button className="workspace-secondary" disabled={disabled}>保存空间名称</button></form>
            : <p>当前角色仅可查看空间与成员，不能管理成员或修改空间。</p>}
          {open && <DocumentsPanel key={`${userId}:${detail.id}:${detail.role}`} workspace={detail}/>}
          <h3>成员</h3>
          <ul className="workspace-members">{members.map(member => <li key={member.user.id} data-testid="workspace-member">
            <div><strong>{member.user.displayName}{member.user.id === userId ? '（本人）' : ''}</strong><small>{member.user.email}</small><span>{member.role}</span></div>
            {owner && <div className="workspace-member-actions"><form key={member.role} onSubmit={event => {
              event.preventDefault(); const data = new FormData(event.currentTarget);
              void perform(async () => { await api(`/workspaces/${detail.id}/members/${member.user.id}`, 'PATCH', { role: data.get('role') }); });
            }}><select name="role" aria-label={`${member.user.displayName}的角色`} defaultValue={member.role} disabled={disabled}>{['OWNER', 'EDITOR', 'VIEWER'].map(role => <option key={role}>{role}</option>)}</select><button className="workspace-secondary" disabled={disabled}>更新{member.user.displayName}角色</button></form>
              <button type="button" className="workspace-remove" disabled={disabled} onClick={() => void perform(async () => { await api(`/workspaces/${detail.id}/members/${member.user.id}`, 'DELETE'); })}>移除{member.user.displayName}</button></div>}
          </li>)}</ul>
          {owner && <form aria-label="添加已有账号" onSubmit={event => {
            event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
            void perform(async () => { await api(`/workspaces/${detail.id}/members`, 'POST', { email: data.get('email'), role: data.get('role') }); form.reset(); });
          }}><h3>添加已有账号</h3><label>成员邮箱<input name="email" type="email" required maxLength={254} disabled={disabled}/></label>
            <label>新成员角色<select name="role" aria-label="新成员角色" defaultValue="VIEWER" disabled={disabled}>{['OWNER', 'EDITOR', 'VIEWER'].map(role => <option key={role}>{role}</option>)}</select></label>
            <p>仅添加已注册用户，不发送邀请邮件。变更角色或移除成员时，必须至少保留一位 OWNER。</p><button className="workspace-primary" disabled={disabled}>添加成员</button></form>}
        </> : !loading && <p>选择一个有权访问的空间查看成员。</p>}
      </section>
    </div>
  </dialog>;
}
