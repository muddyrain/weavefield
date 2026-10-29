import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { CheckCheck, Link2, Lock, PanelLeft, Workflow } from 'lucide-react';
import AuthPanel from './components/AuthPanel';
import WorkspacePanel from './components/WorkspacePanel';
import CollaborativeEditor from './components/CollaborativeEditor';
import { ShellNavigation, WeaveMark, type NavigationTarget, type PageTab } from './components/ShellNavigation';
import { Button } from './components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './components/ui/sheet';
import { useAuth } from './auth/AuthContext';
import { currentRoom } from './lib/room';
import { cn } from './lib/utils';

const guestName = `访客 ${Math.floor(Math.random() * 900 + 100)}`;
const titles: Record<PageTab,string> = {document:'产品需求文档',workflow:'用户流程',tasks:'开发任务',workspace:'工作空间'};

function PlanningPage({ tab }: { tab: 'workflow' | 'tasks' }) {
  return <section className="planning-page" aria-label={titles[tab]}>
    {tab === 'workflow' ? <Workflow aria-hidden="true"/> : <CheckCheck aria-hidden="true"/>}
    <h1>{titles[tab]} · 规划中</h1>
    <p>{tab === 'workflow' ? '后续通过稳定 ID 连接需求块与流程节点。' : '后续关联需求、负责人、任务进度和验收标准。'}</p>
    <p>这里是产品规划占位，不是已实现的功能。</p>
  </section>;
}

export default function App() {
  const { status, session } = useAuth();
  const [tab, setTab] = useState<PageTab>(()=>{const view=new URLSearchParams(location.search).get('view');return view==='workspace'||view==='workflow'||view==='tasks'?view:'document';});
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width:901px)').matches);
  const mobileNavigation = useRef(false);
  const mainRegion = useRef<HTMLElement>(null);
  const previousPage = useRef(tab);
  useEffect(()=>{if(previousPage.current!==tab&&document.activeElement===document.body)mainRegion.current?.focus({preventScroll:true});previousPage.current=tab;},[tab]);
  const loginTrigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const restoreTriggerFocus = useRef(false);
  const [composing, setComposing] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'success' | 'error'>('idle');
  const room = useMemo(() => { try { return currentRoom(window.location.search); } catch { return 'doc:demo-project'; } }, []);
  const closeWorkspaces = useCallback(() => navigate('document'), []);
  const openWorkspaces = useCallback(() => navigate('workspace'), []);
  useEffect(()=>{const restore=()=>{const view=new URLSearchParams(location.search).get('view');setTab(view==='workspace'||view==='workflow'||view==='tasks'?view:'document');setMobileOpen(false);};window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[]);
  const authenticated = status === 'authenticated';
  useEffect(() => {
    const query = matchMedia('(min-width:901px)');
    const closeDrawer = () => {
      const focused = document.activeElement;
      // 仅接替断点切换后消失的导航焦点，不干扰正文输入。
      restoreTriggerFocus.current = focused === mobileTrigger.current || focused === desktopTrigger.current
        || (!query.matches && Boolean(focused?.closest('.sidebar')));
      setDesktop(query.matches);
      if (query.matches) setMobileOpen(false);
    };
    query.addEventListener('change', closeDrawer);
    return () => query.removeEventListener('change', closeDrawer);
  }, []);
  useEffect(() => {
    if (restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      (desktop ? desktopTrigger : mobileTrigger).current?.focus();
    }
  }, [desktop]);
  function navigate(target: NavigationTarget) {
    setMobileOpen(false);
    const url=new URL(window.location.href);
    if(target==='document')url.searchParams.delete('view');else url.searchParams.set('view',target);
    url.hash='';if(url.href!==window.location.href)history.pushState({},'',url);
    setTab(target);
  }
  async function share() {
    setShareStatus('copying');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(window.location.href); setShareStatus('success');
    } catch { setShareStatus('error'); }
  }
  function preserveEditorFocus(event: PointerEvent<HTMLButtonElement>) {
    // 鼠标收展侧栏时保留正在输入的 Selection；键盘仍可正常聚焦按钮。
    if (event.pointerType === 'mouse' && event.button === 0 && document.activeElement?.closest('.bn-editor')) event.preventDefault();
  }
  const active = tab;
  return <div className={cn('app-frame wf-ui', collapsed && 'sidebar-collapsed', composing && 'is-composing')} style={{'--sidebar-width':collapsed?'64px':'248px'} as CSSProperties}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar" aria-label="桌面侧栏">
      <div className="brand"><WeaveMark/><span>Weavefield</span></div>
      <div className="space-picker"><span className="space-avatar">N</span><span className="space-copy"><strong>Nova</strong><small>本地演示环境</small></span></div>
      <ShellNavigation active={active} collapsed={collapsed} authenticated={authenticated} onNavigate={navigate} group="desktop"/>
      <div className="sidebar-bottom"><Lock aria-hidden="true"/><span>{authenticated ? session?.user.displayName : '访客模式'}<small>{authenticated ? '真实账号与演示权限独立' : '无需账号即可体验本地演示'}</small></span></div>
    </aside>
    <div className="main-panel">
      <header className="topbar">
        {desktop && <Button ref={desktopTrigger} variant="ghost" size="icon" className="icon-button desktop-toggle" aria-label="切换侧栏" aria-expanded={!collapsed} onPointerDown={preserveEditorFocus} onClick={() => setCollapsed(!collapsed)}><PanelLeft/></Button>}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          {!desktop && <SheetTrigger asChild><Button ref={mobileTrigger} variant="ghost" size="icon" className="icon-button mobile-toggle" aria-label="打开导航"><PanelLeft/></Button></SheetTrigger>}
          <SheetContent side="left" className="wf-ui mobile-sheet" onCloseAutoFocus={event => {
            if (mobileNavigation.current) {
              event.preventDefault(); mobileNavigation.current=false; mainRegion.current?.focus({preventScroll:true});
            } else if (desktopTrigger.current) {
              // Sheet 关闭时原移动触发器可能已卸载；此时交给可见的桌面按钮。
              event.preventDefault(); desktopTrigger.current.focus();
            }
          }}>
            <SheetHeader><SheetTitle className="brand"><WeaveMark/>Weavefield</SheetTitle><SheetDescription>真实工作空间与 Nova 本地演示保持独立。</SheetDescription></SheetHeader>
            <ShellNavigation active={active} authenticated={authenticated} onNavigate={target => {
              mobileNavigation.current=true; navigate(target);
            }} group="mobile"/>
          </SheetContent>
        </Sheet>
        <div className="breadcrumb"><span>{tab==='workspace'?'Weavefield':'Nova'}</span><span aria-hidden="true">/</span><strong>{tab === 'document' ? '本地协作演示' : tab==='workspace'?'真实工作空间':`${titles[tab]} · 规划中`}</strong></div>
        <div className="top-actions">
          <AuthPanel onOpenWorkspaces={openWorkspaces} loginTriggerRef={loginTrigger}/>
          {tab==='document'&&<div className="share-control"><Button variant="outline" size="sm" className="share-btn" onClick={share} disabled={shareStatus==='copying'} aria-label="复制本地演示链接" title="仅供同一台电脑的其他标签页或浏览器窗口使用，其他电脑无法访问"><Link2 data-icon="inline-start"/><span>{shareStatus==='copying'?'复制中…':'复制本地演示链接'}</span></Button>
          {(shareStatus==='success'||shareStatus==='error')&&<p className="share-feedback" role="status">{shareStatus==='success'?'已复制本地演示链接，仅供这台电脑的其他标签页或浏览器窗口使用。':'复制失败，请手动复制地址栏链接；该链接仅限这台电脑使用。'}</p>}</div>}
        </div>
      </header>
      <div className="boundary-strip"><span className="demo-pill"><Lock aria-hidden="true"/>{tab==='workspace'?'真实工作空间':'本地演示'}</span><span>{tab==='workspace'?'当前仅文档元数据 · 服务端验证权限':'登录不授予 Nova 协作权限'}</span></div>
      <main ref={mainRegion} id="main-content" className="workspace-body" tabIndex={-1} aria-label={titles[tab]} onCompositionStartCapture={()=>setComposing(true)} onCompositionEndCapture={()=>setComposing(false)}>
        {/* 保持编辑器、provider 和 Y.Doc 的实例，导航只改变可见表面。 */}
        <section className="document-view" hidden={tab!=='document'} aria-label="Nova 本地协作文档">
          <header className="document-head"><p className="document-kind">Nova / 本地协作演示</p><h1>产品需求文档</h1><p className="description">同一份文档，让讨论和修改保持连贯。</p><div className="doc-meta"><span>{guestName}</span><span>Yjs + Hocuspocus</span><span>仅限 localhost</span></div></header>
          <div className="editor-card"><CollaborativeEditor room={room} guestName={guestName}/></div>
        </section>
        <WorkspacePanel open={tab==='workspace'} onClose={closeWorkspaces} onLogin={()=>loginTrigger.current?.click()}/>
        {(tab==='workflow'||tab==='tasks')&&<PlanningPage tab={tab}/>}
      </main>
      <footer className="status-bar"><span>Weavefield · {tab==='workspace'?'真实工作空间':'本地协作演示'}</span><span>真实工作空间仅管理文档元数据</span></footer>
    </div>
  </div>;
}
