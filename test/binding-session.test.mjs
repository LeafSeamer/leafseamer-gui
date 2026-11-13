import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {contractSelection as selection} from '@leafseamer/sdk';
import {digestAutomationValue as digest} from '@leafseamer/sdk/automation-program';
import {createSessionManager,validateSite} from '../src/session.ts';
import {registered} from '../../leafseamer-controller/test/fixtures/device-bindings.mjs';
const id=()=>crypto.randomUUID();
async function fixture(t){
 const service={service_id:id(),database_instance_id:id()},device=id(),material=registered(t,{service,device}),bundle=material.bindings(),bundle_digest=await digest(bundle);
 const config={format:'leafseamer.gui.site/3',...service,site_label:'测试',selection,seamer:{service_id:id(),database_instance_id:id(),base_url:'https://seamer.invalid',service_label:'Seamer',binding_source:{binding_id:id(),devices:[{device_id:device,label:'模拟器'}]}}};
 const site=validateSite(config),scope={authority_service_id:site.seamer.service_id,database_instance_id:site.seamer.database_instance_id},definition=id();
 const session={issuer_id:id(),issuer_epoch:id(),principal_id:id(),permissions:[]},data=new Map(),calls=[],records=new Map();let current=null,loss=false;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const remote={async issueToken(scopes){calls.push(['token',scopes]);return {status:'201'};},async getDraft(){return {status:'200',body:{scope,definition_id:definition,revision:'1',metadata_revision:'1',metadata:{name:'测试',description:'',layout:{}},content:{}}};},
  async createRequestContext(input){return {status:'201',body:{service_id:scope.authority_service_id,data:{...session,context_id:id(),service_id:scope.authority_service_id,audience:scope.authority_service_id,selection,operations:input.operations}}};},
  async queryBindingCandidate(def,query){calls.push(['candidate',query]);return {status:'200',body:{definition_id:def,bundle_digest,bundle:structuredClone(bundle)}};},
  async approveDefinitionBindings(def,body){calls.push(['approve',body]);current={scope,definition_id:def,approval_ref:{id:body.approval_id,revision:'1',digest:await digest('original')},state:'approved',purpose:'definition_compile',registration_ref:bundle.registration_ref,bundle_digest,bundle:structuredClone(bundle)};
   const request={request_id:body.request_id,approval_id:body.approval_id,definition_id:def,expected_bundle_digest:body.expected_bundle_digest};records.set(body.request_id,{request_id:body.request_id,request_digest:await digest(request),definition_id:def,result:structuredClone(current)});if(loss)throw new Error('response_lost');return {status:'201',body:current};},
  async getBindingApproval(){return {status:'200',body:structuredClone(current)};},
  async revokeBindingApproval(def,approvalId,body){calls.push(['revoke',body]);current={...current,state:'revoked',approval_ref:{id:approvalId,revision:'2',digest:await digest('revoked')}};const request={request_id:body.request_id,approval_id:approvalId,expected_revision:'1'};records.set(body.request_id,{request_id:body.request_id,request_digest:await digest(request),definition_id:def,result:structuredClone(current)});return {status:'200',body:current};},
  async lookupBindingApproval(def,query){calls.push(['lookup',query]);return {status:'200',body:records.get(query.request_id)??{...query,definition_id:def,result:null}};}};
 const client={createDraftClient(){return remote;},clearLocalState(){},async login(){return {status:'201',body:{data:session}};}};
 const manager=createSessionManager(site,client,storage);await manager.login('person','password');await manager.readDraft(definition);
 return {manager,site,config,definition,device,session,remote,calls,data,storage,records,loss(){loss=true;},current:()=>current};
}
test('站点来源深冻结、重复设备及旧格式混入来源被拒绝',async t=>{
 const f=await fixture(t);f.config.seamer.binding_source.devices[0].label='changed';assert.equal(f.site.seamer.binding_source.devices[0].label,'模拟器');
 assert.throws(()=>validateSite({...f.config,format:'leafseamer.gui.site/2'}));assert.throws(()=>validateSite({...f.config,seamer:{...f.config.seamer,binding_source:{...f.config.seamer.binding_source,devices:[...f.config.seamer.binding_source.devices,...f.config.seamer.binding_source.devices]}}}));
});
test('准备与取消不发请求，确认固定审阅摘要，撤销需要明确二次确认',async t=>{
 const f=await fixture(t),m=f.manager;await m.readBindingCandidate(f.device);assert.ok(m.getSnapshot().bindingCandidate);const before=f.calls.length;m.prepareBindingApproval();m.cancelBindingPreparation();assert.equal(f.calls.length,before);
 m.prepareBindingApproval();await m.confirmBindingChange();assert.equal(m.getSnapshot().bindingApproval.state,'approved');assert.equal(f.data.size,0);assert.equal(f.calls.find(c=>c[0]==='approve')[1].source.expected_registration_ref.digest,m.getSnapshot().bindingCandidate.bundle.registration_ref.digest);
 m.prepareBindingRevocation();assert.equal(m.getSnapshot().bindingApproval.state,'approved');await m.confirmBindingChange();assert.equal(m.getSnapshot().bindingApproval.state,'revoked');assert.equal(f.data.size,0);
});
test('已提交响应丢失后仅查原，历史结果不能直接撤销，存储不含凭据或正文',async t=>{
 const f=await fixture(t),m=f.manager;await m.readBindingCandidate(f.device);m.prepareBindingApproval();f.loss();await m.confirmBindingChange();assert.equal(m.getSnapshot().session,null);assert.equal(f.calls.filter(c=>c[0]==='approve').length,1);
 const saved=JSON.parse([...f.data.values()][0]);assert.deepEqual(Object.keys(saved).sort(),['actor','approval_id','bundle_digest','definition_id','format','operation','request_digest','request_id','scope']);
 await m.login('person','password');assert.ok(m.getSnapshot().bindingRecovery);const original=new Map(f.records);f.records.clear();await m.lookupBindingRequest();assert.equal(m.getSnapshot().notice,'binding_not_found');assert.ok(m.getSnapshot().bindingRecovery);assert.equal(f.calls.filter(c=>c[0]==='approve').length,1);for(const [key,value]of original)f.records.set(key,value);
 await m.lookupBindingRequest();assert.equal(m.getSnapshot().bindingHistorical,true);assert.equal(m.getSnapshot().bindingRecovery,null);m.prepareBindingRevocation();assert.equal(m.getSnapshot().bindingPreparation,null);assert.equal(f.calls.filter(c=>c[0]==='approve').length,1);
 await m.readBindingApproval(f.definition,f.current().approval_ref.id);m.prepareBindingRevocation();assert.equal(m.getSnapshot().bindingPreparation.operation,'revoke');
});
test('来源摘要错配与查原身份无法保存时不发送批准',async t=>{
 const f=await fixture(t),m=f.manager,query=f.remote.queryBindingCandidate;f.remote.queryBindingCandidate=async(...args)=>{const r=await query(...args);r.body.bundle_digest='sha256:'+'0'.repeat(64);return r;};await m.readBindingCandidate(f.device);assert.equal(m.getSnapshot().notice,'incompatible');assert.equal(m.getSnapshot().bindingCandidate,null);
 f.remote.queryBindingCandidate=query;await m.readBindingCandidate(f.device);m.prepareBindingApproval();f.storage.setItem=()=>{throw new Error('storage');};await m.confirmBindingChange();assert.equal(m.getSnapshot().notice,'recovery_unavailable');assert.equal(f.calls.filter(c=>c[0]==='approve').length,0);
});
