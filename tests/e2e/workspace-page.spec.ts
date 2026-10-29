import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
const apiRequire=createRequire(path.resolve('apps/api/package.json'));
const localRequire=createRequire(path.resolve('package.json'));
const run=`ui202-${randomUUID()}`,email=`${run}@example.invalid`,password='UI202 browser test password 42!';
const headers={Origin:'http://127.0.0.1:15173','X-Weavefield-Request':'1'};
let prisma:any,authApi:any,authBase:string,storage:string,collab:ChildProcess;
test.use({trace:'off',video:'on'});
async function startAuth(){apiRequire('reflect-metadata');process.env.WEB_ORIGIN=headers.Origin;authApi=await apiRequire('./dist/application').createApplication();await authApi.listen(0,'127.0.0.1');authBase=await authApi.getUrl();}
test.beforeAll(async({browser})=>{
  prisma=await localRequire('./tests/helpers/database.cjs').prepareDatabase();await startAuth();const c=await browser.newContext();
  try{expect((await c.request.post(`${authBase}/auth/register`,{headers,data:{email,password,displayName:'UI2 页面管理员'}})).status()).toBe(201);}finally{await c.close();}
  storage=await mkdtemp(path.join(tmpdir(),'weavefield-ui202-'));collab=spawn(process.execPath,['--import',path.resolve('apps/collab/node_modules/tsx/dist/loader.mjs'),path.resolve('apps/collab/src/index.ts')],{cwd:storage,env:{...process.env,NODE_ENV:'test',COLLAB_PORT:'11234',COLLAB_DEV_TOKEN:'m0-e2e-local-only-token'},stdio:'ignore'});
  await expect.poll(()=>fetch('http://127.0.0.1:11234').then(r=>r.ok).catch(()=>false)).toBe(true);
});
test.beforeEach(async()=>{await authApi.close();await startAuth();});
test.afterEach(async()=>{await prisma.workspace.deleteMany({where:{slug:{startsWith:run}}});});
test.afterAll(async()=>{try{if(collab?.exitCode===null){const done=once(collab,'exit');collab.kill();await done;}if(storage)await rm(storage,{recursive:true,force:true});if(prisma)await prisma.user.deleteMany({where:{email}});}finally{if(authApi)await authApi.close();if(prisma)await prisma.$disconnect();}});
async function login(context:BrowserContext){expect((await context.request.post(`${authBase}/auth/login`,{headers,data:{email,password}})).status()).toBe(200);}
async function space(context:BrowserContext,name='页面验收空间') {const r=await context.request.post('/api/workspaces',{headers,data:{name,slug:`${run}-${randomUUID().slice(0,8)}`}});expect(r.status()).toBe(201);return r.json();}
async function workspace(page:Page,width:number){if(width<=900){await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.locator('[data-slot=sheet-content]').getByRole('button',{name:'工作空间',exact:true}).click();await expect(page.locator('[data-slot=sheet-content]')).toHaveCount(0);await expect(page.locator('#main-content')).toBeFocused();}else await page.getByRole('button',{name:'工作空间',exact:true}).click();const region=page.getByRole('region',{name:'我的工作空间',exact:true});await expect(region).toBeVisible();return region;}

for(const width of [1440,390])test.describe(`${width} workspace login gate`,()=>{
  test.use({viewport:{width,height:900}});
  test('anonymous navigation exposes real login and refresh retains workspace URL',async({page})=>{
    await page.goto('/?view=workspace');await expect(page.getByRole('region',{name:'工作空间登录'})).toBeVisible();await expect(page.getByTestId('workspace-member')).toHaveCount(0);await expect(page.getByTestId('workspace-role')).toHaveCount(0);
    await page.getByRole('button',{name:'登录 / 注册真实账号',exact:true}).click();const auth=page.getByRole('dialog',{name:'登录你的账号'});await expect(auth).toBeVisible();await expect(auth.getByLabel('密码',{exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await login(page.context());await page.reload();await expect(page.getByRole('region',{name:'我的工作空间',exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('view')).toBe('workspace');
  });
});
for(const width of [1440,390])for(const reducedMotion of ['no-preference','reduce'] as const)test.describe(`${width} ${reducedMotion} workspace page`,()=>{
  test.use({viewport:{width,height:width===1440?900:844},reducedMotion});
  test('page navigation, IME forms, confirmations and history retain the real Nova editor',async({page},info)=>{
    await login(page.context());let sockets=0;page.on('websocket',()=>sockets++);await page.goto(`/?doc=ui202-retained-${randomUUID()}`);await expect(page.locator('.editor-status')).toHaveAttribute('data-state','synced');
    const editor=page.locator('[contenteditable=true]').first();await editor.fill('Nova 正文必须保留。');await editor.evaluate((e:any)=>{(window as any).novaNode=e;(window as any).novaEditor=e.editor;});const initialSockets=sockets;
    const item=await space(page.context());const region=await workspace(page,width);await expect(region.getByRole('heading',{name:item.name,exact:true})).toBeVisible();await expect(editor).not.toBeVisible();
    await expect(region.getByRole('tab',{name:'文档',exact:true})).toHaveAttribute('aria-selected','true');await region.getByRole('tab',{name:'文档',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(region.getByRole('tab',{name:'成员',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(region.getByTestId('workspace-member')).toHaveCount(1);await region.getByRole('tab',{name:'文档',exact:true}).click();
    const docs=region.getByRole('region',{name:'空间文档',exact:true}),create=docs.getByRole('button',{name:'新建文档',exact:true});await create.click();const dialog=page.getByRole('dialog',{name:'创建文档',exact:true});await expect(dialog).toBeVisible();
    if(reducedMotion==='reduce')expect(await dialog.evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
    for(let i=0;i<6;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>Boolean(document.activeElement?.closest('[data-slot=dialog-content]')))).toBe(true);}
    await dialog.getByLabel('新文档标题',{exact:true}).focus();const cdp=await page.context().newCDPSession(page);try{await cdp.send('Input.imeSetComposition',{text:'中文候选',selectionStart:4,selectionEnd:4});await expect(page.locator('.app-frame')).toHaveClass(/is-composing/);await cdp.send('Input.insertText',{text:'中文标题'});await expect(dialog.getByLabel('新文档标题',{exact:true})).toHaveValue('中文标题');}finally{await cdp.detach();}
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(create).toBeFocused();await expect(page.locator('.app-frame')).not.toHaveClass(/is-composing/);
    expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(0);
    await create.click();await dialog.getByLabel('新文档标题',{exact:true}).fill('正式元数据文档');await dialog.getByRole('button',{name:'创建文档',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(create).toBeFocused();
    const detail=docs.getByRole('region',{name:'文档元数据',exact:true});await expect(detail.getByRole('heading')).toHaveText('正式元数据文档');await expect(detail.locator('[contenteditable]')).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`${width}-${reducedMotion}-detail.png`)});
    await detail.getByRole('button',{name:'归档文档',exact:true}).click();const confirmation=page.getByRole('dialog',{name:'确认归档文档',exact:true});await expect(confirmation).toBeVisible();await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(1);
    await detail.getByRole('button',{name:'归档文档',exact:true}).click();await confirmation.getByRole('button',{name:'确认归档文档',exact:true}).click();await expect(docs).toContainText('文档已归档');await expect(docs.getByRole('list')).toBeEmpty();
    await region.getByRole('button',{name:'返回 Nova 本地演示',exact:true}).click();await expect(editor).toBeVisible();await expect(editor).toContainText('Nova 正文必须保留。');expect(await editor.evaluate((e:any)=>e===(window as any).novaNode&&e.editor===(window as any).novaEditor)).toBe(true);expect(sockets).toBe(initialSockets);
    await page.goBack();await expect(region).toBeVisible();await expect(region.getByRole('heading',{name:item.name,exact:true})).toBeVisible();await page.goForward();await expect(editor).toBeVisible();expect(await editor.evaluate((e:any)=>e.editor===(window as any).novaEditor)).toBe(true);
    const keys=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('weavefield.workspace.')).map(k=>localStorage.getItem(k)));expect(keys).toEqual([item.id]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
});
test('last OWNER refusal stays visible in confirmation without removing membership',async({page})=>{
  await login(page.context());await page.goto('/?view=workspace');const item=await space(page.context());await page.getByRole('button',{name:'刷新工作空间',exact:true}).click();const region=page.getByRole('region',{name:'我的工作空间',exact:true});await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');await region.getByRole('tab',{name:'成员',exact:true}).click();
  await region.getByRole('button',{name:'移除UI2 页面管理员',exact:true}).click();const dialog=page.getByRole('dialog',{name:'确认移除成员',exact:true});const response=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/members/'));await dialog.getByRole('button',{name:'确认移除成员',exact:true}).click();expect((await response).status()).toBe(409);await expect(dialog.getByRole('alert')).toContainText('至少保留一个 OWNER');await expect(dialog.getByRole('button',{name:'确认移除成员',exact:true})).toBeEnabled();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(region.getByTestId('workspace-role')).toHaveText('OWNER');expect((await (await page.context().request.get(`/api/workspaces/${item.id}/members`)).json()).length).toBe(1);
});
test('committed document write followed by failed refresh never encourages duplicate submission',async({page})=>{
  await login(page.context());await page.goto('/');const item=await space(page.context());const region=await workspace(page,1280);const docs=region.getByRole('region',{name:'空间文档',exact:true});await expect(docs.getByText('正在加载文档…',{exact:true})).toHaveCount(0);let fail=false;
  await page.route(`**/api/workspaces/${item.id}/documents`,async route=>{if(route.request().method()==='GET'&&fail){fail=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'验收故障：列表刷新不可用'})});}else await route.continue();});
  await docs.getByRole('button',{name:'新建文档',exact:true}).click();const dialog=page.getByRole('dialog',{name:'创建文档',exact:true});await dialog.getByLabel('新文档标题',{exact:true}).fill('服务端已保存的元数据');fail=true;await dialog.getByRole('button',{name:'创建文档',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('验收故障：列表刷新不可用');await expect(dialog.getByRole('button',{name:'创建文档',exact:true})).toBeDisabled();await expect(dialog.getByRole('status')).toContainText('服务端已完成创建');expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(1);
  await dialog.getByRole('button',{name:'返回列表并刷新',exact:true}).click();await expect(docs.getByRole('button',{name:'服务端已保存的元数据',exact:true})).toBeVisible();
  await docs.getByRole('button',{name:'服务端已保存的元数据',exact:true}).click();await docs.getByRole('button',{name:'归档文档',exact:true}).click();fail=true;const archive=page.getByRole('dialog',{name:'确认归档文档',exact:true});await archive.getByRole('button',{name:'确认归档文档',exact:true}).click();await expect(archive).toHaveCount(0);await expect(docs.getByRole('alert')).toHaveText('验收故障：列表刷新不可用');await expect(docs.getByRole('button',{name:'服务端已保存的元数据',exact:true})).toHaveCount(0);expect((await (await page.context().request.get(`/api/workspaces/${item.id}/documents`)).json()).length).toBe(0);
});
