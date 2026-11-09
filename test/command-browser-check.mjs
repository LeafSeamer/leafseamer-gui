import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {contractSelection as selection} from '@leafseamer/sdk';
import {startGuiFixture} from '../../leafseamer-controller/test/gui-browser-fixture.mjs';
import {commandRecord} from './command-view-fixture.mjs';

// 实际浏览器、HTTPS、人员认证及token；命令和证据响应为显式合成路由。
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.length!==4)throw new Error('browser_check_arguments');
const {chromium}=createRequire(import.meta.url)(path.resolve(process.argv[2]));
const output=path.join(root,'logs/gui-command');fs.mkdirSync(output,{recursive:true});
const fixture=await startGuiFixture(root,{commandPermissions:true});let browser,page;
const errors=[],expectedErrors=[],checks=[],requests=[];let expectedStatus=null;
try {
  browser=await chromium.launch({executablePath:path.resolve(process.argv[3]),headless:true,args:['--ignore-certificate-errors-spki-list='+fixture.spki]});
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'zh-CN'});page=await context.newPage();
  page.on('requestfailed',request=>errors.push(request.url()+': '+request.failure()?.errorText));
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{
    if(m.type()!=='error')return;
    if(expectedStatus && m.text().includes('status of '+expectedStatus) && m.location().url.startsWith(fixture.origin+'/api/v1/commands/')) expectedErrors.push(m.text());
    else errors.push(m.text());
  });
  const scope={authority_service_id:fixture.identity.service_id,database_instance_id:fixture.identity.database_instance_id};
  const record=commandRecord(scope);record.evidence_index.total='2';
  const headers={'Content-Type':'application/json','X-LeafSeamer-Contract':selection.contract_id,'X-LeafSeamer-Contract-Digest':selection.contract_digest,'Cache-Control':'no-store'};
  let denyEvidence=false;
  await page.route('**/api/v1/commands/**',async route=>{
    const url=new URL(route.request().url());requests.push({method:route.request().method(),path:url.pathname,query:Object.fromEntries(url.searchParams)});
    if(!url.pathname.startsWith('/api/v1/commands/'+record.command_id)){await route.continue();return;}
    if(url.pathname.endsWith('/evidence')){
      if(denyEvidence){await route.fulfill({status:503,body:''});return;}
      const index=url.searchParams.has('cursor')?1:0,source_ref={id:'synthetic-evidence-'+index,revision:'1',digest:'sha256:'+'b'.repeat(64)};
      const item={scope,command_id:record.command_id,source_ref,kind:'invalidation',view_digest:source_ref.digest,
        body:{invalidation_id:source_ref.id,scope,command_id:record.command_id,subject_ref:record.state_ref,reason_code:'synthetic_invalidation',protection_ref:source_ref}};
      await route.fulfill({status:200,headers,body:JSON.stringify({scope,command_id:record.command_id,...record.evidence_index,offset:String(index),items:[item],next_cursor:index===0?'synthetic_next_page':null,page_digest:source_ref.digest})});
    } else await route.fulfill({status:200,headers,body:JSON.stringify({view:'current',record})});
  });
  const navigation=await page.goto(fixture.origin);assert.equal(navigation.status(),200);
  await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
  fs.writeFileSync(path.join(output,'navigation.json'),JSON.stringify({url:page.url(),headers:await navigation.allHeaders(),html:await page.content()},null,2));
  assert.equal(await page.title(),'LeafSeamer');assert.equal(new URL(page.url()).origin,fixture.origin);
  await page.getByLabel('用户名',{exact:true}).fill(fixture.login.login);await page.getByLabel('密码',{exact:true}).fill(fixture.login.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByText('保护中',{exact:true}).waitFor();
  await page.getByRole('button',{name:'命令记录',exact:true}).click();await page.getByRole('heading',{name:'命令记录',exact:true}).waitFor();
  expectedStatus=404;
  await page.getByLabel('命令标识',{exact:true}).fill('missing-command');await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'未找到该记录。'}).waitFor();expectedStatus=null;
  assert.equal(await page.getByRole('heading',{name:'命令详情',exact:true}).count(),0);checks.push('真实HTTPS命令查询返回404，不展示旧详情');
  await page.getByLabel('命令标识',{exact:true}).fill(record.command_id);await page.getByRole('button',{name:'查询',exact:true}).click();
  await page.getByText('无可信参考时间',{exact:true}).waitFor();await page.getByText('排队中',{exact:true}).waitFor();checks.push('实际认证后SDK校验合成命令；null时间与排队状态如实展示');
  await page.getByRole('button',{name:'读取证据',exact:true}).click();await page.getByText('证据范围 1–1 / 2',{exact:true}).waitFor();
  await page.locator('summary').click();await page.getByText('synthetic_invalidation',{exact:false}).waitFor();
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'下一页证据',exact:true}).click();await page.getByText('证据范围 2–2 / 2',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'下一页证据',exact:true}).count(),0);
  assert(requests.filter(r=>r.path.endsWith('/evidence')).every(r=>r.query.state_revision==='1'));checks.push('证据明细与固定修订逐页读取');
  await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('heading',{name:'Command records',exact:true}).waitFor();
  await page.getByText('No trusted reference time',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Switch theme',exact:true}).click();
  assert.equal(await page.locator('.app').getAttribute('data-theme'),'dark');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});checks.push('英文、深色和390像素窄屏无横向溢出');
  assert.deepEqual(errors,[]);assert.equal(await page.locator('vite-error-overlay').count(),0);
  expectedStatus=503;denyEvidence=true;await page.getByRole('button',{name:'Read evidence',exact:true}).click();await page.getByRole('heading',{name:'Sign in to your workspace',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Command details',exact:true}).count(),0);checks.push('无效证据响应清理会话和旧命令视图');
  assert(requests.every(r=>r.method==='GET'));
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({origin:fixture.origin,checks,requests,errors,expectedErrors,command_responses:'synthetic_success_and_real_not_found',authentication:'real_https_sqlite',real_device:false},null,2)+'\n');
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,command_responses:'synthetic'}));
} catch(error) {
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack),url:page?.url(),errors,html:await page?.content().catch(()=>null)},null,2));
  await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;
} finally {await browser?.close();await fixture.close();}
