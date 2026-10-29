import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

// 只在独立测试 API 注册 / 登录，不消耗共享 API 的认证限流额度。
const localRequire = createRequire(path.resolve('package.json'));
const apiRequire = createRequire(path.resolve('apps/api/package.json'));
let prisma: any, authApi: any, authBase: string, server: ChildProcess, storage: string;
const email = `ui201-${randomUUID()}@example.invalid`, password = 'UI201 local test password 42!';
const headers = { Origin: 'http://127.0.0.1:15173', 'X-Weavefield-Request': '1' };
test.use({ trace: 'off', video: 'on' });
test.beforeAll(async ({ browser }) => {
  prisma = await localRequire('./tests/helpers/database.cjs').prepareDatabase();
  apiRequire('reflect-metadata'); process.env.WEB_ORIGIN = headers.Origin;
  authApi = await apiRequire('./dist/application').createApplication();
  await authApi.listen(0,'127.0.0.1'); authBase = await authApi.getUrl();
  const context = await browser.newContext();
  try { expect((await context.request.post(`${authBase}/auth/register`,{headers,data:{email,password,displayName:'UI2 本机验收'}})).status()).toBe(201); }
  finally { await context.close(); }
  storage = await mkdtemp(path.join(tmpdir(),'weavefield-ui201-'));
  server = spawn(process.execPath,['--import',pathToFileURL(path.resolve('apps/collab/node_modules/tsx/dist/loader.mjs')).href,path.resolve('apps/collab/src/index.ts')],{cwd:storage,env:{...process.env,NODE_ENV:'test',COLLAB_PORT:'11234',COLLAB_DEV_TOKEN:'m0-e2e-local-only-token'},stdio:'ignore'});
  await expect.poll(()=>fetch('http://127.0.0.1:11234').then(r=>r.ok).catch(()=>false)).toBe(true);
});
test.afterAll(async () => {
  if(server?.exitCode===null){const exited=once(server,'exit');server.kill();await exited;}
  if(storage)await rm(storage,{recursive:true,force:true});
  try { if(prisma)await prisma.user.deleteMany({where:{email}}); }
  finally { if(authApi)await authApi.close();if(prisma)await prisma.$disconnect(); }
});
async function open(page:Page) {
  await page.goto(`/?doc=ui201-${randomUUID()}`);
  await expect(page.locator('.editor-status')).toHaveAttribute('data-state','synced');
  await expect(page.getByRole('button',{name:'登录 / 注册',exact:true})).toBeEnabled();
}
async function startFrames(page:Page) {
  await page.evaluate(()=>{
    const global=window as any;global.shellFrames=[];
    global.shellFinished=new Promise<void>(resolve=>{const start=performance.now();function frame(t:number){const side=document.querySelector('.sidebar')!.getBoundingClientRect(),main=document.querySelector('.main-panel')!.getBoundingClientRect();global.shellFrames.push({ms:t-start,side:side.width,x:main.x,right:main.right});if(t-start<400)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
  });
}
async function frames(page:Page){return page.evaluate(async()=>{await (window as any).shellFinished;return (window as any).shellFrames as {ms:number;side:number;x:number;right:number}[];});}

for(const viewport of [{width:1440,height:900},{width:1280,height:720}])test.describe(`${viewport.width} desktop shell`,()=>{
  test.use({viewport});
  test('continuous sidebar layout preserves editor, scroll, selection and Chinese composition',async({page},info)=>{
    let sockets=0;page.on('websocket',()=>sockets++);
    await open(page);const editor=page.locator('[contenteditable=true]').first();
    await editor.fill('Weavefield · 正式应用外壳验收');
    for(let i=0;i<40;i++){await page.keyboard.press('Enter');await page.keyboard.insertText(`协作文档段落 ${i}：侧栏过渡保持输入与滚动连续。`);}
    await editor.evaluate((el:any)=>{(window as any).retainedEditor=el;(window as any).retainedTiptap=el.editor;});
    const selection=await editor.evaluate((el:any)=>({anchor:el.editor.view.state.selection.anchor,head:el.editor.view.state.selection.head}));
    const beforeScroll=await page.locator('.workspace-body').evaluate(e=>e.scrollTop),socketCount=sockets;
    await startFrames(page);await page.getByRole('button',{name:'切换侧栏',exact:true}).click();const measured=await frames(page);
    expect(measured.some(f=>f.side>65&&f.side<247)).toBe(true);
    for(const frame of measured){expect(Math.abs(frame.x-frame.side)).toBeLessThanOrEqual(1);expect(Math.abs(frame.right-viewport.width)).toBeLessThanOrEqual(1);}
    await expect(editor).toBeFocused();expect(await page.locator('.workspace-body').evaluate(e=>e.scrollTop)).toBe(beforeScroll);
    expect(await editor.evaluate((el:any)=>({anchor:el.editor.view.state.selection.anchor,head:el.editor.view.state.selection.head}))).toEqual(selection);
    expect(await editor.evaluate((el:any)=>el===(window as any).retainedEditor&&el.editor===(window as any).retainedTiptap)).toBe(true);
    await page.locator('.workspace-body').evaluate(e=>e.scrollTop=0);await page.screenshot({path:info.outputPath(`${viewport.width}-collapsed.png`)});
    await editor.focus();await page.keyboard.press('ControlOrMeta+End');
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'中文',selectionStart:2,selectionEnd:2});
    await expect(page.locator('.app-frame')).toHaveClass(/is-composing/);
    await page.getByRole('button',{name:'切换侧栏',exact:true}).click();
    await cdp.send('Input.insertText',{text:'中文输入完成'});await cdp.detach();
    await expect(editor).toContainText('中文输入完成');await expect(page.locator('.app-frame')).not.toHaveClass(/is-composing/);
    await page.getByRole('button',{name:'用户流程',exact:true}).click();await expect(page.getByRole('heading',{name:'用户流程 · 规划中'})).toBeVisible();
    const skip=page.getByRole('link',{name:'跳到主要内容'});await skip.focus();await skip.press('Enter');await expect(page.locator('#main-content')).toBeFocused();
    await page.getByRole('button',{name:'产品需求文档',exact:true}).click();await expect(editor).toContainText('中文输入完成');
    expect(await editor.evaluate((el:any)=>el===(window as any).retainedEditor&&el.editor===(window as any).retainedTiptap)).toBe(true);expect(sockets).toBe(socketCount);
    await page.locator('.workspace-body').evaluate(e=>e.scrollTop=0);await page.screenshot({path:info.outputPath(`${viewport.width}-document.png`)});
    await info.attach('sidebar-intermediate-frames',{body:JSON.stringify(measured),contentType:'application/json'});
  });
});
for(const width of [390,375])test.describe(`${width} mobile shell`,()=>{
  test.use({viewport:{width,height:844}});
  test('Sheet traps focus, closes on Escape, restores navigation and exposes login',async({page},info)=>{
    await open(page);const editor=page.locator('[contenteditable=true]').first();await editor.fill('移动端真实协作文档：保留正文与编辑器实例。');
    await page.screenshot({path:info.outputPath(`${width}-document.png`)});
    const trigger=page.getByRole('button',{name:'打开导航',exact:true});await trigger.click();const sheet=page.locator('[data-slot=sheet-content]');await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button',{name:'工作空间',exact:true})).toBeEnabled();
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('[data-slot=sheet-content]')))).toBe(true);}
    await page.screenshot({path:info.outputPath(`${width}-sheet.png`)});
    await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(trigger).toBeFocused();
    await trigger.click();await sheet.getByRole('button',{name:'开发任务',exact:true}).click();await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'开发任务 · 规划中'})).toBeVisible();const skip=page.getByRole('link',{name:'跳到主要内容'});await skip.focus();await skip.press('Enter');await expect(page.locator('#main-content')).toBeFocused();
    await trigger.click();await sheet.getByRole('button',{name:'产品需求文档',exact:true}).click();await expect(sheet).toHaveCount(0);await expect(editor).toContainText('移动端真实协作文档');
    await page.getByRole('button',{name:'登录 / 注册',exact:true}).click();await expect(page.getByRole('dialog',{name:'登录'})).toBeVisible();await page.screenshot({path:info.outputPath(`${width}-login.png`)});await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(await page.evaluate(()=>scrollY)).toBe(0);
  });
});
for(const width of [1440,390])test.describe(`${width} workspace entry`,()=>{
  test.use({viewport:{width,height:width===390?844:900}});
  test('authenticated navigation opens original Workspace manager with real API data',async({page},info)=>{
    expect((await page.context().request.post(`${authBase}/auth/login`,{headers,data:{email,password}})).status()).toBe(200);
    await page.goto(`/?doc=ui201-account-${randomUUID()}`);await expect(page.getByTestId('current-user')).toHaveText('UI2 本机验收');
    if(width===390){await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'工作空间',exact:true}).click();}
    else await page.getByRole('button',{name:'工作空间',exact:true}).click();
    const dialog=page.getByRole('region',{name:'我的工作空间',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByText('正在加载工作空间…',{exact:true})).toHaveCount(0);expect((await page.context().request.get('/api/workspaces')).status()).toBe(200);
    await page.screenshot({path:info.outputPath(`${width}-workspace.png`)});await dialog.getByRole('button',{name:'返回 Nova 本地演示',exact:true}).click();
    if(width===390)await expect(page.locator('#main-content')).toBeFocused();
    const response=await page.context().request.post('/api/auth/logout',{headers,data:{}});expect(response.status()).toBe(204);await page.reload();await expect(page.getByTestId('current-user')).toHaveCount(0);expect((await page.context().request.get('/api/workspaces')).status()).toBe(401);
  });
});
for(const width of [1440,390])test.describe(`${width} Reduced Motion`,()=>{
  test.use({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
  test('reduced mode updates layout directly and keeps editing functional',async({page})=>{
    await open(page);const editor=page.locator('[contenteditable=true]').first();await editor.fill('减少动效模式下仍可正常输入。');
    if(width===1440){await startFrames(page);await page.getByRole('button',{name:'切换侧栏',exact:true}).click();const measured=await frames(page);expect(measured.some(f=>f.side>65&&f.side<247)).toBe(false);await expect(editor).toBeFocused();}
    else {const trigger=page.getByRole('button',{name:'打开导航',exact:true});await trigger.click();const sheet=page.locator('[data-slot=sheet-content]');expect(await sheet.evaluate(e=>getComputedStyle(e).animationName)).toBe('none');await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(trigger).toBeFocused();}
    expect(await editor.evaluate(e=>{let current:Element|null=e;while(current){if(getComputedStyle(current).transform!=='none')return false;current=current.parentElement;}return true;})).toBe(true);
    await editor.focus();await page.keyboard.press('End');await page.keyboard.insertText('继续编辑');await expect(editor).toContainText('继续编辑');
  });
});

for(const reducedMotion of ['no-preference','reduce'] as const)test.describe(`closeout ${reducedMotion}`,()=>{
  test.use({viewport:{width:901,height:844},reducedMotion});
  test('Sheet crossing 900/901 restores visible focus, closed state and desktop collapse',async({page})=>{
    await open(page);const editor=page.locator('[contenteditable=true]').first();await editor.fill('断点切换保留同一编辑器。');
    await editor.evaluate((el:any)=>{(window as any).closeoutEditor=el;(window as any).closeoutTiptap=el.editor;});
    const desktop=page.getByRole('button',{name:'切换侧栏',exact:true});await desktop.click();await expect(desktop).toHaveAttribute('aria-expanded','false');
    await page.setViewportSize({width:900,height:844});const mobile=page.getByRole('button',{name:'打开导航',exact:true});await mobile.click();const sheet=page.locator('[data-slot=sheet-content]');await expect(sheet).toBeVisible();
    await page.setViewportSize({width:901,height:844});await expect(sheet).toHaveCount(0);await expect(desktop).toBeFocused();await expect(desktop).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('body')).not.toHaveAttribute('data-scroll-locked');expect(await page.evaluate(()=>getComputedStyle(document.body).pointerEvents)).not.toBe('none');
    await page.setViewportSize({width:900,height:844});await expect(mobile).toBeFocused();await expect(mobile).toHaveAttribute('aria-expanded','false');
    await mobile.press('Enter');await expect(sheet).toBeVisible();await page.keyboard.press('Escape');await expect(sheet).toHaveCount(0);await expect(mobile).toBeFocused();
    // 关闭动画尚未结束就往返断点，不能恢复一个已关闭的 Sheet 或丢失焦点。
    await mobile.click();await expect(sheet).toBeVisible();await page.keyboard.press('Escape');await page.setViewportSize({width:901,height:844});await expect(sheet).toHaveCount(0);await expect(desktop).toBeFocused();
    await page.setViewportSize({width:900,height:844});await expect(mobile).toBeFocused();await expect(sheet).toHaveCount(0);
    expect(await editor.evaluate((el:any)=>el===(window as any).closeoutEditor&&el.editor===(window as any).closeoutTiptap)).toBe(true);await expect(editor).toContainText('断点切换保留同一编辑器。');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  });
  test('Chinese IME cancellation and navigation interruption release only shell motion guard',async({page})=>{
    await open(page);const editor=page.locator('[contenteditable=true]').first();await editor.fill('IME 基线');
    await editor.evaluate((el:any)=>{(window as any).imeEditor=el;(window as any).imeTiptap=el.editor;});
    const cdp=await page.context().newCDPSession(page);const frame=page.locator('.app-frame');
    try{
      await cdp.send('Input.imeSetComposition',{text:'取消候选',selectionStart:4,selectionEnd:4});await expect(frame).toHaveClass(/is-composing/);
      await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});await expect(frame).not.toHaveClass(/is-composing/);await expect(editor).not.toContainText('取消候选');
      await editor.focus();await page.keyboard.press('ControlOrMeta+End');await cdp.send('Input.imeSetComposition',{text:'中断候选',selectionStart:4,selectionEnd:4});await expect(frame).toHaveClass(/is-composing/);
      await page.getByRole('button',{name:'用户流程',exact:true}).click();await expect(page.getByRole('heading',{name:'用户流程 · 规划中'})).toBeVisible();await expect(frame).not.toHaveClass(/is-composing/);
      await page.getByRole('button',{name:'产品需求文档',exact:true}).click();
      await editor.focus();await page.keyboard.press('ControlOrMeta+End');await cdp.send('Input.imeSetComposition',{text:'移动候选',selectionStart:4,selectionEnd:4});await expect(frame).toHaveClass(/is-composing/);
      await page.setViewportSize({width:900,height:844});await expect(editor).toBeFocused();await page.getByRole('button',{name:'打开导航',exact:true}).click();await expect(page.locator('[data-slot=sheet-content]')).toBeVisible();await expect(frame).not.toHaveClass(/is-composing/);
      await page.keyboard.press('Escape');await expect(page.locator('[data-slot=sheet-content]')).toHaveCount(0);await editor.focus();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.insertText('后续输入');await expect(editor).toContainText('后续输入');
      expect(await editor.evaluate((el:any)=>el===(window as any).imeEditor&&el.editor===(window as any).imeTiptap)).toBe(true);
      await page.setViewportSize({width:901,height:844});expect(await page.locator('.sidebar').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe(reducedMotion==='reduce'?'0s':'0.24s');
    }finally{await cdp.detach();}
  });
});
for(const width of [390,375])test.describe(`closeout ${width} room display`,()=>{
  test.use({viewport:{width,height:844}});
  test('long room label truncates visually while full room and real synchronization stay intact',async({page,browser})=>{
    const documentId=`ui201-${randomUUID()}-${'long'.repeat(8)}`,room=`doc:${documentId}`;await page.goto(`/?doc=${documentId}`);await expect(page.locator('.editor-status')).toHaveAttribute('data-state','synced');
    const label=page.locator('.editor-room');await expect(label).toHaveText(room);await expect(label).toHaveAttribute('title',room);
    const display=await label.evaluate(e=>({text:e.textContent,clipped:e.scrollWidth>e.clientWidth,whiteSpace:getComputedStyle(e).whiteSpace,textOverflow:getComputedStyle(e).textOverflow}));expect(display).toEqual({text:room,clipped:true,whiteSpace:'nowrap',textOverflow:'ellipsis'});
    const other=await browser.newContext({viewport:{width,height:844}});try{const peer=await other.newPage();await peer.goto(`/?doc=${documentId}`);await expect(peer.locator('.editor-status')).toHaveAttribute('data-state','synced');await page.locator('[contenteditable=true]').first().fill('完整 room 仍在真实同步。');await expect(peer.locator('[contenteditable=true]').first()).toContainText('完整 room 仍在真实同步。');}finally{await other.close();}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
});
