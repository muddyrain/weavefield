import { useMemo, useState } from 'react';
import { Activity, ArrowUpRight, BookOpenText, CheckCheck, CircleHelp, Clock3, FileText, GitBranch, Layers, LayoutGrid, Link2, Lock, PanelLeft, Plus, Search, Settings2, Sparkles, Users, Workflow } from 'lucide-react';
import AuthPanel from './components/AuthPanel';
import CollaborativeEditor from './components/CollaborativeEditor';
import { currentRoom } from './lib/room';

type Tab = 'document' | 'workflow' | 'tasks';
const guestName = `访客 ${Math.floor(Math.random() * 900 + 100)}`;

function WorkspacePlaceholder({ tab }: { tab: Exclude<Tab, 'document'> }) {
  return (
    <div className="placeholder">
      <div className="placeholder-icon">{tab === 'workflow' ? <Workflow size={25} /> : <CheckCheck size={25} />}</div>
      <p className="eyebrow">COMING IN M3</p>
      <h2>{tab === 'workflow' ? '把想法连接成流程' : '让每个任务都有上下文'}</h2>
      <p>{tab === 'workflow' ? '后续在同一项目中连接需求块、节点与任务，支持稳定 ID 双向跳转。' : '后续展示由同一个需求派生的任务、负责人、进度与验收标准。'}</p>
      <span className="placeholder-badge">这里是产品规划占位，不是已实现的功能</span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('document');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'success' | 'error'>('idle');
  const room = useMemo(() => {
    try { return currentRoom(window.location.search); }
    catch { return 'doc:demo-project'; }
  }, []);
  const share = async () => {
    setShareStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('success');
    } catch {
      setShareStatus('error');
    }
  };

  return (
    <div className={`app-frame ${sidebarOpen ? '' : 'sidebar-hidden'}`}>
      <aside className="sidebar" aria-label="项目导航">
        <div className="brand"><div className="brand-mark"><Layers size={21}/></div><div><b>Weavefield</b><small>织域 · WORKSPACE</small></div></div>
        <div className="space-picker"><span className="space-avatar">N</span><div><strong>Nova 产品空间</strong><span>本地演示环境</span></div><ArrowUpRight size={16}/></div>
        <div className="side-section">WORKSPACE</div>
        <nav className="side-nav">
          <button className={tab === 'document' ? 'active' : ''} onClick={() => setTab('document')}><FileText size={17}/> 产品需求文档 <span>01</span></button>
          <button className={tab === 'workflow' ? 'active' : ''} onClick={() => setTab('workflow')}><Workflow size={17}/> 用户流程 <span>02</span></button>
          <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><LayoutGrid size={17}/> 开发任务 <span>03</span></button>
        </nav>
        <div className="side-section assets-label">QUICK ACCESS</div>
        <nav className="side-nav muted-nav">
          <div><BookOpenText size={17}/> 项目知识库 <span className="soon">规划中</span></div>
          <div><Clock3 size={17}/> 历史版本 <span className="soon">规划中</span></div>
        </nav>
        <div className="sidebar-bottom"><div className="team"> <div className="team-avatar">W</div><div><strong>Weavefield Demo</strong><small>前端 × 实时协作练习</small></div><Settings2 size={15}/></div></div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button" aria-label="切换侧栏" onClick={() => setSidebarOpen(v => !v)}><PanelLeft size={18}/></button>
          <div className="breadcrumb"><span>Nova 产品空间</span><span className="slash">/</span><strong>{tab==='document'?'产品需求文档':tab==='workflow'?'用户流程':'开发任务'}</strong></div>
          <div className="top-actions">
            <AuthPanel/>
            <span className="demo-pill"><Lock size={12}/> 本地演示</span>
            <div className="share-control">
              <button className="share-btn" onClick={share} disabled={shareStatus === 'copying'} title="仅供同一台电脑的其他标签页或浏览器窗口使用，其他电脑无法访问">
                <Link2 size={15}/> {shareStatus === 'copying' ? '复制中…' : '复制本地演示链接'}
              </button>
              {(shareStatus === 'success' || shareStatus === 'error') && (
                <p className="share-feedback" role="status">
                  {shareStatus === 'success'
                    ? '已复制本地演示链接，仅供这台电脑的其他标签页或浏览器窗口使用。'
                    : '复制失败，请手动复制地址栏链接；该链接仅限这台电脑使用。'}
                </p>
              )}
            </div>
          </div>
        </header>
        <section className="workspace-body">
          {tab === 'document' ? (
            <div className="document-view">
              <div className="document-head"><p className="eyebrow">PRODUCT / REQUIREMENTS <span className="separator-dot">•</span> 01</p><h1>产品需求文档 <span className="page-emoji">✦</span></h1><p className="description">好的想法，从每个人都能理解的一份文档开始。</p><div className="doc-meta"><span><Users size={15}/> 多人协作演示</span><span><Activity size={15}/> Yjs + Hocuspocus</span><span><Lock size={15}/> localhost only</span></div></div>
              <div className="note-banner"><Sparkles size={19}/><div><strong>欢迎来到织域的第一个 Demo</strong><p>本机多窗口打开同一链接即可协同编辑。Nova 仍是演示空间，账号登录暂不授予协作权限。</p></div></div>
              <div className="editor-card"><CollaborativeEditor room={room} guestName={guestName}/></div>
            </div>
          ) : <WorkspacePlaceholder tab={tab}/>}
        </section>
        <footer className="status-bar"><span><span className="status-light"/> Weavefield · Prototype v0.1</span><span>目前仅本地演示 · 查看 docs/ROADMAP.md</span></footer>
      </main>
    </div>
  );
}
