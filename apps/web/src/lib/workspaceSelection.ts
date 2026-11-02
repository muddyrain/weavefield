// Workspace 管理页和任务页共用一个按账号隔离的选择；持久值不授予访问权限。
export const workspaceSelectionKey = (userId: string) => `weavefield.workspace.${userId}`;
export function readWorkspaceSelection(userId: string) {
  try { return localStorage.getItem(workspaceSelectionKey(userId)) ?? ''; } catch { return ''; }
}
export function rememberWorkspace(userId: string, id: string) {
  try { if (id) localStorage.setItem(workspaceSelectionKey(userId), id); else localStorage.removeItem(workspaceSelectionKey(userId)); } catch { /* 隐私模式不阻断当前页面。 */ }
}
