import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection as selection,prepareDraftChange} from '@leafseamer/sdk';
import {createSessionManager,validateSite} from '../src/session.ts';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const site=validateSite({format:'leafseamer.gui.site/2',site_label:'测试',service_id:uuid('1'),database_instance_id:uuid('2'),selection,
 seamer:{service_label:'Seamer',service_id:uuid('3'),database_instance_id:uuid('4'),base_url:'https://seamer.invalid'}});
const scope={authority_service_id:site.seamer.service_id,database_instance_id:site.seamer.database_instance_id};
const content={program:{kind:'rule',trigger_binding_id:'trigger',condition:{kind:'literal',value:true},groups:[{mode:'sequence',steps:[{step_id:'wait',depends_on:[],required:true,failure_policy:'stop',kind:'delay',delay_ms:0,max_lateness_ms:100}]}]},selections:[],policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:'sha256:'+'a'.repeat(64)}};
function fixture(){
 const session={issuer_id:'issuer',issuer_epoch:'epoch',principal_id:'person',permissions:[]},data=new Map(),calls=[];
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const context={context_id:'context',service_id:site.seamer.service_id,audience:site.seamer.service_id,...session,context_epoch:'epoch',selection,operations:['createDefinition','getDraft'],ttl_ms:60000,max_unique_requests:1};delete context.permissions;
 let saved,unknown=false;
 const remote={async issueToken(scopes){calls.push(['token',scopes]);return {status:'201'};},async createRequestContext(input){context.operations=input.operations;return {status:'201',body:{service_id:site.seamer.service_id,data:context}};},
  async createDefinition(body){calls.push(['create',body]);const prepared=await prepareDraftChange({scope,context,operation:'createDefinition',definition_id:null,body});
   saved={operation_id:'createDefinition',request_digest:prepared.request_digest,result:{kind:'DraftRecord',value:{scope,definition_id:'definition',revision:'1',metadata_revision:'1',content:body.content,content_digest:'sha256:'+'a'.repeat(64),selection_digest:'sha256:'+'a'.repeat(64),metadata:body.metadata}}};
   if(unknown)throw new Error('synthetic_response_loss');return {status:'201',body:saved.result.value};},
  async lookupAutomationRequest(){calls.push(['lookup']);return {status:'200',body:saved};},async getDraft(){return {status:'200',body:saved.result.value};}};
 const client={createDraftClient:()=>remote,clearLocalState(){},async login(){return {status:'201',body:{data:session}};}};
 const manager=createSessionManager(site,client,storage);
 return {manager,remote,calls,data,storage,session,unknown:()=>{unknown=true;},saved:()=>saved};
}
test('固定站点配置拒绝动态目标及CSP注入，旧版配置保持有效',()=>{
 for(const base_url of ['http://127.0.0.1:1','https://*.invalid',"https://seamer.invalid;bad",'https://seamer.invalid/?other=1','https://user:password@seamer.invalid'])assert.throws(()=>validateSite({...site,seamer:{...site.seamer,base_url}}));
 assert.throws(()=>validateSite({...site,format:'leafseamer.gui.site/1'}));
 const {seamer,...old}=site;assert.equal(validateSite({...old,format:'leafseamer.gui.site/1'}).seamer,undefined);
 assert.equal(validateSite({...site,seamer:{...seamer,base_url:'https://seamer.invalid/services/fixed'}}).seamer.base_url,'https://seamer.invalid/services/fixed');
});
test('运行查询仅请求 run.read，并清除被拒绝或身份不符的结果',async()=>{
 const f=fixture();await f.manager.login('person','synthetic-password');
 const run_id=uuid('5'),body={run_id,scope,lifecycle:'paused',dispatch_eligible:false,revision:'2'};
 f.remote.getRun=async id=>{f.calls.push(['run',id]);return {status:'200',body};};
 await f.manager.readRun(run_id);
 assert.deepEqual(f.calls,[['token',['run.read']],['run',run_id]]);
 assert.deepEqual(f.manager.getSnapshot().runView.record,body);
 for(const wrong of [{...body,run_id:uuid('6')},{...body,scope:{...scope,database_instance_id:uuid('7')}}]){
  f.remote.getRun=async()=>({status:'200',body:wrong});
  await f.manager.readRun(run_id);
  assert.equal(f.manager.getSnapshot().runView,null);assert.equal(f.manager.getSnapshot().notice,'incompatible');
 }
 f.remote.getRun=async()=>({status:'403'});
 await f.manager.readRun(run_id);
 assert.equal(f.manager.getSnapshot().runView,null);assert.equal(f.manager.getSnapshot().notice,'forbidden');
});
test('页面离开后迟到的运行查询不能恢复结果',async()=>{
 const f=fixture();await f.manager.login('person','synthetic-password');
 const run_id=uuid('5'),entered=Promise.withResolvers(),release=Promise.withResolvers();
 f.remote.getRun=async()=>{entered.resolve();await release.promise;return {status:'200',body:{scope,run_id}};};
 const pending=f.manager.readRun(run_id);await entered.promise;f.manager.leavePage();release.resolve();await pending;
 assert.equal(f.manager.getSnapshot().runView,null);assert.equal(f.manager.getSnapshot().session,null);
});
test('草稿创建绑定独立服务，成功后清理查原身份，无当前Controller权限也不伪拒远端权限',async()=>{
 const f=fixture();await f.manager.login('person','synthetic-password');await f.manager.createDraft(JSON.stringify(content),'草稿','描述');
 assert.equal(f.manager.getSnapshot().notice,null);assert.equal(f.manager.getSnapshot().draft.definition_id,'definition');assert.equal(f.manager.getSnapshot().draftRecovery,null);assert.equal(f.data.size,0);
 assert.deepEqual(f.calls[0],['token',['definition.edit','definition.read','request.create','request.read']]);
});
test('结果丢失后重新登录恢复查原，未确认前不发第二次写入，历史结果必须重新读取',async()=>{
 const f=fixture();await f.manager.login('person','synthetic-password');f.unknown();await f.manager.createDraft(JSON.stringify(content),'原草稿','描述');
 assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.data.size,1);const stored=[...f.data.values()][0];assert.equal(stored.includes('policy_ref'),false);assert.equal(stored.includes('synthetic-password'),false);
 await f.manager.login('person','synthetic-password');assert.ok(f.manager.getSnapshot().draftRecovery);await f.manager.createDraft(JSON.stringify(content),'第二份','');assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
 await f.manager.lookupDraftRequest();assert.equal(f.manager.getSnapshot().draft.metadata.name,'原草稿');assert.equal(f.manager.getSnapshot().draftHistorical,true);assert.equal(f.data.size,0);
 await f.manager.saveDraft(JSON.stringify(content));assert.equal(f.manager.getSnapshot().notice,'stale');
 await f.manager.readDraft('definition');assert.equal(f.manager.getSnapshot().draftHistorical,false);
});
test('不匹配的原请求摘要、未找到或失去读取权都不能清除待确认身份',async()=>{
 for(const kind of ['digest','missing','denied']){
  const f=fixture();await f.manager.login('person','password');f.unknown();await f.manager.createDraft(JSON.stringify(content),'原草稿','');await f.manager.login('person','password');
  f.remote.lookupAutomationRequest=async()=>kind==='digest'?{status:'200',body:{...f.saved(),request_digest:'sha256:'+'0'.repeat(64)}}:{status:kind==='missing'?'404':'403'};
  await f.manager.lookupDraftRequest();assert.ok(f.manager.getSnapshot().draftRecovery);assert.equal(f.manager.getSnapshot().draft,null);assert.equal(f.data.size,1);
 }
});
test('无法持久保存查原身份时不发送草稿写入；无效内容不申请凭据',async()=>{
 const f=fixture();await f.manager.login('person','password');await f.manager.createDraft('{}','草稿','');assert.equal(f.calls.length,0);assert.equal(f.manager.getSnapshot().notice,'invalid_draft');
 f.storage.setItem=()=>{throw new Error('storage');};await f.manager.createDraft(JSON.stringify(content),'草稿','');assert.equal(f.calls.filter(c=>c[0]==='create').length,0);assert.equal(f.manager.getSnapshot().notice,'recovery_unavailable');
});
test('页面离开后的迟到成功不恢复会话，原请求在同一人员重新登录后仍可找回',async()=>{
 const f=fixture();await f.manager.login('person','password');let release,entered;
 const waiting=new Promise(resolve=>{release=resolve;}),sent=new Promise(resolve=>{entered=resolve;}),original=f.remote.createDefinition;
 f.remote.createDefinition=async body=>{const result=await original(body);entered();await waiting;return result;};
 const pending=f.manager.createDraft(JSON.stringify(content),'原草稿','');await sent;f.manager.leavePage();release();await pending;
 assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.manager.getSnapshot().draft,null);assert.equal(f.data.size,1);
 await f.manager.login('person','password');await f.manager.lookupDraftRequest();assert.equal(f.manager.getSnapshot().draft.metadata.name,'原草稿');assert.equal(f.data.size,0);
});
