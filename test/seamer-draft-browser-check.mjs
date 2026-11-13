import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(const name of ['playwright','browser','output'])assert.ok(path.isAbsolute(config[name]));
const {chromium}=createRequire(import.meta.url)(config.playwright);
fs.mkdirSync(config.output,{recursive:true});
const browser=await chromium.launch({executablePath:config.browser,headless:true,args:['--ignore-certificate-errors-spki-list='+config.spkis.join(',')]});
const checks=[],errors=[],consoleErrors=[],requests=[],responses=[];let deliberateLoss=false,deliberateRejection=false,page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(['error','warning'].includes(message.type()))consoleErrors.push({text:message.text(),url:message.location().url,intentionalLoss:deliberateLoss,intentionalRejection:deliberateRejection});});
 page.on('request',request=>requests.push({method:request.method(),url:request.url()}));
 page.on('response',response=>responses.push({method:response.request().method(),path:new URL(response.url()).pathname,status:response.status()}));
 const landing=await page.goto(config.origin);assert.equal(landing.status(),200);assert.equal(new URL(page.url()).origin,config.origin);assert.ok((await page.title()).includes('LeafSeamer'));
 await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();assert.equal(await page.locator('vite-error-overlay').count(),0);checks.push('页面身份、非空及无框架错误层');
 assert.ok(landing.headers()['content-security-policy'].includes("connect-src 'self' "+config.seamerOrigin));
 async function login(){await page.getByLabel('用户名',{exact:true}).fill('role.test');await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();await page.getByRole('button',{name:'自动化',exact:true}).click();await page.getByRole('heading',{name:'自动化草稿',exact:true}).waitFor();}
 await login();checks.push('真实Controller登录与固定Seamer入口');
 async function create(name){await page.getByLabel('名称',{exact:true}).fill(name);await page.getByLabel('描述',{exact:true}).fill('浏览器合成草稿');await page.getByLabel('定义内容文档',{exact:true}).fill(JSON.stringify(config.content,null,2));await page.getByRole('button',{name:'创建草稿',exact:true}).click();}
 await create('浏览器草稿');await page.getByRole('heading',{name:'草稿信息',exact:true}).waitFor();
 await page.getByLabel('名称',{exact:true}).fill('浏览器改名');await page.getByRole('button',{name:'保存名称与描述',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.fact')].some(e=>e.textContent==='信息修订2'));
 const edited=structuredClone(config.content);edited.program.groups[0].steps[0].guard={kind:'literal',value:false};
 await page.getByLabel('定义内容文档',{exact:true}).fill(JSON.stringify(edited,null,2));await page.getByRole('button',{name:'保存定义内容',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.fact')].some(e=>e.textContent==='内容修订2'));assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'浏览器改名');
 checks.push('真实草稿创建、元数据独立修订及内容CAS更新');
 const publishedUrl=()=>requests.filter(r=>r.method==='POST'&&/\/publish$/.test(r.url)).length;
 const beforePrepare=requests.length;await page.getByRole('button',{name:'准备发布',exact:true}).click();await page.getByRole('button',{name:'取消准备',exact:true}).click();assert.equal(requests.length,beforePrepare);
 await page.getByLabel('名称',{exact:true}).fill('未保存');assert.equal(await page.getByRole('button',{name:'准备发布',exact:true}).isDisabled(),true);await page.getByLabel('名称',{exact:true}).fill('浏览器改名');
 async function publish(){await page.getByRole('button',{name:'准备发布',exact:true}).click();await page.getByRole('button',{name:'确认发布',exact:true}).click();}
 await publish();await page.getByText('发布结果已确认。该版本尚未因此布防或开始运行。',{exact:true}).waitFor();assert.equal(publishedUrl(),1);
 await page.getByRole('button',{name:'读取发布版本',exact:true}).click();await page.locator('#publication-proof').waitFor();
 const proofId=await page.locator('#publication-proof option').nth(1).getAttribute('value');await page.locator('#publication-proof').selectOption(proofId);await page.locator('.publication-history').getByRole('button',{name:'查询',exact:true}).click();await page.getByText('独立',{exact:true}).waitFor();
 await page.locator('#publication-proof').selectOption('');assert.equal(await page.getByText('独立',{exact:true}).count(),0);await page.locator('#publication-proof').selectOption(proofId);
 checks.push('发布准备与取消无请求、未保存修改禁止确认、真实发布及固定版本证明读取');
 await page.screenshot({path:path.join(config.output,'publication-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'Switch theme',exact:true}).click();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(config.output,'publication-mobile.png'),fullPage:true});
 await page.getByRole('button',{name:'简体中文',exact:true}).click();await page.getByRole('button',{name:'切换主题',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
 checks.push('已发布版本与证明在390像素英文深色布局中无横向溢出');
 let committedPublication=null;
 await page.route(config.seamerOrigin+'/api/v1/definitions/*/publish',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const response=await route.fetch();assert.equal(response.status(),201);committedPublication=await response.json();deliberateLoss=true;await route.abort('failed');});
 await publish();await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();assert.ok(committedPublication);
 await page.unroute(config.seamerOrigin+'/api/v1/definitions/*/publish');await page.reload();await login();const publicationWrites=publishedUrl();
 await page.getByRole('button',{name:'查询原请求',exact:true}).click();await page.getByText('发布结果已确认。该版本尚未因此布防或开始运行。',{exact:true}).waitFor();assert.equal(publishedUrl(),publicationWrites);assert.equal(await page.locator('#publication-version').inputValue(),committedPublication.definition_version);
 await page.getByRole('button',{name:'读取发布版本',exact:true}).click();await page.locator('#publication-proof').waitFor();
 checks.push('真实发布提交后丢失响应，重载登录仅查原恢复固定版本，没有重复发布');
 deliberateLoss=false;
 await page.screenshot({path:path.join(config.output,'draft-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'新建草稿',exact:true}).click();let committed=null,routeError=null;
 await page.route(config.seamerOrigin+'/api/v1/definitions',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  try{const response=await route.fetch();assert.equal(response.status(),201);committed=await response.json();deliberateLoss=true;await route.abort('failed');}
  catch(error){routeError=error.code??'route_fetch';await route.abort('failed');}
 });
 await create('响应丢失的草稿');await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();assert.equal(routeError,null);assert.ok(committed);
 await page.unroute(config.seamerOrigin+'/api/v1/definitions');await page.reload();await login();
 await page.getByRole('button',{name:'查询原请求',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'创建草稿',exact:true}).isDisabled(),true);
 const pending=await page.evaluate(()=>Object.entries(sessionStorage));assert.equal(pending.length,1);assert.equal(pending[0][1].includes('policy_ref'),false);assert.equal(pending[0][1].includes('access_token'),false);
 const writes=()=>requests.filter(r=>r.method==='POST'&&r.url===config.seamerOrigin+'/api/v1/definitions').length,count=writes();
 await page.getByRole('button',{name:'查询原请求',exact:true}).click();await page.getByRole('button',{name:'读取当前草稿',exact:true}).waitFor();assert.equal(writes(),count);
 assert.equal(await page.getByLabel('名称',{exact:true}).inputValue(),'响应丢失的草稿');assert.equal(await page.getByRole('button',{name:'保存定义内容',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'读取当前草稿',exact:true}).click();await page.getByText(committed.definition_id,{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('#draft-name')?.disabled===false);
 assert.equal(await page.getByText(committed.definition_id,{exact:true}).count(),1);checks.push('已提交响应丢失后重载登录，只读查原恢复且无重复创建');
 deliberateLoss=false;await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('heading',{name:'Automation drafts',exact:true}).waitFor();
 await page.getByRole('button',{name:'Switch theme',exact:true}).click();await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('.app').getAttribute('data-theme'),'dark');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(config.output,'draft-mobile.png'),fullPage:true});checks.push('英文深色窄屏、无横向溢出');
 const storage=await page.evaluate(()=>({cookie:document.cookie,session:Object.keys(sessionStorage)}));assert.equal(storage.cookie,'');assert.deepEqual(storage.session,[]);
 await page.getByRole('button',{name:'简体中文',exact:true}).click();await page.getByRole('button',{name:'新建草稿',exact:true}).click();
 const validContent=config.content;config.content=structuredClone(validContent);config.content.selections[0].content_ref.digest='sha256:'+'0'.repeat(64);
 await create('来源不匹配');await page.getByRole('heading',{name:'草稿信息',exact:true}).waitFor();config.content=validContent;
 deliberateRejection=true;const rejected=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/publish'));
 await publish();assert.equal((await rejected).status(),503);await page.getByRole('button',{name:'查询原请求',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'准备发布',exact:true}).isDisabled(),true);assert.equal(await page.getByText('发布结果已确认。该版本尚未因此布防或开始运行。',{exact:true}).count(),0);
 checks.push('真实服务拒绝与批准原件不匹配的绑定；界面保留查原身份且不声称成功');
 const bad=consoleErrors.filter(e=>!e.url.endsWith('/favicon.ico')&&!(e.intentionalRejection&&e.url.startsWith(config.seamerOrigin+'/api/v1/definitions/')&&e.url.endsWith('/publish')&&/503/.test(e.text))&&!(e.intentionalLoss&&(e.url===config.seamerOrigin+'/api/v1/definitions'||e.url.startsWith(config.seamerOrigin+'/api/v1/definitions/')&&e.url.endsWith('/publish'))&&/ERR_FAILED|Failed to fetch/.test(e.text)));assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);checks.push('无意外页面或控制台错误，Cookie不可读，查原记录清理');
 fs.writeFileSync(path.join(config.output,'checks.json'),JSON.stringify({browser_plugin:'absent',fallback:'Browser plugin not available',checks,viewports:[{width:1440,height:1000},{width:390,height:844}],intentional_response_loss:true,errors,consoleErrors},null,2));
 console.log(JSON.stringify({browser:'Edge',checks:checks.length,actual_https:true,synthetic_first_bootstrap:true}));
}catch(error){
 if(page){await page.screenshot({path:path.join(config.output,'draft-failure.png'),fullPage:true}).catch(()=>{});
  fs.writeFileSync(path.join(config.output,'failure.json'),JSON.stringify({responses,errors,consoleErrors,text:await page.locator('body').innerText().catch(()=>'unavailable')},null,2));}
 console.error(JSON.stringify({name:error.name,code:error.code??'browser_assertion',completed:checks,
  at:error.stack?.split('\n').find(line=>line.trim().startsWith('at ')&&line.includes('seamer-draft-browser-check'))}));process.exitCode=1;
}finally{await browser.close();}
