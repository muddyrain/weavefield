import { FileText, FolderClosed, LayoutGrid, Workflow } from 'lucide-react';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';

export type PageTab = 'document' | 'workflow' | 'tasks' | 'workspace';
export type NavigationTarget = PageTab | 'workspace';

export function WeaveMark() {
  return <svg className="weave-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 4v14a5 5 0 0 0 10 0V4M5 11h18M15 22 24 5M7 22h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function ShellNavigation({ active, collapsed = false, authenticated, onNavigate, group }: {
  active: NavigationTarget; collapsed?: boolean; authenticated: boolean;
  onNavigate: (target: NavigationTarget) => void; group: string;
}) {
  const reduce = useReducedMotion();
  const items = [
    { id: 'workspace', label: '工作空间', icon: FolderClosed, group: '真实账号', hint: authenticated ? '成员与文档元数据' : '登录后可用' },
    { id: 'document', label: '产品需求文档', icon: FileText, group: '本地协作演示', hint: 'Nova · localhost' },
    { id: 'workflow', label: '用户流程', icon: Workflow, group: '后续规划', hint: '规划中' },
    { id: 'tasks', label: '开发任务', icon: LayoutGrid, hint: '规划中' },
  ] as const;
  return <LayoutGroup id={group}><nav className="shell-navigation" aria-label="项目导航">{items.map(item => <div key={item.id}>
    {'group' in item && <div className="shell-nav-section">{collapsed ? <span aria-hidden="true">·</span> : item.group}</div>}
    <Button variant="navigation" className="shell-nav-button" data-active={active === item.id} aria-current={active === item.id ? 'page' : undefined}
      aria-label={item.label} title={`${item.label} · ${item.hint}`} onClick={() => onNavigate(item.id)}>
      {active === item.id && <motion.span className="shell-nav-indicator" layoutId="navigation-selection" transition={{type:'tween',duration:reduce?0:.2,ease:[.22,1,.36,1]}}/>}
      <item.icon data-icon="inline-start"/><span className="shell-nav-copy"><span>{item.label}</span>{!collapsed && <small>{item.hint}</small>}</span>
    </Button>
  </div>)}</nav></LayoutGroup>;
}
