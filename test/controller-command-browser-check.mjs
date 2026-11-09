import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';

// 由Suite实际进程用例提供服务及命令原件；不拦截请求，不提供合成HTTP成功响应。
if(process.argv.length!==5)throw new Error('browser_check_arguments');
const {chromium}=createRequire(import.meta.url)(path.resolve(process.argv[2]));
const input=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]),'utf8'));
const origin=new URL(input.origin);assert.equal(origin.protocol,'https:');assert.equal(origin.hostname,'127.0.0.1');assert.equal(input.records.length,2);
const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'logs/gui-execution');fs.mkdirSync(output,{recursive:true});
const errors=[],expectedErrors=[],requests=[],checks=[];let browser,page,expectDenial=false;
try{
  browser=await chromium.launch({executablePath:path.resolve(process.argv[3]),headless:true,args:['--ignore-certificate-errors-spki-list='+input.spki]});
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()!=='error')return;
    const location=message.location().url,text=message.text();
    if(expectDenial&&location.startsWith(input.origin+'/auth/service-tokens')&&/status of (401|403)/.test(text))expectedErrors.push(text);
    else if(location===input.origin+'/favicon.ico'&&text.includes('404'))expectedErrors.push(text);
    else errors.push(text);
  });
  page.on('request',request=>{const url=new URL(request.url());assert.equal(url.origin,input.origin);requests.push({method:request.method(),path:url.pathname,query:Object.fromEntries(url.searchParams)});});
  assert.equal((await page.goto(input.origin)).status(),200);await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();assert.equal(await page.title(),'LeafSeamer');
  await page.getByLabel('用户名',{exact:true}).fill('role.test');await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
  await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
  await page.getByRole('button',{name:'命令记录',exact:true}).click();
  for(const record of input.records){
    const route='/api/v1/commands/'+record.command_id;
    await page.getByLabel('命令标识',{exact:true}).fill(record.command_id);
    const waiting=page.waitForResponse(response=>new URL(response.url()).pathname===route&&response.request().method()==='GET');
    await page.getByRole('button',{name:'查询',exact:true}).click();const response=await waiting;assert.equal(response.status(),200);
    assert.deepEqual((await response.json()).record,record);
    await page.getByText('成功',{exact:true}).waitFor();await page.getByRole('definition').filter({hasText:/^设备效果已验证$/}).waitFor();
    await page.getByText('无可信参考时间',{exact:true}).waitFor();await page.getByText('无占用',{exact:true}).waitFor();
    assert.equal(await page.locator('.fact').filter({has:page.getByText('修订',{exact:true})}).locator('dd').innerText(),'5');
    const waitingEvidence=page.waitForResponse(response=>new URL(response.url()).pathname===route+'/evidence');
    await page.getByRole('button',{name:'读取证据',exact:true}).click();const evidenceResponse=await waitingEvidence;assert.equal(evidenceResponse.status(),200);
    const evidence=await evidenceResponse.json(),query=new URL(evidenceResponse.url()).searchParams;
    assert.equal(query.get('state_revision'),record.state.revision);assert.deepEqual(evidence.snapshot_ref,record.evidence_index.snapshot_ref);
    assert.deepEqual(evidence.state_ref,record.state_ref);assert.deepEqual(evidence.scope,record.scope);assert.equal(evidence.command_id,record.command_id);
    assert.equal(evidence.total,'2');assert.equal(evidence.next_cursor,null);assert.deepEqual(evidence.items.map(item=>item.kind).sort(),['decision','release']);
    const references=[...record.state.completion_evidence_refs,...record.state.resource_evidence_refs];
    for(const item of evidence.items)assert.ok(references.some(ref=>ref.id===item.source_ref.id&&ref.revision===item.source_ref.revision&&ref.digest===item.source_ref.digest));
    await page.getByText('证据范围 1–2 / 2',{exact:true}).waitFor();assert.equal(await page.locator('summary').count(),2);
    checks.push({command_id:record.command_id,revision:record.state.revision,record_digest:record.record_digest,evidence_digest:evidence.page_digest});
  }
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('definition').filter({hasText:/^Device effect verified$/}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch theme',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('vite-error-overlay').count(),0);
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  fs.writeFileSync(input.revoke_request,'revoke');const deadline=Date.now()+10000;
  while(!fs.existsSync(input.revoke_result)){assert.ok(Date.now()<deadline,'permission_revocation_timeout');await delay(50);}
  assert.equal(JSON.parse(fs.readFileSync(input.revoke_result,'utf8')).state,'revoked');
  expectDenial=true;const denial=page.waitForResponse(response=>new URL(response.url()).pathname==='/auth/service-tokens');
  await page.getByRole('button',{name:'Read evidence',exact:true}).click();const rejected=await denial;assert.ok([401,403].includes(rejected.status()));
  if(rejected.status()===401)await page.getByRole('heading',{name:'Sign in to your workspace',exact:true}).waitFor();
  else await page.getByRole('alert').filter({hasText:'Your account does not have permission'}).waitFor();
  assert.equal(await page.locator('summary').count(),0);assert.deepEqual(errors,[]);
  const commandRequests=requests.filter(request=>request.path.startsWith('/api/v1/commands/'));assert(commandRequests.every(request=>request.method==='GET'));
  const result={command_responses:'real_controller',commands:checks.length,revoked:true,errors,expectedErrors,checks,requests,real_device:false};
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({command_responses:result.command_responses,commands:result.commands,revoked:true}));
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack),errors,url:page?.url(),html:await page?.content().catch(()=>null)},null,2));
  await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;
}finally{await browser?.close();}
