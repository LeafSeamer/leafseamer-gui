import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection as selection,prepareDraftChange} from '@leafseamer/sdk';
import {digestAutomationValue as hash} from '@leafseamer/sdk/automation-program';
import {createSessionManager,validateSite} from '../src/session.ts';
import {runSource} from '../src/draft-actions.ts';
const uuid=n=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const site=validateSite({format:'leafseamer.gui.site/2',site_label:'测试',service_id:uuid('1'),database_instance_id:uuid('2'),selection,seamer:{service_label:'Seamer',service_id:uuid('3'),database_instance_id:uuid('4'),base_url:'https://seamer.invalid'}});
const scope={authority_service_id:site.seamer.service_id,database_instance_id:site.seamer.database_instance_id};
async function fixture(){
 const ref={id:'fixture',revision:'1',digest:await hash({})},program={kind:'rule',trigger_binding_id:'trigger',condition:{kind:'literal',value:true},groups:[{mode:'sequence',steps:[{kind:'delay',step_id:'wait',required:true,depends_on:[],failure_policy:'stop',delay_ms:0,max_lateness_ms:100}]}]};
 const content={program,selections:[],policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:ref.digest}};
 const draft={scope,definition_id:'definition',revision:'2',metadata_revision:'1',content,content_digest:await hash(content),selection_digest:await hash([]),metadata:{name:'发布测试',description:'',layout:{}}};
 const compiled={dsl_version:'automation-program/0.1.0-draft.1',compiler_version:'test-compiler',definition_id:'definition',definition_version:'3',policy_ref:ref,program,input_bindings:[],action_bindings:[],alias_table:{ref:{...ref,digest:await hash([])},entries:[]},graph_digest:ref.digest};
 const artifact={artifact_version:'automation-program/0.1.0-draft.1',artifact_id:'artifact',program_digest:await hash(compiled),bindings_digest:await hash({input_bindings:[],action_bindings:[],alias_table:compiled.alias_table}),proof_refs:[],publisher_ref:ref,review_ref:ref};artifact.manifest_digest=await hash(artifact);
 const version={scope,definition_id:'definition',definition_version:'3',source_draft_revision:'2',artifact_ref:{kind:'artifact',scope,object_id:'artifact',revision:'1',digest:artifact.manifest_digest},program_digest:artifact.program_digest,bindings_digest:artifact.bindings_digest,published_by:'person'};
 const run={scope,run_id:uuid('5'),definition_id:version.definition_id,definition_version:version.definition_version,
  artifact_ref:version.artifact_ref,revision:'1',arm_generation:'0',lifecycle:'disarmed',dispatch_eligible:false,
  active_execution_id:null,active_operation_id:null,last_execution_id:null,pause_latches:[],business_state:null,last_receive_seq:'1'};
 const session={issuer_id:'issuer',issuer_epoch:'epoch',principal_id:'person',permissions:[]},data=new Map(),calls=[];
 let saved,context,lose=false,revision='2';
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const remote={async issueToken(scopes){calls.push(['token',scopes]);return {status:'201'};},async getDraft(){return {status:'200',body:structuredClone(draft)};},
  async createRequestContext(body){calls.push(['context']);context={context_id:'context',service_id:site.seamer.service_id,audience:site.seamer.service_id,issuer_id:'issuer',issuer_epoch:'epoch',principal_id:'person',context_epoch:'epoch',selection,operations:body.operations};return {status:'201',body:{service_id:site.seamer.service_id,data:context}};},
  async publishDefinition(definition_id,body){calls.push(['publish',body]);const prepared=await prepareDraftChange({scope,context,operation:'publishDefinition',definition_id,body});saved={operation_id:'publishDefinition',request_digest:prepared.request_digest,result:{kind:'PublishedVersion',value:{...version,source_draft_revision:revision}}};if(lose)throw new Error('response_loss');return {status:'201',body:saved.result.value};},
  async createRun(body){
   calls.push(['createRun',body]);
   const prepared=await prepareDraftChange({scope,context,operation:'createRun',definition_id:body.definition_id,body});
   saved={operation_id:'createRun',request_digest:prepared.request_digest,result:{kind:'RunRecord',value:structuredClone(run)}};
   if(lose)throw new Error('response_loss');
   return {status:'201',body:saved.result.value};
  },
  async getRun(runId){calls.push(['getRun',runId]);return {status:'200',body:structuredClone(run)};},
  async lookupAutomationRequest(){calls.push(['lookup']);return {status:'200',body:saved};},async getPublishedArtifact(){calls.push(['artifact']);return {status:'200',body:structuredClone(artifact)};},async getCompiledProgram(){calls.push(['program']);return {status:'200',body:structuredClone(compiled)};}};
 const client={createDraftClient:()=>remote,clearLocalState(){},async login(){return {status:'201',body:{data:session}};},async refresh(){return {status:'200',body:{data:session}};}};
 const manager=createSessionManager(site,client,storage);await manager.login('person','synthetic-password');await manager.readDraft('definition');
 return {manager,remote,calls,data,storage,version,draft,artifact,compiled,run,client,saved:()=>saved,lose:()=>{lose=true;},wrongRevision:()=>{revision='1';}};
}
test('发布准备与取消不签发凭据；确认使用固定修订和发布权限，不假定连续版本',async()=>{
 const f=await fixture(),before=f.calls.length;await f.manager.preparePublication();assert.equal(f.calls.length,before);f.manager.cancelPublication();assert.equal(f.manager.getSnapshot().publicationPreparation,null);
 await f.manager.preparePublication();await f.manager.confirmPublication();const state=f.manager.getSnapshot();assert.equal(state.notice,null);assert.deepEqual(state.publishedVersion,f.version);assert.equal(state.draftRecovery,null);assert.equal(f.data.size,0);
 const body=f.calls.find(call=>call[0]==='publish')[1];assert.equal(body.expected_draft_revision,'2');assert.equal(body.expected_content_digest,f.draft.content_digest);assert.equal(body.expected_selection_digest,f.draft.selection_digest);
 assert.deepEqual(f.calls.filter(call=>call[0]==='token').at(-1)[1],['definition.publish','definition.read','request.create','request.read']);
 await f.manager.readPublication('definition','3');assert.equal(f.manager.getSnapshot().publicationHistory.artifact.manifest_digest,f.artifact.manifest_digest);
});
test('发布响应丢失后重新登录只查原，保存的查原身份不包含令牌、CSRF和程序正文',async()=>{
 const f=await fixture();f.lose();await f.manager.preparePublication();await f.manager.confirmPublication();assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.data.size,1);
 const raw=[...f.data.values()][0];for(const key of ['access_token','csrf','program','parameter_schema'])assert.equal(raw.includes(key),false);
 await f.manager.login('person','synthetic-password');assert.equal(f.manager.getSnapshot().draftRecovery.lookup.operation_id,'publishDefinition');await f.manager.confirmPublication();assert.equal(f.calls.filter(call=>call[0]==='publish').length,1);
 await f.manager.lookupDraftRequest();assert.deepEqual(f.manager.getSnapshot().publishedVersion,f.version);assert.equal(f.manager.getSnapshot().draft,null);assert.equal(f.data.size,0);
});
test('错误修订、错摘要或无原记录都保留发布查原身份',async()=>{
 const f=await fixture();f.wrongRevision();await f.manager.preparePublication();await f.manager.confirmPublication();assert.equal(f.manager.getSnapshot().notice,'incompatible');assert.ok(f.manager.getSnapshot().draftRecovery);
 for(const response of [{status:'404'},{status:'200',body:{...f.saved(),request_digest:'sha256:'+'0'.repeat(64)}}, {status:'200',body:f.saved()}]){f.remote.lookupAutomationRequest=async()=>response;await f.manager.lookupDraftRequest();assert.ok(f.manager.getSnapshot().draftRecovery);assert.equal(f.manager.getSnapshot().publishedVersion,null);}
});
test('无法保存发布查原身份不发送，重新读取草稿或续期撤销准备',async()=>{
 const f=await fixture();await f.manager.preparePublication();await f.manager.readDraft('definition');assert.equal(f.manager.getSnapshot().publicationPreparation,null);
 await f.manager.preparePublication();await f.manager.refreshSession();assert.equal(f.manager.getSnapshot().publicationPreparation,null);
 await f.manager.readDraft('definition');await f.manager.preparePublication();f.storage.setItem=()=>{throw new Error('storage');};await f.manager.confirmPublication();assert.equal(f.manager.getSnapshot().notice,'recovery_unavailable');assert.equal(f.calls.filter(call=>call[0]==='publish').length,0);
});
test('历史程序或产物错配清除旧视图，读取不调用发布',async()=>{
 const f=await fixture();await f.manager.readPublication('definition','3');assert.ok(f.manager.getSnapshot().publicationHistory);
 f.remote.getCompiledProgram=async()=>({status:'200',body:{...f.compiled,definition_version:'4'}});await f.manager.readPublication('definition','3');assert.equal(f.manager.getSnapshot().publicationHistory,null);assert.equal(f.manager.getSnapshot().notice,'incompatible');
 f.remote.getCompiledProgram=async()=>({status:'200',body:{...f.compiled,compiler_version:'changed'}});await f.manager.readPublication('definition','3');assert.equal(f.manager.getSnapshot().publicationHistory,null);assert.equal(f.calls.filter(call=>call[0]==='publish').length,0);
});
test('发布权或上下文被拒绝时不创建查原记录、不发送发布',async()=>{
 for(const method of ['issueToken','createRequestContext']){
  const f=await fixture();f.remote[method]=async()=>({status:'403'});await f.manager.preparePublication();await f.manager.confirmPublication();
  assert.equal(f.manager.getSnapshot().notice,'forbidden');assert.equal(f.calls.filter(call=>call[0]==='publish').length,0);assert.equal(f.data.size,0);
 }
});
test('发布成功后清理查原身份失败，保留已确认结果且不声称未发送',async()=>{
 const f=await fixture(),remove=f.storage.removeItem;f.storage.removeItem=()=>{throw new Error('storage');};await f.manager.preparePublication();await f.manager.confirmPublication();
 assert.equal(f.manager.getSnapshot().notice,'recovery_cleanup');assert.deepEqual(f.manager.getSnapshot().publishedVersion,f.version);assert.ok(f.manager.getSnapshot().draftRecovery);
 f.storage.removeItem=remove;await f.manager.lookupDraftRequest();assert.equal(f.manager.getSnapshot().draftRecovery,null);assert.equal(f.calls.filter(call=>call[0]==='publish').length,1);
});
test('固定发布版本创建未布防运行，权限和读取结果各自独立',async()=>{
 const f=await fixture();
 await f.manager.readPublication('definition','3');
 const selected=runSource(f.manager.getSnapshot(),site);
 await f.manager.createRun({...selected,definition_version:'4'});
 assert.equal(f.manager.getSnapshot().notice,'stale');
 assert.equal(f.calls.some(([method])=>method==='createRun'),false);
 await f.manager.createRun(selected);
 const [,body]=f.calls.find(([method])=>method==='createRun');
 assert.equal(body.definition_id,f.version.definition_id);
 assert.equal(body.definition_version,f.version.definition_version);
 assert.deepEqual(body.expected_artifact_ref,f.version.artifact_ref);
 assert.deepEqual(f.calls.filter(([method])=>method==='token').at(-1)[1],['run.manage','request.create']);
 assert.deepEqual(f.manager.getSnapshot().runView.record,f.run);
 assert.equal(f.manager.getSnapshot().runView.source,'creation');
 assert.equal(f.data.size,0);
 await f.manager.readRun(f.run.run_id);
 assert.equal(f.manager.getSnapshot().runView.source,'query');
 assert.deepEqual(f.calls.filter(([method])=>method==='token').at(-1)[1],['run.read']);
});
test('重载后只用查原权限找回运行，错配回执保留原请求',async()=>{
 const f=await fixture();
 await f.manager.readPublication('definition','3');
 const selected=runSource(f.manager.getSnapshot(),site);
 f.lose();
 await f.manager.createRun(selected);
 assert.equal(f.manager.getSnapshot().session,null);
 assert.equal(f.data.size,1);
 const raw=[...f.data.values()][0];
 for(const key of ['access_token','csrf','program','expected_artifact_ref','synthetic-password'])assert.equal(raw.includes(key),false);
 assert.deepEqual(JSON.parse(raw).run,selected);
 const reloaded=createSessionManager(site,f.client,f.storage);
 await reloaded.login('person','synthetic-password');
 assert.equal(reloaded.getSnapshot().draftRecovery.lookup.operation_id,'createRun');
 const valid=f.saved();
 f.remote.lookupAutomationRequest=async()=>({status:'200',body:{...valid,result:{kind:'RunRecord',value:{...f.run,definition_version:'4'}}}});
 await reloaded.lookupDraftRequest();
 assert.equal(reloaded.getSnapshot().notice,'incompatible');
 assert.equal(reloaded.getSnapshot().runView,null);
 assert.equal(f.data.size,1);
 f.remote.lookupAutomationRequest=async()=>({status:'200',body:valid});
 await reloaded.lookupDraftRequest();
 assert.deepEqual(reloaded.getSnapshot().runView.record,f.run);
 assert.equal(reloaded.getSnapshot().runView.source,'creation');
 assert.deepEqual(f.calls.filter(([method])=>method==='token').at(-1)[1],['request.read','run.read']);
 assert.equal(f.calls.filter(([method])=>method==='createRun').length,1);
 assert.equal(f.data.size,0);
});
