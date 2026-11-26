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
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{
  if(['error','warning'].includes(message.type())&&!message.location().url.endsWith('/favicon.ico'))errors.push(message.text());
 });
 const landing=await page.goto(config.origin);
 assert.equal(landing.status(),200);
 assert.equal(new URL(page.url()).origin,config.origin);
 assert.match(await page.title(),/LeafSeamer/);
 await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
 assert.equal(await page.locator('vite-error-overlay').count(),0);
 await page.getByLabel('用户名',{exact:true}).fill('role.test');
 await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
 await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
 await page.getByRole('button',{name:'自动化',exact:true}).click();
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
 await page.screenshot({path:path.join(config.output,'run-desktop.png')});

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
 console.log(JSON.stringify({browser:'Edge',https:true,viewports:[1440,390],authoritative_run_read:true,cleared_after_logout:true}));
}finally{await browser.close();}
