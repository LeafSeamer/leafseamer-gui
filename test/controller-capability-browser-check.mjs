import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {translations} from '../src/i18n.ts';
// 独立监督器与模拟器提供实际业务响应；浏览器不拦截或替换HTTP。
const {chromium}=createRequire(import.meta.url)(path.resolve(process.argv[2])),input=JSON.parse(fs.readFileSync(path.resolve(process.argv[4]),'utf8'));
const origin=new URL(input.origin);assert.equal(origin.protocol,'https:');assert.equal(origin.hostname,'127.0.0.1');
const output=input.artifact_directory;assert.ok(output&&path.isAbsolute(output));fs.mkdirSync(output,{recursive:true});
const errors=[],requests=[],checks=[];let browser,page,allowUnavailable=false;
async function moduleState(operation){
 fs.writeFileSync(input.request,JSON.stringify({operation}));const end=performance.now()+10000;
 while(true){if(fs.existsSync(input.result)&&JSON.parse(fs.readFileSync(input.result,'utf8')).operation===operation)return;
  if(performance.now()>end)throw new Error('module_state_timeout');await delay(30);}
}
try{
 browser=await chromium.launch({executablePath:path.resolve(process.argv[3]),headless:true,args:['--ignore-certificate-errors-spki-list='+input.spki]});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()!=='error')return;const url=message.location().url;
  if(url.endsWith('/favicon.ico')&&message.text().includes('404'))return;if(allowUnavailable&&url.endsWith('/capabilities')&&message.text().includes('503'))return;errors.push(message.text());});
 page.on('request',request=>{const url=new URL(request.url());assert.equal(url.origin,input.origin);requests.push({method:request.method(),path:url.pathname});});
 await page.goto(input.origin);await page.getByLabel('用户名',{exact:true}).fill('role.test');await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
 const pane=page.getByRole('region',{name:'设备能力',exact:true}),count=()=>requests.filter(r=>r.path.endsWith('/capabilities')).length;
 await pane.getByRole('button',{name:'读取能力',exact:true}).waitFor();assert.equal(count(),0);
 async function read(expected){const pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/capabilities'));await pane.getByRole('button',{name:'读取能力',exact:true}).click();const r=await pending;assert.equal(r.status(),expected);return await r.json();}
 const first=await read(200);await page.locator('.device-row').getByText('就绪',{exact:true}).waitFor();assert.equal(first.data.devices[0].actions[0].footprint.complete,true);
 const action=pane.locator('summary').filter({hasText:/^leafseamer\.simulator\.value\.set$/});await action.waitFor();await action.focus();await page.keyboard.press('Enter');
 await pane.getByText(translations.zh.footprintComplete,{exact:true}).waitFor();assert.ok((await pane.locator('.capability-parameters').innerText()).includes('-2147483648'));
 await pane.locator('summary').filter({hasText:'参数约束 · 完整约束文档'}).click();await pane.locator('pre').filter({hasText:'2147483647'}).waitFor();
 await page.screenshot({path:path.join(output,'capabilities-desktop.png'),fullPage:true});checks.push('真实HTTPS能力与参数范围、键盘展开、固定模拟器完整作用范围及独立执行资格提示');
 await moduleState('disconnect');allowUnavailable=true;await read(503);await pane.getByText('尚未读取当前设备的有效能力。',{exact:true}).waitFor();assert.equal(await action.count(),0);await page.locator('.device-row').getByText('尚未读取',{exact:true}).waitFor();checks.push('实际断线返回503并清除旧能力');
 await moduleState('reconnect');const fresh=await read(200);await action.waitFor();assert.deepEqual(fresh.data,first.data);allowUnavailable=false;checks.push('新设备会话重连后显式重新读取');
 const before=count();await page.getByRole('button',{name:'刷新',exact:true}).click();await pane.getByText('尚未读取当前设备的有效能力。',{exact:true}).waitFor();assert.equal(count(),before);
 await read(200);await action.waitFor();checks.push('目录刷新不保留能力，也不自动重发');
 await page.getByRole('button',{name:'English',exact:true}).click();const englishPane=page.getByRole('region',{name:'Device capabilities',exact:true});await englishPane.waitFor();
 await page.getByRole('button',{name:translations.en.theme,exact:true}).click();await page.setViewportSize({width:390,height:844});
 await englishPane.locator('summary').filter({hasText:/^leafseamer\.simulator\.value\.set$/}).click();await englishPane.getByText(translations.en.footprintComplete,{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('.app').getAttribute('data-theme'),'dark');
 await page.screenshot({path:path.join(output,'capabilities-mobile.png'),fullPage:true});checks.push('英文深色窄屏无横向溢出');
 assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage)),[]);assert.equal(await page.evaluate(()=>document.cookie),'');
 await page.getByRole('button',{name:translations.en.logout,exact:true}).click();await page.getByRole('heading',{name:translations.en.loginTitle,exact:true}).waitFor();assert.equal(await page.locator('.capability-pane').count(),0);
 assert.ok(requests.filter(r=>r.path.endsWith('/capabilities')).every(r=>r.method==='GET'));assert.deepEqual(errors,[]);checks.push('读取仅GET、无凭据持久化、注销清除能力');
 fs.writeFileSync(path.join(output,'capability-checks.json'),JSON.stringify({checks,requests,errors,actual_controller:true,actual_simulator:true,synthetic_first_bootstrap:true},null,2));
 console.log(JSON.stringify({browser:'Edge',checks:checks.length,capability_responses:'real_controller',disconnected_status:503,reconnected_status:200}));
}catch(error){if(page){await page.screenshot({path:path.join(output,'capabilities-failure.png'),fullPage:true}).catch(()=>{});
 fs.writeFileSync(path.join(output,'capability-failure.json'),JSON.stringify({checks,errors,requests,message:error.message,text:await page.locator('body').innerText().catch(()=>''),stack:error.stack},null,2));}
 console.error(JSON.stringify({message:error.message,checks,errors,at:error.stack?.split('\n').slice(1,3)}));process.exitCode=1;
}finally{await browser?.close();}
