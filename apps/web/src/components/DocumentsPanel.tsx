import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { DocumentMetadata, WorkspaceSummary } from '@weavefield/shared';
import { useAuth } from '../auth/AuthContext';
import { FileText, Plus, RefreshCw, ChevronRight, X, Archive } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { WorkspaceDialog, WorkspaceEmpty, WorkspaceErrorMessage, WorkspaceLoading } from './WorkspacePrimitives';

class DocumentError extends Error {
  constructor(message: string, readonly status: number, readonly listRequest: boolean) { super(message); }
}

export default function DocumentsPanel({ workspace, workspacePending, onWritePendingChange }: { workspace: WorkspaceSummary; workspacePending: boolean; onWritePendingChange: (value: boolean) => boolean }) {
  const { clearSession } = useAuth();
  const [items, setItems] = useState<DocumentMetadata[]>([]);
  const [detail, setDetail] = useState<DocumentMetadata | null>(null);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [writeCommitted, setWriteCommitted] = useState(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const refreshTrigger = useRef<HTMLButtonElement>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const root = `/workspaces/${workspace.id}/documents`;
  const current = useCallback((stamp: number) => alive.current && stamp === revision.current, []);
  const api = useCallback(async <T,>(suffix: string, method: string, body: unknown, stamp: number): Promise<T> => {
    const response = await fetch(`/api${root}${suffix}`, { method, credentials: 'include', cache: 'no-store',
      ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json', 'X-Weavefield-Request': '1' }, body: JSON.stringify(body ?? {}) }) });
    if (response.status === 401 && current(stamp)) clearSession();
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new DocumentError(typeof result.message === 'string' ? result.message : '文档请求失败，请重试', response.status, suffix === '' && method === 'GET');
    }
    return response.json();
  }, [root, current, clearSession]);
  const reload = useCallback(async () => {
    const stamp = ++revision.current;
    setWriteCommitted(false); setLoading(true); setReading(false); setDetail(null); setSelected(''); setItems([]); setError(''); setNotice('');
    try {
      const list = await api<DocumentMetadata[]>('', 'GET', undefined, stamp);
      if (current(stamp)) setItems(list);
    } catch (error) {
      if (current(stamp)) setError(error instanceof Error ? error.message : '无法连接文档服务');
    } finally { if (current(stamp)) setLoading(false); }
  }, [api, current]);
  useEffect(() => {
    alive.current = true;
    void reload();
    // 父组件按用户、空间、角色和打开状态卸载；旧请求不能写入新选择。
    return () => { alive.current = false; revision.current++; onWritePendingChange(false); };
  }, [reload, onWritePendingChange]);

  async function handleFailure(error: unknown, stamp: number, id: string) {
    if (!current(stamp)) return;
    setDetail(null); setSelected('');
    if (error instanceof DocumentError && error.status === 403) setDenied(true);
    setError(error instanceof Error ? error.message : '文档请求失败，请重试');
    if (error instanceof DocumentError && error.listRequest && (error.status === 404 || error.status === 403)) setItems([]);
    if (!(error instanceof DocumentError) || error.status !== 404 || error.listRequest) return;
    // 单篇文档失效不代表空间失效；重新读取列表，由服务端确认当前读取权限。
    setItems(list => list.filter(item => item.id !== id));
    try {
      const list = await api<DocumentMetadata[]>('', 'GET', undefined, stamp);
      if (current(stamp)) setItems(list);
    } catch (error) {
      if (!current(stamp)) return;
      if (error instanceof DocumentError && (error.status === 404 || error.status === 403)) setItems([]);
      if (error instanceof DocumentError && error.status === 403) setDenied(true);
      setError(error instanceof Error ? error.message : '无法连接文档服务，请刷新文档重试');
    }
  }

  async function select(id: string) {
    const stamp = ++revision.current;
    setSelected(id); setDetail(null); setReading(true); setError(''); setNotice('');
    try {
      const document = await api<DocumentMetadata>(`/${id}`, 'GET', undefined, stamp);
      if (current(stamp)) setDetail(document);
    } catch (error) {
      await handleFailure(error, stamp, id);
    } finally { if (current(stamp)) setReading(false); }
  }
  async function mutate(suffix: string, method: string, body: unknown, archived = false) {
    if (!onWritePendingChange(true)) return false;
    const stamp = ++revision.current;
    setWriteCommitted(false); setPending(true); setReading(false); setError(''); setNotice('');
    try {
      const document = await api<DocumentMetadata>(suffix, method, body, stamp);
      if (!current(stamp)) return false;
      setWriteCommitted(true);
      // 归档已由真实响应确认，刷新失败时也不能继续把它列为活跃文档。
      if (archived) { setItems(list=>list.filter(item=>item.id!==document.id));setDetail(null);setSelected(''); }
      const list = await api<DocumentMetadata[]>('', 'GET', undefined, stamp);
      if (!current(stamp)) return false;
      setItems(list); setDetail(archived ? null : document); setSelected(archived ? '' : document.id);
      setWriteCommitted(false); setNotice(archived ? '文档已归档' : '文档已保存');
      return true;
    } catch (error) {
      await handleFailure(error, stamp, selected);
      return false;
    } finally {
      // 卸载时已释放旧空间标记；迟到响应不能清掉新控制器正在使用的标记。
      if (alive.current) onWritePendingChange(false);
      if (current(stamp)) setPending(false);
    }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate('', 'POST', { title: data.get('title') }).then(ok=>{if(ok&&alive.current)setCreating(false);});
  }
  const canWrite = workspace.role !== 'VIEWER' && !denied;
  const disabled = loading || pending || workspacePending;
  const formOpen = creating && canWrite;
  const confirmOpen = archiving && Boolean(detail) && canWrite;
  return <section className="workspace-documents" aria-label="空间文档">
    <div className="workspace-section-heading"><div><h2>文档</h2><p className="document-boundary">真实文档的标题与元数据。正文实时协作将在 M2 实现。</p></div>
      <div className="workspace-actions"><Button ref={refreshTrigger} type="button" variant="ghost" disabled={pending} onClick={()=>void reload()}><RefreshCw data-icon="inline-start"/>刷新文档</Button>
        {canWrite&&<Button ref={createTrigger} disabled={disabled} onClick={()=>setCreating(true)}><Plus data-icon="inline-start"/>新建文档</Button>}</div>
    </div>
    {loading&&<WorkspaceLoading>正在加载文档…</WorkspaceLoading>}
    {reading&&<p role="status">正在读取文档…</p>}{pending&&<p role="status">正在保存文档…</p>}
    {error&&!formOpen&&!confirmOpen&&<WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
    {writeCommitted&&error&&<p role="status">操作已由服务端完成，但列表刷新失败。请刷新文档核对，避免重复提交。</p>}
    {notice&&<p role="status" className="workspace-notice">{notice}</p>}
    {denied&&<p className="workspace-readonly">文档写入权限已变化，请刷新工作空间获取最新角色。</p>}
    {!canWrite&&<p className="workspace-readonly">文档只读：可查看标题和元数据。</p>}
    {!loading&&!error&&items.length===0&&<WorkspaceEmpty title="这个空间还没有文档。" description={canWrite?'创建一份文档元数据，整理团队的工作内容。':'当前空间没有可查看的文档元数据。'}/>}
    <div className="documents-layout" data-detail-open={Boolean(detail||reading)}>
      <ul className="workspace-document-list" aria-label="文档列表">{items.map(item=><li key={item.id}>
        <Button variant="ghost" type="button" aria-label={item.title} aria-pressed={selected===item.id} disabled={disabled} onClick={()=>void select(item.id)}>
          <FileText data-icon="inline-start"/><span><strong>{item.title}</strong><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('zh-CN')}</time></span><ChevronRight data-icon="inline-end"/>
        </Button>
      </li>)}</ul>
      {detail&&<section className="workspace-document-detail" aria-label="文档元数据">
        <div className="document-detail-heading"><Badge variant="outline">仅元数据</Badge><Button variant="ghost" size="icon" aria-label="关闭文档详情" disabled={pending} onClick={()=>{revision.current++;setDetail(null);setSelected('');setReading(false);refreshTrigger.current?.focus({preventScroll:true});}}><X/></Button></div>
        <h3>{detail.title}</h3><dl className="workspace-properties"><dt>文档编号</dt><dd>{detail.id}</dd><dt>创建时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd><dt>更新时间</dt><dd>{new Date(detail.updatedAt).toLocaleString('zh-CN')}</dd></dl>
        <p className="metadata-note">当前仅保存文档元数据。正文编辑尚未开放，不会连接到 Nova 本地协作演示。</p>
        {canWrite&&<><form key={`${detail.id}:${detail.title}`} aria-label="重命名文档" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void mutate(`/${detail.id}`,'PATCH',{title:data.get('title')});}}>
          <label>文档标题<Input name="title" required maxLength={200} defaultValue={detail.title} disabled={disabled}/></label><Button variant="outline" disabled={disabled}>保存文档标题</Button></form>
          <Button variant="destructive" disabled={disabled} onClick={()=>setArchiving(true)}><Archive data-icon="inline-start"/>归档文档</Button><small>归档后将从当前列表移除；本阶段暂不支持恢复。</small>
        </>}
      </section>}
    </div>
    <WorkspaceDialog open={formOpen} onOpenChange={setCreating} title="创建文档" description="仅创建当前工作空间内的文档元数据，不创建可编辑正文。" pending={pending} restoreFocus={canWrite?createTrigger:refreshTrigger}>
      <form aria-label="创建文档" onSubmit={create}>{error&&<WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}
        {writeCommitted&&error&&<p role="status">服务端已完成创建，请返回列表并刷新核对。</p>}
        <label>新文档标题<Input name="title" required maxLength={200} disabled={disabled||writeCommitted}/></label>
        <Button disabled={disabled||writeCommitted}>{pending?'正在创建…':'创建文档'}</Button>
        {writeCommitted&&error&&<Button type="button" variant="outline" onClick={()=>{setCreating(false);void reload();}}>返回列表并刷新</Button>}
      </form>
    </WorkspaceDialog>
    <WorkspaceDialog open={confirmOpen} onOpenChange={setArchiving} title="确认归档文档" description={detail?`归档「${detail.title}」后将从活跃列表移除，本阶段暂不支持恢复。`:'文档详情已清理。'} pending={pending} restoreFocus={refreshTrigger}>
      {error&&<WorkspaceErrorMessage>{error}</WorkspaceErrorMessage>}<Button variant="destructive" disabled={disabled||!detail} onClick={()=>{if(detail)void mutate(`/${detail.id}/archive`,'POST',{},true).then(ok=>{if(ok&&alive.current)setArchiving(false);});}}>确认归档文档</Button>
    </WorkspaceDialog>
  </section>;
}
