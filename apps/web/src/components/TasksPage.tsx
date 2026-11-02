import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { TaskMetadata, TaskStatus, WorkspaceSummary } from '@weavefield/shared';
import { ArrowLeft, CheckCheck, Circle, CircleCheck, CircleDot, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { toast } from 'sonner';
import { readWorkspaceSelection, rememberWorkspace } from '../lib/workspaceSelection';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { WorkspaceSelect } from './WorkspaceSelect';
import { WorkspaceDialog, WorkspaceEmpty, WorkspaceErrorMessage, WorkspaceLoading } from './WorkspacePrimitives';

const columns = [
  { status: 'TODO', label: '待办', icon: Circle },
  { status: 'IN_PROGRESS', label: '进行中', icon: CircleDot },
  { status: 'DONE', label: '已完成', icon: CircleCheck },
] as const;
type Draft = { id?: string; title: string; description: string; status: TaskStatus; version?: number };
const draftOf = (task: TaskMetadata): Draft => ({ ...task, description: task.description ?? '' });
class TaskError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export default function TasksPage({ open, onLogin, onWorkspaces }: { open: boolean; onLogin: () => void; onWorkspaces: () => void }) {
  const { status, session } = useAuth();
  if (!open) return null;
  return status === 'authenticated' && session ? <TaskManager key={session.user.id} userId={session.user.id} onWorkspaces={onWorkspaces}/> :
    <section className="workspace-page tasks-page" aria-label="开发任务"><h1>开发任务</h1>
      <WorkspaceEmpty title="登录后，安排团队的下一步" description={status === 'loading' ? '正在验证账号…' : '任务保存在真实工作空间中，与 Nova 本地协作演示独立。'}>
        <Button disabled={status === 'loading'} onClick={onLogin}>登录 / 注册真实账号</Button>
      </WorkspaceEmpty>
    </section>;
}

function TaskManager({ userId, onWorkspaces }: { userId: string; onWorkspaces: () => void }) {
  const { clearSession } = useAuth();
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [tasks, setTasks] = useState<TaskMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useRef(false), visibleScope = useRef('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [denied, setDenied] = useState(false);
  const revision = useRef(0), alive = useRef(true), writing = useRef(false), editing = useRef(false);
  const selected = useRef(readWorkspaceSelection(userId));
  const createTrigger = useRef<HTMLButtonElement>(null), refreshTrigger = useRef<HTMLButtonElement>(null), taskTrigger = useRef<HTMLElement | null>(null);
  const current = useCallback((stamp: number) => alive.current && revision.current === stamp, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);

  const api = useCallback(async <T,>(route: string, stamp: number, method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(`/api${route}`, { method, credentials: 'include', cache: 'no-store',
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json', 'X-Weavefield-Request': '1' }, body: JSON.stringify(body) }) });
    if (response.status === 401 && current(stamp)) clearSession();
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new TaskError(typeof data.message === 'string' ? data.message : '任务请求失败，请刷新后重试', response.status); }
    return response.json();
  }, [clearSession, current]);

  const snapshot = useCallback(async (stamp: number, preferred: string) => {
    const list = await api<WorkspaceSummary[]>('/workspaces', stamp);
    const target = preferred || list[0]?.id;
    if (!target || !list.some(item => item.id === target)) return { list, space: null, items: [], unavailable: Boolean(preferred) };
    const [space, items] = await Promise.all([api<WorkspaceSummary>(`/workspaces/${target}`, stamp), api<TaskMetadata[]>(`/workspaces/${target}/tasks`, stamp)]);
    return { list, space, items, unavailable: false };
  }, [api]);
  const applySnapshot = useCallback((value: Awaited<ReturnType<typeof snapshot>>) => {
    setSpaces(value.list); setWorkspace(value.space); setTasks(value.items); setDenied(false);
    loaded.current = true; visibleScope.current = value.space?.id ?? '';
    selected.current = value.space?.id ?? ''; rememberWorkspace(userId, selected.current);
    if (value.unavailable) setError('所选空间已不可访问，请重新选择工作空间');
  }, [userId]);
  function clearProtected() { loaded.current = false; visibleScope.current = ''; setWorkspace(null); setTasks([]); setSpaces([]); selected.current = ''; rememberWorkspace(userId, ''); }
  const reload = useCallback(async (preferred = selected.current) => {
    if (writing.current) return;
    const stamp = ++revision.current, background = loaded.current && preferred === visibleScope.current;
    setLoading(!background); setRefreshing(background); setError('');
    if (!background) { setWorkspace(null); setTasks([]); }
    try { const value = await snapshot(stamp, preferred); if (current(stamp)) applySnapshot(value); }
    catch (e) {
      if (!current(stamp)) return;
      if (!background || e instanceof TaskError && [401, 403, 404].includes(e.status)) {
        setWorkspace(null); setTasks([]); setSpaces([]); loaded.current = false; visibleScope.current = '';
        if (e instanceof TaskError && [403, 404].includes(e.status)) { selected.current = ''; rememberWorkspace(userId, ''); }
      }
      setError(e instanceof Error ? e.message : '无法连接任务服务');
    }
    finally { if (current(stamp)) { setLoading(false); setRefreshing(false); } }
  }, [snapshot, current, applySnapshot, userId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    // 写入和后续读取期间不推进 revision；表单草稿也不被焦点刷新替换。
    // AuthContext 的独立 Session 检查始终保持工作。
    const refresh = () => { if (document.visibilityState === 'visible' && !writing.current && !editing.current) void reload(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(timer); };
  }, [reload]);
  const canWrite = Boolean(workspace && workspace.role !== 'VIEWER' && !denied);
  function openTask(value: Draft) { if (writing.current) return; taskTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : refreshTrigger.current; editing.current = true; setDraft(value); setConflict(false); setUncertain(false); setCommitted(false); setError(''); }
  function closeTask() { if (writing.current) return; editing.current = false; setDraft(null); setConflict(false); setUncertain(false); setCommitted(false); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writing.current || !workspace || !draft || !canWrite || conflict || uncertain || committed) return;
    writing.current = true;
    const stamp = ++revision.current, root = `/workspaces/${workspace.id}/tasks`, input = draft;
    setPending(true); setRefreshing(false); setError(''); let saved = false;
    try {
      await api<TaskMetadata>(`${root}${input.id ? `/${input.id}` : ''}`, stamp, input.id ? 'PATCH' : 'POST',
        { title: input.title, description: input.description, ...(input.id ? { status: input.status, version: input.version } : {}) });
      if (!current(stamp)) return;
      saved = true; setCommitted(true);
      const value = await snapshot(stamp, selected.current);
      if (!current(stamp)) return;
      applySnapshot(value); if (value.unavailable) setError('任务已保存，但当前空间已不可访问，请重新选择工作空间。'); editing.current = false; setDraft(null); setCommitted(false);
      if (!value.unavailable) toast.success(input.id ? '任务已保存' : '任务已创建', { id: 'task-save' });
    } catch (e) {
      if (!current(stamp)) return;
      if (saved) {
        setError('任务已由服务端保存，但刷新失败。请刷新看板核对，避免重复提交。');
        if (e instanceof TaskError && [403, 404].includes(e.status)) { clearProtected(); editing.current = false; setDraft(null); }
      }
      else if (e instanceof TaskError && e.status === 409) { setConflict(true); setError('任务已被其他人修改，你的草稿尚未提交。加载最新版本将替换当前草稿。'); }
      else if (!(e instanceof TaskError) || e.status >= 500) { setUncertain(true); setError('提交结果无法确认。请返回看板刷新核对，不要重复提交。'); }
      else {
        setError(e.message);
        if (e.status === 403 || e.status === 404) {
          setDenied(true); editing.current = false; setDraft(null);
          try { const value = await snapshot(stamp, selected.current); if (current(stamp)) applySnapshot(value); }
          catch { if (current(stamp)) clearProtected(); }
        }
      }
    } finally { writing.current = false; if (current(stamp)) setPending(false); }
  }
  async function loadLatest() {
    if (writing.current || !workspace || !draft?.id) return;
    writing.current = true; const stamp = ++revision.current; setPending(true); setRefreshing(false);
    try {
      const task = await api<TaskMetadata>(`/workspaces/${workspace.id}/tasks/${draft.id}`, stamp);
      if (current(stamp)) { setDraft(draftOf(task)); setConflict(false); setError(''); toast.info('已加载最新版本，请重新编辑后保存', { id: 'task-latest' }); }
    } catch (e) { if (current(stamp)) { setError(e instanceof Error ? e.message : '无法加载最新任务'); if (e instanceof TaskError && [403, 404].includes(e.status)) { clearProtected(); editing.current = false; setDraft(null); } } }
    finally { writing.current = false; if (current(stamp)) setPending(false); }
  }
  const disabled = loading || pending;
  return <section className="workspace-page tasks-page" aria-label="开发任务" aria-busy={disabled || refreshing}>
    <header className="workspace-page-head">
      <div><p className="workspace-eyebrow">真实账号 / 工作空间任务</p><h1>开发任务</h1><p className="workspace-boundary">把下一步变成可完成的工作。任务由当前空间成员共享。</p></div>
      <div className="workspace-actions"><Button ref={refreshTrigger} data-refreshing={refreshing} variant="outline" disabled={pending} onClick={() => { if (!writing.current) void reload(); }}><RefreshCw data-icon="inline-start"/>刷新任务</Button>
        {canWrite && <Button ref={createTrigger} disabled={disabled} onClick={() => openTask({ title: '', description: '', status: 'TODO' })}><Plus data-icon="inline-start"/>新建任务</Button>}</div>
    </header>
    <div className="workspace-switcher"><div className="select-field"><span>当前工作空间</span><WorkspaceSelect loading={loading} aria-label="当前工作空间" placeholder="请选择工作空间" value={workspace?.id ?? ''} disabled={disabled} options={spaces.map(item=>({value:item.id,label:item.name}))} onValueChange={value => {
      if (writing.current) return; selected.current = value; editing.current = false; setDraft(null); void reload(value);
    }}/></div>
      {workspace && <Badge variant="secondary" data-testid="task-workspace-role">{workspace.role}</Badge>}
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => { if (!writing.current) onWorkspaces(); }}><ArrowLeft data-icon="inline-start"/>管理工作空间</Button>
    </div>
    {loading && <WorkspaceLoading kind="tasks">正在加载任务…</WorkspaceLoading>}
    {pending && <p role="status">正在保存或加载任务，请稍候…</p>}
    {error && !draft && <WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
    {refreshing && <p className="refresh-progress" role="status">正在刷新任务，现有内容保持可用…</p>}
    {!loading && !error && !spaces.length && <WorkspaceEmpty title="还没有加入工作空间" description="先创建工作空间或请管理员添加你的真实账号，再开始安排任务。"><Button variant="outline" onClick={onWorkspaces}>前往工作空间</Button></WorkspaceEmpty>}
    {workspace && <>
      {!canWrite && <p className="workspace-readonly">任务只读：可以查看任务，不能创建或修改。</p>}
      <div className="task-board" aria-label={`${workspace.name}任务看板`}>{columns.map(column => {
        const items = tasks.filter(task => task.status === column.status);
        return <section key={column.status} className="task-column" aria-label={`${column.label}任务`} data-task-status={column.status}>
          <header><h2><column.icon aria-hidden="true"/>{column.label}</h2><Badge variant="secondary">{items.length}</Badge></header>
          <ul>{items.map(task => <li key={task.id}><Button variant="ghost" className="task-card" aria-label={`${canWrite ? '编辑' : '查看'}任务：${task.title}`} disabled={pending} onClick={() => openTask(draftOf(task))}>
            <span className="task-card-title">{task.title}</span>{task.description && <span className="task-card-description">{task.description}</span>}<span className="task-card-meta">{canWrite ? '编辑任务' : '查看详情'}<span>v{task.version}</span></span>
          </Button></li>)}</ul>
          {!items.length && <p className="task-column-empty"><CheckCheck aria-hidden="true"/>{column.status === 'TODO' ? '新的工作，从这里开始' : column.status === 'IN_PROGRESS' ? '开始处理后，任务会出现在这里' : '完成的工作，会在这里积累'}</p>}
        </section>;
      })}</div>
    </>}
    <WorkspaceDialog open={Boolean(draft)} onOpenChange={value => { if (!value) closeTask(); }} title={draft?.id ? canWrite ? '编辑任务' : '任务详情' : '创建任务'} description={canWrite ? '任务保存在当前工作空间。其他成员的修改会通过版本检查保护。' : '当前账号仅可查看这项任务。'} pending={pending} restoreFocus={taskTrigger}>
      {draft && (canWrite ? <form aria-label={draft.id ? '编辑任务' : '创建任务'} onSubmit={save}>
        {error && <WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
        <label>任务标题<Input required maxLength={200} value={draft.title} disabled={pending || committed} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label>任务描述<Textarea maxLength={1000} rows={5} value={draft.description} disabled={pending || committed} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="补充背景、工作内容或验收说明（可选）"/></label>
        <small className="task-form-help">标题最多 200 字符，描述最多 1000 字符。同名任务可以共存。</small>
        {draft.id && <div className="select-field"><span>任务状态</span><WorkspaceSelect aria-label="任务状态" value={draft.status} disabled={pending || committed} options={columns.map(c=>({value:c.status,label:c.label}))} onValueChange={value => setDraft({ ...draft, status: value as TaskStatus })}/></div>}
        <div className="task-form-actions"><Button disabled={pending || committed || uncertain || conflict}>{pending ? '正在处理…' : draft.id ? '保存任务' : '创建任务'}</Button>
          {conflict && <Button type="button" variant="outline" disabled={pending} onClick={() => void loadLatest()}>加载最新版本</Button>}
          {(uncertain || committed) && <Button type="button" variant="outline" disabled={pending} onClick={() => { closeTask(); void reload(); }}>返回看板并刷新</Button>}
        </div>
      </form> : <div className="task-readonly-detail"><h3>{draft.title}</h3><p>{draft.description || '暂无描述'}</p><Badge variant="secondary">{columns.find(c => c.status === draft.status)?.label}</Badge></div>)}
    </WorkspaceDialog>
  </section>;
}
