import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection, prepareControlChange} from '@leafseamer/sdk';
import {createSessionManager, validateSite} from '../src/session.ts';
const site=validateSite({format:'leafseamer.gui.site/1',site_label:'控制测试',service_id:'11111111-1111-4111-8111-111111111111',
 database_instance_id:'22222222-2222-4222-8222-222222222222',selection:contractSelection});
const scope={authority_service_id:site.service_id,database_instance_id:site.database_instance_id};
function fixture(){
 const data=new Map(),calls=[],storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const actor={issuer_id:'issuer',issuer_epoch:'epoch',principal_id:'operator'},session={...actor,session_id:'session',
  permissions:['device.read','control.read','control.acquire','control.release','request.create','control.emergency']};
 let tokenVersion=0,contextToken;
 let control={device_id:'device',scope,record_id:'record',record_digest:'sha256:'+'a'.repeat(64),revision:'1',control_epoch:'control-epoch',effective_version:'9007199254740993',reserved_version:'9007199254740993',
  mode:'automatic',holder:null,gate_state:'protected',pending_change:null,in_flight_command_ids:[],unresolved_command_ids:[]},saved=null,operation=null,context;
 const client={clearLocalState(){calls.push('clear');},async login(){return {status:'201',body:{data:structuredClone(session)}};},
  async issueToken({requested_scopes}){tokenVersion++;calls.push(['token',requested_scopes]);return {status:'201'};},
  async listDevices(){return {status:'200',body:{data:{catalog_revision:'1',items:[{device_id:'device'}],next_cursor:null}}};},
  async getControl(id){calls.push(['control',id]);return {status:'200',body:structuredClone(control)};},
  async createRequestContext(input){contextToken=tokenVersion;calls.push(['context',input]);context={...actor,context_id:'context',context_epoch:'requests',audience:site.service_id,service_id:site.service_id,operations:input.operations,selection:contractSelection};return {status:'201',body:{data:context}};},
  async acquireControl(device,body){return write('acquireControl',device,body);},async releaseControl(device,body){return write('releaseControl',device,body);},
  async lookupControlRequest(identity){calls.push(['lookup',identity]);return {status:'200',body:{status:saved?'found':'not_found',receipt:saved}};},
  async getControlOperation(id){calls.push(['operation',id]);return {status:'200',body:structuredClone(operation)};},async logout(){calls.push('logout');return {status:'202'};}};
 async function write(method,device,body){
  assert.equal(tokenVersion,contextToken,'请求上下文绑定原令牌');
  calls.push([method,device,body]);const prepared=await prepareControlChange({operation:method,device_id:device,scope,context,body});
  saved={identity:prepared.identity,result_kind:'control_operation',initial_result_ref:{id:'operation',revision:'1',digest:'sha256:'+'b'.repeat(64)}};
  operation={operation_id:'operation',operation_digest:saved.initial_result_ref.digest,revision:'1',scope,device_id:device,identity:prepared.identity,requester:actor,
   kind:method==='acquireControl'?'acquire':'release',state:'pending',expected_control:body.expected_control,target:{version:'9007199254740994',mode:'manual',holder:actor},failure_code:null};
  return {status:'202',body:saved};
 }
 const manager=createSessionManager(site,client,storage);
 return {manager,client,storage,data,calls,session,actor,setOperation:fn=>{operation=fn(operation);},setControl:fn=>{control=fn(control);},
  writes:()=>calls.filter(c=>Array.isArray(c)&&['acquireControl','releaseControl'].includes(c[0])).length,
  async prepare(){await manager.login('operator','synthetic-password');await manager.prepareControl('acquireControl','显式控制原因');}};
}

test('准备不写控制；确认只提交一次，受理、pending、生效与protected分别呈现',async()=>{
 const f=fixture();await f.prepare();assert.equal(f.writes(),0);assert.equal(f.manager.getSnapshot().controlAction.phase,'prepared');
 assert.equal(f.manager.getSnapshot().controlAction.prepared.body.expected_control.version,'9007199254740993');
 await Promise.all([f.manager.confirmControl(),f.manager.confirmControl()]);assert.equal(f.writes(),1);
 assert.equal(f.manager.getSnapshot().controlAction.phase,'accepted');assert.equal(f.manager.getSnapshot().control.mode,'automatic');
 await f.manager.lookupControl();assert.equal(f.manager.getSnapshot().controlAction.operation.state,'pending');
 f.setOperation(o=>({...o,state:'effective',revision:'2',operation_digest:'sha256:'+'c'.repeat(64)}));
 f.setControl(c=>({...c,mode:'manual',holder:f.actor,effective_version:'9007199254740994',gate_state:'protected'}));
 await f.manager.lookupControl();assert.equal(f.manager.getSnapshot().controlAction.operation.state,'effective');assert.equal(f.manager.getSnapshot().control.gate_state,'protected');
 f.manager.dismissControl();assert.equal(f.data.size,0);await f.manager.prepareControl('releaseControl','显式释放');await f.manager.confirmControl();
 assert.equal(f.writes(),2);assert.equal(f.calls.find(c=>c[0]==='releaseControl')[2].force,undefined);
});

test('其他读取换令牌即取消未提交草稿，不能以新令牌提交旧上下文',async()=>{
 const f=fixture();await f.prepare();await f.manager.selectDevice('device');
 assert.equal(f.manager.getSnapshot().controlAction,null);await f.manager.confirmControl();assert.equal(f.writes(),0);
});

test('权限范围满足且提示未到期时复用内存令牌；到期换令牌撤销草稿，服务撤权立即清会话且不重试',async t=>{
 let tick=1000;t.mock.method(performance,'now',()=>tick);
 const f=fixture(),issue=f.client.issueToken;f.client.issueToken=async input=>({...await issue(input),body:{data:{expires_in:60}}});
 await f.prepare();const count=()=>f.calls.filter(c=>c[0]==='token').length,preparedCount=count();
 await f.manager.selectDevice('device');assert.equal(count(),preparedCount);assert.equal(f.manager.getSnapshot().controlAction.phase,'prepared');
 tick+=60001;await f.manager.selectDevice('device');assert.equal(count(),preparedCount+1);assert.equal(f.manager.getSnapshot().controlAction,null);
 const before=count();f.client.getControl=async()=>({status:'401'});await f.manager.selectDevice('device');
 assert.equal(count(),before);assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.manager.getSnapshot().notice,'unauthorized');
});

test('服务受理后丢失响应，重新登录与重载只恢复查原，不恢复请求正文或写队列',async()=>{
 const f=fixture();await f.prepare();const send=f.client.acquireControl;f.client.acquireControl=async(...args)=>{await send(...args);throw new Error('response lost');};
 await f.manager.confirmControl();assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.writes(),1);
 const persisted=JSON.parse([...f.data.values()][0]);assert.deepEqual(Object.keys(persisted).sort(),['device_id','format','identity','operation']);
 assert.ok(!JSON.stringify(persisted).includes('显式控制原因'));assert.ok(!JSON.stringify(persisted).includes('synthetic-password'));
 const restored=createSessionManager(site,f.client,f.storage);await restored.login('operator','synthetic-password');assert.equal(restored.getSnapshot().controlAction.phase,'unknown');
 await restored.confirmControl();assert.equal(f.writes(),1);await restored.lookupControl();assert.equal(restored.getSnapshot().controlAction.operation.state,'pending');
 restored.leavePage();assert.equal(f.data.size,1);assert.equal(restored.getSnapshot().session,null);
});

test('持久查原身份多出范围字段时清除关联，不产生查原或写请求',async()=>{
 const f=fixture();await f.prepare();await f.manager.confirmControl();f.manager.leavePage();
 const [key,text]=[...f.data.entries()][0],saved=JSON.parse(text);saved.identity.key.target_scope.other='unexpected';f.data.set(key,JSON.stringify(saved));
 const restored=createSessionManager(site,f.client,f.storage);await restored.login('operator','synthetic-password');
 assert.equal(restored.getSnapshot().controlAction,null);assert.equal(f.data.size,0);assert.equal(f.writes(),1);
 assert.equal(f.calls.filter(c=>c[0]==='lookup').length,0);
});

test('not_found及无权限保持未知身份，禁止换新请求；换人员世代和显式退出清除关联',async()=>{
 const f=fixture();await f.prepare();f.client.acquireControl=async()=>{throw new Error('transport');};await f.manager.confirmControl();
 await f.manager.login('operator','synthetic-password');await f.manager.lookupControl();assert.equal(f.manager.getSnapshot().controlAction.phase,'not_found');
 const contexts=f.calls.filter(c=>c[0]==='context').length;await f.manager.prepareControl('acquireControl','不能重试');f.manager.dismissControl();
 assert.equal(f.calls.filter(c=>c[0]==='context').length,contexts);assert.equal(f.manager.getSnapshot().controlAction.phase,'not_found');
 f.session.permissions=[];await f.manager.login('operator','synthetic-password');const lookups=f.calls.filter(c=>c[0]==='lookup').length;await f.manager.lookupControl();
 assert.equal(f.calls.filter(c=>c[0]==='lookup').length,lookups);assert.equal(f.data.size,1);
 f.session.issuer_epoch='another-epoch';await f.manager.login('operator','synthetic-password');assert.equal(f.manager.getSnapshot().controlAction,null);assert.equal(f.data.size,0);
 const other=fixture();await other.prepare();await other.manager.confirmControl();await other.manager.logout();assert.equal(other.data.size,0);assert.equal(other.writes(),1);
});

test('错误回执身份、操作设备或scope不能成为已确认控制；没有持久查原存储时不发送',async()=>{
 for(const fault of ['receipt','device','scope']){
  const f=fixture();await f.prepare();
  if(fault==='receipt'){const send=f.client.acquireControl;f.client.acquireControl=async(...args)=>{const r=await send(...args);return {...r,body:{...r.body,identity:{...r.body.identity,request_digest:'sha256:'+'0'.repeat(64)}}};};}
  await f.manager.confirmControl();
  if(fault!=='receipt'){f.setOperation(o=>fault==='device'?{...o,device_id:'other'}:{...o,scope:{...scope,database_instance_id:'other'}});await f.manager.lookupControl();}
  assert.equal(f.manager.getSnapshot().notice,'incompatible');assert.equal(f.manager.getSnapshot().controlAction.operation,null);
 }
 const f=fixture();await f.prepare();f.storage.setItem=()=>{throw new Error('quota');};await f.manager.confirmControl();
 assert.equal(f.writes(),0);assert.equal(f.manager.getSnapshot().notice,'recovery_unavailable');assert.equal(f.manager.getSnapshot().controlAction.phase,'prepared');
});

test('刷新当前版本再准备，持有人完整身份及紧急权限均在提交前检查',async()=>{
 const f=fixture();await f.manager.login('operator','synthetic-password');
 f.setControl(c=>({...c,mode:'manual',holder:{...f.actor,issuer_epoch:'other'}}));
 await f.manager.prepareControl('releaseControl','非持有人');assert.equal(f.manager.getSnapshot().controlAction,null);
 await f.manager.prepareControl('acquireControl','未选择紧急');assert.equal(f.manager.getSnapshot().controlAction,null);
 f.session.permissions=f.session.permissions.filter(p=>p!=='control.emergency');await f.manager.login('operator','synthetic-password');
 await f.manager.prepareControl('acquireControl','无紧急权限',true);assert.equal(f.manager.getSnapshot().notice,'forbidden');assert.equal(f.writes(),0);
});

test('页面关闭期间的迟到响应不恢复界面资格，查原身份仍可供同一人员恢复',async()=>{
 const f=fixture();await f.prepare();const send=f.client.acquireControl;let finish;
 f.client.acquireControl=async(...args)=>{const result=await send(...args);return new Promise(resolve=>{finish=()=>resolve(result);});};
 const submitted=f.manager.confirmControl();while(!finish)await new Promise(resolve=>setImmediate(resolve));
 f.manager.leavePage();finish();await submitted;assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.manager.getSnapshot().controlAction,null);assert.equal(f.data.size,1);
 await f.manager.login('operator','synthetic-password');assert.equal(f.manager.getSnapshot().controlAction.phase,'unknown');assert.equal(f.writes(),1);
});
