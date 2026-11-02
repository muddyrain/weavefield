import type { ReactNode, RefObject } from 'react';
import { FolderClosed } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export function WorkspaceEmpty({ title, description, children }: {title:string;description:string;children?:ReactNode}) {
  return <Empty className="workspace-empty"><EmptyHeader><EmptyMedia variant="icon"><FolderClosed aria-hidden="true"/></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>{children}</Empty>;
}
export function WorkspaceErrorMessage({ children }: {children:ReactNode}) {
  return <Alert variant="destructive" className="workspace-error"><AlertDescription>{children}</AlertDescription></Alert>;
}
export function WorkspaceLoading({ children, kind = 'documents' }: {children:ReactNode;kind?:'workspace'|'documents'|'tasks'|'members'}) {
  const rows = <>{[0,1,2].map(row=><div className="loading-row" key={row}><Skeleton className="loading-icon"/><div><Skeleton/><Skeleton/></div></div>)}</>;
  return <div className="workspace-loading" role="status"><span>{children}</span><div aria-hidden="true" className={`loading-structure loading-${kind}`}>
    {kind==='tasks' ? <div className="loading-task-board">{[0,1,2].map(column=><div className="loading-task-column" key={column}><Skeleton className="loading-column-title"/>{[0].map(card=><div className="loading-task-card" key={card}><Skeleton/><Skeleton/><Skeleton/></div>)}</div>)}</div>
      : kind==='workspace' ? <><div className="loading-tabs"><Skeleton/><Skeleton/><Skeleton/></div>{rows}<div className="loading-members"><Skeleton className="loading-icon"/><Skeleton className="loading-icon"/><Skeleton className="loading-icon"/></div></> : rows}
  </div></div>;
}
export function WorkspaceDialog({ open, onOpenChange, title, description, pending, children, restoreFocus }: {
  open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;pending:boolean;children:ReactNode;restoreFocus:RefObject<HTMLElement|null>;
}) {
  return <Dialog open={open} onOpenChange={value=>{if(!pending)onOpenChange(value);}}><DialogContent className="wf-ui wf-form-dialog" showCloseButton={!pending}
    onEscapeKeyDown={event=>{if(pending)event.preventDefault();}} onInteractOutside={event=>{if(pending)event.preventDefault();}}
    onCloseAutoFocus={event=>{event.preventDefault();const target=restoreFocus.current;
      if(target?.isConnected&&!target.hasAttribute('disabled'))target.focus({preventScroll:true});else document.getElementById('main-content')?.focus({preventScroll:true});}}>
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}
  </DialogContent></Dialog>;
}
