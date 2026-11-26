import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(const name of ['playwright','browser','output'])assert.ok(path.isAbsolute(config[name]),name);
const {chromium}=createRequire(import.meta.url)(config.playwright);
const browser=await chromium.launch({executablePath:config.browser,headless:true,
 args:['--ignore-certificate-errors-spki-list='+config.spkis.join(',')]});
fs.mkdirSync(config.output,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'});
 const errors=[];
 const createUrl=config.seamerOrigin+'/api/v1/runs';
 const createPosts=[];
 let dropResponse=false;
 page.on('request',request=>{
  if(request.method()==='POST'&&request.url()===createUrl)createPosts.push(request.postDataJSON());
 });
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{
  const url=message.location().url;
  if(['error','warning'].includes(message.type())&&!url.endsWith('/favicon.ico')&&
   !(dropResponse&&url===createUrl&&/ERR_FAILED|Failed to fetch/.test(message.text())))errors.push(message.text());
 });
 async function login(){
  await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
  await page.getByLabel('用户名',{exact:true}).fill('role.test');
  await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
  await page.getByRole('button',{name:'自动化',exact:true}).click();
 }
 const landing=await page.goto(config.origin);
 assert.equal(landing.status(),200);
 assert.equal(new URL(page.url()).origin,config.origin);
 assert.match(await page.title(),/LeafSeamer/);
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 await login();
 const region=page.getByRole('region',{name:'运行状态'});
 await region.getByLabel('运行标识').fill(config.run.run_id);
 const matching=page.waitForResponse(response=>response.request().method()==='GET'&&
  response.url()===config.seamerOrigin+'/api/v1/runs/'+config.run.run_id);
 await region.getByRole('button',{name:'查询运行'}).click();
 const response=await matching;
 assert.equal(response.status(),200);
 assert.deepEqual(await response.json(),config.run);
 assert.equal(await response.request().headerValue('cookie'),null);
 await region.getByText('未布防',{exact:true}).waitFor();
 await region.getByText('不具备',{exact:true}).waitFor();
 await region.getByText(config.run.definition_id,{exact:true}).waitFor();

 await page.locator('#publication-definition').fill(config.run.definition_id);
 await page.locator('#publication-version').fill(config.run.definition_version);
 await page.getByRole('button',{name:'读取发布版本',exact:true}).click();
 const create=page.getByRole('button',{name:'从此版本创建未布防运行',exact:true});
 const posted=page.waitForResponse(result=>result.request().method()==='POST'&&result.url()===createUrl);
 await create.click();
 const creation=await posted;
 assert.equal(creation.status(),201);
 const created=await creation.json();
 assert.notEqual(created.run_id,config.run.run_id);
 assert.equal(created.definition_id,config.run.definition_id);
 assert.equal(created.definition_version,config.run.definition_version);
 assert.deepEqual(created.artifact_ref,config.run.artifact_ref);
 assert.equal(created.lifecycle,'disarmed');
 assert.equal(created.dispatch_eligible,false);
 assert.equal(await creation.request().headerValue('cookie'),null);
 await page.getByRole('link',{name:created.run_id,exact:true}).waitFor();
 await region.getByText('创建回执',{exact:false}).waitFor();
 await page.screenshot({path:path.join(config.output,'run-desktop.png')});

 const readCreated=page.waitForResponse(result=>result.request().method()==='GET'&&result.url()===createUrl+'/'+created.run_id);
 await region.getByRole('button',{name:'读取当前运行',exact:true}).click();
 const current=await readCreated;
 assert.equal(current.status(),200);
 assert.deepEqual(await current.json(),created);
 await region.getByText(created.run_id,{exact:true}).waitFor();

 let lost;
 await page.route(createUrl,async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  const committed=await route.fetch().catch(()=>{throw new Error('转发测试 POST 到 Seamer HTTPS 入口失败');});
  assert.equal(committed.status(),201);
  lost=await committed.json();
  dropResponse=true;
  await route.abort('failed');
 });
 await create.click();
 await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
 assert.ok(lost);
 assert.notEqual(lost.run_id,created.run_id);
 await page.unroute(createUrl);
 await page.reload();
 await login();
 const lookupUrl=config.seamerOrigin+'/api/v1/automation-requests/lookup';
 const lookedUp=page.waitForResponse(result=>result.request().method()==='POST'&&result.url()===lookupUrl);
 await page.getByRole('button',{name:'查询原请求',exact:true}).click();
 const recovered=await lookedUp;
 assert.equal(recovered.status(),200);
 assert.deepEqual(recovered.request().postDataJSON(),{...createPosts[1].context,operation_id:'createRun'});
 assert.deepEqual((await recovered.json()).result,{kind:'RunRecord',value:lost});
 await region.getByText(lost.run_id,{exact:true}).waitFor();
 await region.getByText('创建回执',{exact:false}).waitFor();
 assert.equal(createPosts.length,2);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('leafseamer.draft-request.v1:')).length),0);

 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 const english=page.getByRole('region',{name:'Run status'});
 await english.getByText('Disarmed',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await english.screenshot({path:path.join(config.output,'run-mobile.png')});
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await page.getByRole('heading',{name:'Sign in to your workspace',exact:true}).waitFor();
 assert.equal(await english.count(),0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({browser:'Edge',https:true,viewports:[1440,390],authoritative_run_read:true,created_and_recovered:true,cleared_after_logout:true}));
}finally{await browser.close();}
