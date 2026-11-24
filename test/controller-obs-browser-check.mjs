import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';

const {chromium}=createRequire(import.meta.url)(path.resolve(process.argv[2]));
const input=JSON.parse(await fs.readFile(process.argv[4],'utf8'));
const origin=new URL(input.origin),output=input.artifact_directory;
assert.equal(origin.protocol,'https:');assert.equal(origin.hostname,'127.0.0.1');assert.ok(path.isAbsolute(output));
await fs.mkdir(output,{recursive:true});
async function waitMarker(file,ms=25000){
  const until=performance.now()+ms;
  do{
    try{await fs.access(file);return;}catch(error){if(error.code!=='ENOENT')throw error;}
    await delay(20);
  }while(performance.now()<until);
  throw new Error('OBS browser marker timeout: '+path.basename(file));
}
async function marker(file,body='ready'){
  const temporary=file+'.tmp';await fs.writeFile(temporary,body);await fs.rename(temporary,file);
}
const errors=[],commands=[];let browser,page,expectUnavailable=false;
async function login(){
  await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
  await page.getByLabel('用户名',{exact:true}).fill('role.test');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
  await page.getByRole('button',{name:'登录',exact:true}).click();
}
async function rejectLostRequest(pane,send){
  let original;
  await page.route(url=>url.pathname==='/api/v1/commands',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    original=route.request().postDataJSON();await route.abort('failed');
  },{times:1});
  await send.click();await login();
  const reply=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/commands/lookup');
  await pane.getByRole('button',{name:'查询切换结果',exact:true}).click();
  assert.deepEqual(await ((await reply).json()),{state:'not_found',adjudication:null});
  await pane.getByRole('button',{name:'阻止原请求受理',exact:true}).click();
  await pane.getByRole('button',{name:'保留原请求',exact:true}).click();
  assert.equal(await pane.getByRole('button',{name:'确认阻止受理',exact:true}).count(),0);
  await pane.getByRole('button',{name:'阻止原请求受理',exact:true}).click();
  const refusal=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/commands/reject');
  await pane.getByRole('button',{name:'确认阻止受理',exact:true}).click();
  const response=await refusal;assert.equal(response.status(),200);
  const body=await response.json(),{context_id,idempotency_key,correlation_id,...content}=original,posted=response.request().postDataJSON();
  assert.deepEqual(posted.content,content);assert.equal(posted.identity.key.idempotency_key,idempotency_key);
  assert.equal(body.decision,'rejected');assert.equal(body.command_ref,null);assert.deepEqual(body.identity,posted.identity);
  await pane.getByRole('status').filter({hasText:'原请求已被拒绝。'}).waitFor();
  await marker(input.submitted,JSON.stringify({body:original,response:{status:200,body}}));
  await waitMarker(input.settled);
  await pane.screenshot({path:path.join(output,'obs-admission-rejected.png'),timeout:10000});
  await pane.getByRole('button',{name:'关闭已结束的切换记录',exact:true}).click();
  await pane.getByText('原请求已被拒绝。',{exact:true}).waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('leafseamer.obs-command.v1:'))),[]);
}
try{
  browser=await chromium.launch({executablePath:path.resolve(process.argv[3]),headless:true,args:['--ignore-certificate-errors-spki-list='+input.spki]});
  page=await (await browser.newContext({viewport:{width:1440,height:950},locale:'zh-CN'})).newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',event=>{
    if(!['error','warning'].includes(event.type()))return;
    const url=event.location().url, message=event.text();
    if(url.endsWith('/favicon.ico')&&message.includes('404'))return;
    if(expectUnavailable&&url.endsWith('/capabilities')&&message.includes('503'))return;
    if(input.recovery&&url.endsWith('/api/v1/commands')&&message.includes('ERR_FAILED'))return;
    errors.push(message);
  });
  page.on('request',request=>{
    const url=new URL(request.url());assert.equal(url.origin,origin.origin);
    if(url.pathname==='/api/v1/commands'&&request.method()==='POST')commands.push(request);
  });
  assert.equal((await page.goto(origin.href)).status(),200);assert.equal(await page.title(),'LeafSeamer');
  await login();
  const pane=page.getByRole('region',{name:'OBS 场景',exact:true});await pane.waitFor();
  assert.equal(await page.getByText('服务尚未就绪', {exact:false}).count(),0);
  const read=pane.getByRole('button',{name:'读取场景状态',exact:true}),select=pane.getByLabel('目标场景',{exact:true}),send=pane.getByRole('button',{name:'切换节目场景',exact:true});
  const readStatus=async()=>{const wait=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/scene-catalog'));await read.click();return wait;};
  assert.equal((await readStatus()).status(),200);
  await pane.getByText('切换需要当前人员持有手动控制权，且设备处于就绪状态。',{exact:true}).waitFor();
  assert.equal(await select.isDisabled(),true);assert.equal(await send.isDisabled(),true);assert.equal(commands.length,0);
  await marker(input.ready);
  await waitMarker(input.opened);
  assert.equal((await readStatus()).status(),200);
  await select.selectOption({label:input.scene});
  if(input.recovery)await rejectLostRequest(pane,send);
  else{
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/commands'&&response.request().method()==='POST');
  await send.click();const response=await responsePromise;
  assert.equal(response.status(),202);
  const body=response.request().postDataJSON(),admission=await response.json();
  assert.equal(body.action_id,'obs.program_scene.set');assert.equal(body.origin,'manual');assert.equal(body.parameters.scene_ref.scene_id,input.scene_id);
  assert.equal(admission.decision,'accepted');assert.equal(commands.length,1);
  await marker(input.submitted,JSON.stringify({body,response:{status:response.status(),body:admission}}));
  await waitMarker(input.settled);
  const commandPath='/api/v1/commands/'+admission.command_ref.object_id;
  const readCommand=page.waitForResponse(result=>new URL(result.url()).pathname===commandPath);
  await pane.getByRole('button',{name:'查询切换结果',exact:true}).click();const status=await readCommand;assert.equal(status.status(),200);
  const record=(await status.json()).record;
  assert.equal(record.state.outcome,'succeeded');assert.equal(record.state.resource_status,'clear');
  await pane.getByText('已结束 · 成功 · 无占用',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>Object.entries(sessionStorage).filter(([key])=>key.startsWith('leafseamer.obs-command.v1:')).map(([,value])=>JSON.parse(value)));
  assert.equal(saved.length,1);assert.deepEqual(Object.keys(saved[0]).sort(),['device_id','identity','rejection']);assert.equal(saved[0].identity.request_digest,admission.identity.request_digest);
  await pane.screenshot({path:path.join(output,'obs-cut-result.png'),timeout:10000});
  await pane.getByRole('button',{name:'关闭已结束的切换记录',exact:true}).click();
  assert.equal((await readStatus()).status(),200);
  await select.waitFor();assert.equal(await send.isDisabled(),true);assert.equal(commands.length,1);
  }
  await marker(input.checked);
  if(!input.recovery){
    await waitMarker(input.disconnected);
    expectUnavailable=true;
    const unavailable=page.waitForResponse(result=>new URL(result.url()).pathname.endsWith('/capabilities'));
    await read.click();assert.equal((await unavailable).status(),503);
    await pane.getByText('读取当前 OBS 场景目录和控制状态。',{exact:true}).waitFor();assert.equal(await select.count(),0);
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  await page.screenshot({path:path.join(output,input.recovery?'obs-recovery-mobile.png':'obs-disconnected-mobile.png'),fullPage:true,timeout:10000});
  assert.deepEqual(errors,[]);assert.equal(commands.length,1);
  const result=input.recovery?{commands:0,rejected:true}:{commands:1,disconnected:503};
  console.log(JSON.stringify({browser:'Edge',command_responses:'real_controller',...result,protected:true}));
}catch(error){
  await page?.screenshot({path:path.join(output,'obs-browser-failure.png'),fullPage:true,timeout:5000}).catch(()=>{});
  console.error(JSON.stringify({error:String(error.stack),errors,text:await page?.locator('body').innerText({timeout:3000}).catch(()=>null)}));
  process.exitCode=1;
}finally{await browser?.close();}
