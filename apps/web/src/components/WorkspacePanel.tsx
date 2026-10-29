import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorkspaceMember, WorkspaceSummary } from '@weavefield/shared';
import { useAuth } from '../auth/AuthContext';
import DocumentsPanel from './DocumentsPanel';
import { FileText, Plus, RefreshCw, Settings, Users, ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { WorkspaceDialog, WorkspaceEmpty, WorkspaceErrorMessage, WorkspaceLoading } from './WorkspacePrimitives';
class WorkspaceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const selectionKey = (userId: string) => `weavefield.workspace.${userId}`;
function remember(userId: string, id: string) {
  try { if (id) localStorage.setItem(selectionKey(userId), id); else localStorage.removeItem(selectionKey(userId)); } catch { /* 隐私模式下仍可使用当前页面。 */ }
}

export default function WorkspacePanel({ open, onClose, onLogin }: { open: boolean; onClose: () => void; onLogin: () => void }) {
  const { status, session } = useAuth();
  const userId = status === 'authenticated' ? session?.user.id : undefined;
  const previousUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== userId) {
      remember(previousUser.current, ''); onClose();
    }
    previousUser.current = userId;
  }, [userId, onClose]);
  if (!open) return null;
  return userId ? <WorkspaceManager key={userId} userId={userId} open={open} onClose={onClose}/> : <section className="workspace-page" aria-label="工作空间登录">
    <WorkspaceEmpty title="你的工作，从这里开始" description={status === 'loading' ? '正在验证账号…' : '登录真实账号，管理你有权访问的工作空间和文档元数据。Nova 本地演示始终独立。'}>
      <Button disabled={status==='loading'} onClick={onLogin}>登录 / 注册真实账号</Button><Button variant="ghost" onClick={onClose}>返回 Nova 本地演示</Button>
    </WorkspaceEmpty></section>;
}

function WorkspaceManager({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const { clearSession } = useAuth();
  const [items, setItems] = useState<WorkspaceSummary[]>([]);
  const [detail, setDetail] = useState<WorkspaceSummary | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [documentsPending, setDocumentsPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [writeCommitted, setWriteCommitted] = useState(false);
  const [view, setView] = useState('documents');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const refreshTrigger = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();
  const revision = useRef(0);
  const alive = useRef(true);
  const selected = useRef('');
  const writing = useRef(false);
  const documentsWriting = useRef(false);
  // ref 同步拒绝冲突/重复提交，状态只负责展示禁用；保护持续到后续读取结束。
  const onDocumentWritePendingChange = useCallback((value: boolean) => {
    if (value && (writing.current || documentsWriting.current)) return false;
    documentsWriting.current = value; setDocumentsPending(value);
    return true;
  }, []);
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
      const target = preferred || list[0]?.id;
      if (!target || !list.some(item => item.id === target)) {
        selected.current = ''; remember(userId, '');
        if (preferred) setNotice('所选空间已不可访问，请重新选择');
        return true;
      }
      const [workspace, currentMembers] = await Promise.all([
        api<WorkspaceSummary>(`/workspaces/${target}`, 'GET', undefined, stamp),
        api<WorkspaceMember[]>(`/workspaces/${target}/members`, 'GET', undefined, stamp),
      ]);
      if (!alive.current || stamp !== revision.current) return;
      selected.current = target; remember(userId, target);
      setDetail(workspace); setMembers(currentMembers);
      return true;
    } catch (error) {
      if (!alive.current || stamp !== revision.current) return;
      setItems([]);
      if (error instanceof WorkspaceError && error.status === 404) {
        selected.current = ''; remember(userId, '');
      }
      setError(error instanceof Error ? error.message : '无法连接工作空间服务');
      return false;
    } finally { if (alive.current && stamp === revision.current) setLoading(false); }
  }, [api, userId]);
  useEffect(() => {
    if (open) { setError(''); void reload(); }
  }, [open, reload]);
  useEffect(() => {
    if (!open) return;
    // 写响应及其后续读取完成前，不让自动刷新推进 revision 或卸载文档控制器。
    // 会话检查由 AuthContext 独立执行；后续焦点/可见性事件和每分钟刷新仍然生效。
    const refresh = () => { if (document.visibilityState === 'visible' && !writing.current && !documentsWriting.current) void reload(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(interval); };
  }, [open, reload]);
  async function perform(action: () => Promise<string | void>) {
    if (writing.current || documentsWriting.current) return false;
    writing.current = true;
    const stamp = ++revision.current; setWriteCommitted(false); setPending(true); setError(''); setNotice('');
    try {
      const id = await action();
      if (!alive.current || stamp!==revision.current) return false;
      setWriteCommitted(true); setNotice('工作空间已更新');
      const loaded = await reload(id ?? selected.current);
      if (alive.current && loaded) setWriteCommitted(false);
      return Boolean(loaded);
    } catch (error) {
      if (!alive.current) return;
      setError(error instanceof Error ? error.message : '操作失败，请重试');
      await reload();
      return false;
    } finally { writing.current = false; if (alive.current) setPending(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    void perform(async () => {
      const workspace = await api<WorkspaceSummary>('/workspaces', 'POST', { name: data.get('name'), slug: data.get('slug') });
      form.reset(); return workspace.id;
    }).then(ok=>{if(ok&&alive.current)setCreating(false);});
  }
  const owner = detail?.role === 'OWNER';
  const disabled = loading || pending || documentsPending;
  return <section className="workspace-page" aria-label="我的工作空间" aria-busy={loading || pending}>
    <header className="workspace-page-head">
      <div><p className="workspace-eyebrow">真实账号 / 工作空间</p><h1>{detail?.name ?? '工作空间'}</h1><p className="workspace-boundary">真实空间 · 当前仅文档元数据，不包含 M0 演示文档。</p></div>
      <div className="workspace-actions"><Button ref={refreshTrigger} type="button" variant="outline" disabled={pending||documentsPending} onClick={()=>{if(writing.current||documentsWriting.current)return;setError('');void reload();}}><RefreshCw data-icon="inline-start"/>刷新工作空间</Button>
        <Button ref={createTrigger} type="button" disabled={disabled} onClick={()=>setCreating(true)}><Plus data-icon="inline-start"/>新建空间</Button></div>
    </header>
    <div className="workspace-switcher"><label>当前工作空间<NativeSelect aria-label="当前工作空间" value={detail?.id ?? ''} disabled={disabled} onChange={event=>{if(writing.current||documentsWriting.current)return;selected.current=event.target.value;setError('');setNotice('');setView('documents');void reload(event.target.value);}}>
      <option value="" disabled>请选择工作空间</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect></label>
      {detail && <Badge variant="secondary" data-testid="workspace-role">{detail.role}</Badge>}
      <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft data-icon="inline-start"/>返回 Nova 本地演示</Button>
    </div>
    {loading && <WorkspaceLoading>正在加载工作空间…</WorkspaceLoading>}
    {pending && <p role="status">正在保存…</p>}
    {error && !creating && !(removing&&detail&&owner) && <WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
    {writeCommitted&&error&&<p role="status">操作已由服务端完成，但刷新失败。请刷新工作空间核对，避免重复提交。</p>}
    {notice && !error && <p className="workspace-notice" role="status">{notice}</p>}
    {!loading && !error && items.length===0 && <WorkspaceEmpty title="还没有加入任何工作空间" description="可以先创建一个空间，再添加已经注册的协作者。"/>}
    <WorkspaceDialog open={creating} onOpenChange={setCreating} title="创建工作空间" description="为真实账号建立独立工作空间；此操作不创建协作正文。" pending={pending} restoreFocus={createTrigger}>
      <form onSubmit={create} aria-label="创建工作空间">{error&&<WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
        <label>新空间名称<Input name="name" required maxLength={80} disabled={disabled}/></label>
        <label>空间标识<Input name="slug" required minLength={3} maxLength={64} pattern="[a-z0-9\-]{3,64}" aria-describedby="slug-help" disabled={disabled}/></label>
        <small id="slug-help">3–64 位小写字母、数字或连字符；创建后暂不修改。</small>
        <Button disabled={disabled||writeCommitted}>{pending?'正在创建…':'创建工作空间'}</Button>{writeCommitted&&error&&<Button type="button" variant="outline" onClick={()=>{setCreating(false);void reload();}}>返回空间并刷新</Button>}
      </form>
    </WorkspaceDialog>
    {detail && <Tabs className="workspace-tabs" value={view} onValueChange={setView}>
      <TabsList variant="line" aria-label="工作空间视图">{[{id:'documents',label:'文档',icon:FileText},{id:'members',label:'成员',icon:Users},{id:'settings',label:'设置',icon:Settings}].map(item=><TabsTrigger key={item.id} value={item.id}>
        <item.icon data-icon="inline-start"/>{item.label}{view===item.id&&<motion.span className="workspace-tab-indicator" layoutId="workspace-tab" transition={{type:'tween',duration:reduce?0:.18}}/>}
      </TabsTrigger>)}</TabsList>
      <TabsContent value="documents" forceMount hidden={view!=='documents'}>
        <DocumentsPanel key={`${userId}:${detail.id}:${detail.role}`} workspace={detail} workspacePending={pending} onWritePendingChange={onDocumentWritePendingChange}/>
      </TabsContent>
      <TabsContent value="members" forceMount hidden={view!=='members'}>
        <div className="workspace-section-heading"><div><h2>空间成员</h2><p>角色决定当前空间的访问范围，权限由服务端验证。</p></div><Badge variant="outline">{members.length} 位成员</Badge></div>
        {!owner&&<p className="workspace-readonly">当前角色仅可查看空间与成员，不能管理成员或修改空间。</p>}
        <ul className="member-list">{members.map(member=><li key={member.user.id} data-testid="workspace-member">
          <div className="member-identity"><span className="member-avatar" aria-hidden="true">{Array.from(member.user.displayName)[0]}</span><div><strong>{member.user.displayName}{member.user.id===userId?'（本人）':''}</strong><small>{member.user.email}</small></div></div>
          {owner ? <div className="member-actions"><form key={member.role} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void perform(async()=>{await api(`/workspaces/${detail.id}/members/${member.user.id}`,'PATCH',{role:data.get('role')});});}}>
            <NativeSelect name="role" aria-label={`${member.user.displayName}的角色`} defaultValue={member.role} disabled={disabled}>{['OWNER','EDITOR','VIEWER'].map(role=><option key={role}>{role}</option>)}</NativeSelect>
            <Button variant="outline" aria-label={`更新${member.user.displayName}角色`} disabled={disabled}>更新角色</Button></form>
            <Button variant="ghost" aria-label={`移除${member.user.displayName}`} disabled={disabled} onClick={()=>setRemoving(member)}>移除</Button></div> : <Badge variant="secondary">{member.role}</Badge>}
        </li>)}</ul>
        {owner && <form className="member-add" aria-label="添加已有账号" onSubmit={event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);void perform(async()=>{await api(`/workspaces/${detail.id}/members`,'POST',{email:data.get('email'),role:data.get('role')});form.reset();});}}>
          <div><h3>添加已有账号</h3><p>仅添加已注册用户，不发送邀请邮件。至少保留一位 OWNER。</p></div>
          <label>成员邮箱<Input name="email" type="email" required maxLength={254} disabled={disabled}/></label>
          <label>新成员角色<NativeSelect name="role" aria-label="新成员角色" defaultValue="VIEWER" disabled={disabled}>{['OWNER','EDITOR','VIEWER'].map(role=><option key={role}>{role}</option>)}</NativeSelect></label>
          <Button disabled={disabled}>添加成员</Button>
        </form>}
      </TabsContent>
      <TabsContent value="settings" forceMount hidden={view!=='settings'}>
        <div className="workspace-section-heading"><div><h2>空间设置</h2><p>管理空间名称，空间标识创建后保持不变。</p></div></div>
        <dl className="workspace-properties"><dt>空间标识</dt><dd>{detail.slug}</dd><dt>当前角色</dt><dd>{detail.role}</dd></dl>
        {owner ? <form className="workspace-settings-form" key={detail.name} onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void perform(async()=>{await api(`/workspaces/${detail.id}`,'PATCH',{name:data.get('name')});});}}>
          <label>空间名称<Input name="name" required maxLength={80} defaultValue={detail.name} disabled={disabled}/></label><Button disabled={disabled}>保存空间名称</Button></form>
          : <p className="workspace-readonly">当前角色仅可查看空间与成员，不能管理成员或修改空间。</p>}
      </TabsContent>
    </Tabs>}
    <WorkspaceDialog open={Boolean(removing&&detail&&owner)} onOpenChange={value=>{if(!value)setRemoving(null);}} title="确认移除成员" description={detail&&owner?`移除 ${removing?.user.displayName??''} 后，对方将失去当前空间的访问权限。最后一位 OWNER 仍由服务端保护。`:'访问权限已变化，请刷新工作空间。'} pending={pending} restoreFocus={refreshTrigger}>
      {error&&<WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}<Button variant="destructive" disabled={disabled} onClick={()=>{if(detail&&removing)void perform(async()=>{await api(`/workspaces/${detail.id}/members/${removing.user.id}`,'DELETE');setRemoving(null);});}}>确认移除成员</Button>
    </WorkspaceDialog>
  </section>;
}
