import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { DocumentMetadata, WorkspaceSummary } from '@weavefield/shared';
import { useAuth } from '../auth/AuthContext';

class DocumentError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export default function DocumentsPanel({ workspace }: { workspace: WorkspaceSummary }) {
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
      throw new DocumentError(typeof result.message === 'string' ? result.message : '文档请求失败，请重试', response.status);
    }
    return response.json();
  }, [root, current, clearSession]);
  const reload = useCallback(async () => {
    const stamp = ++revision.current;
    setLoading(true); setReading(false); setDetail(null); setSelected(''); setItems([]); setError(''); setNotice('');
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
    return () => { alive.current = false; revision.current++; };
  }, [reload]);

  async function select(id: string) {
    const stamp = ++revision.current;
    setSelected(id); setDetail(null); setReading(true); setError(''); setNotice('');
    try {
      const document = await api<DocumentMetadata>(`/${id}`, 'GET', undefined, stamp);
      if (current(stamp)) setDetail(document);
    } catch (error) {
      if (!current(stamp)) return;
      setSelected('');
      if (error instanceof DocumentError && error.status === 404) setItems(list => list.filter(item => item.id !== id));
      setError(error instanceof Error ? error.message : '无法读取文档');
    } finally { if (current(stamp)) setReading(false); }
  }
  async function mutate(suffix: string, method: string, body: unknown, archived = false) {
    const stamp = ++revision.current;
    setPending(true); setReading(false); setError(''); setNotice('');
    try {
      const document = await api<DocumentMetadata>(suffix, method, body, stamp);
      const list = await api<DocumentMetadata[]>('', 'GET', undefined, stamp);
      if (!current(stamp)) return;
      setItems(list); setDetail(archived ? null : document); setSelected(archived ? '' : document.id);
      setNotice(archived ? '文档已归档' : '文档已保存');
    } catch (error) {
      if (!current(stamp)) return;
      setDetail(null); setSelected('');
      if (error instanceof DocumentError && error.status === 403) setDenied(true);
      if (error instanceof DocumentError && error.status === 404) setItems([]);
      setError(error instanceof Error ? error.message : '操作失败，请重试');
    } finally { if (current(stamp)) setPending(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate('', 'POST', { title: data.get('title') });
  }
  const canWrite = workspace.role !== 'VIEWER' && !denied;
  const disabled = loading || pending;
  return <section className="document-manager" aria-label="空间文档">
    <div className="document-manager-head"><h3>文档</h3><button className="workspace-secondary" type="button" disabled={pending} onClick={() => void reload()}>刷新文档</button></div>
    <p className="document-boundary">这里是真实文档的标题与元数据，不包含 M0 演示文档。正文实时协作将在 M2 实现。</p>
    {loading && <p role="status">正在加载文档…</p>}
    {reading && <p role="status">正在读取文档…</p>}
    {pending && <p role="status">正在保存文档…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {denied && <p>文档写入权限已变化，请刷新工作空间获取最新角色。</p>}
    {!canWrite && <p>文档只读：可查看标题和元数据。</p>}
    {canWrite && <form aria-label="创建文档" onSubmit={create}>
      <label>新文档标题<input name="title" required maxLength={200} disabled={disabled}/></label>
      <button className="workspace-primary" disabled={disabled}>创建文档</button>
    </form>}
    {!loading && !error && items.length === 0 && <p>这个空间还没有文档。</p>}
    <ul className="document-list" aria-label="文档列表">{items.map(item => <li key={item.id}>
      <button type="button" className="workspace-secondary" aria-pressed={selected === item.id} disabled={disabled} onClick={() => void select(item.id)}>{item.title}</button>
    </li>)}</ul>
    {detail && <section className="document-detail" aria-label="文档元数据">
      <h4>{detail.title}</h4>
      <dl><dt>文档编号</dt><dd>{detail.id}</dd><dt>创建时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd><dt>更新时间</dt><dd>{new Date(detail.updatedAt).toLocaleString('zh-CN')}</dd></dl>
      <p>当前仅保存文档元数据。正文编辑尚未开放，不会连接到 Nova 本地协作演示。</p>
      {canWrite && <>
        <form key={`${detail.id}:${detail.title}`} aria-label="重命名文档" onSubmit={event => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void mutate(`/${detail.id}`, 'PATCH', { title: data.get('title') });
        }}><label>文档标题<input name="title" required maxLength={200} defaultValue={detail.title} disabled={disabled}/></label>
          <button className="workspace-secondary" disabled={disabled}>保存文档标题</button></form>
        <button className="workspace-remove" type="button" disabled={disabled} onClick={() => void mutate(`/${detail.id}/archive`, 'POST', {}, true)}>归档文档</button>
        <small>归档后将从当前列表移除；本阶段暂不支持恢复。</small>
      </>}
    </section>}
  </section>;
}
