import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection,prepareManualCommand} from '@leafseamer/sdk';
import {canSubmitObsCut} from '../src/obs-actions.ts';
import {createSessionManager,validateSite} from '../src/session.ts';

const site=validateSite({format:'leafseamer.gui.site/1',site_label:'OBS',service_id:'11111111-1111-4111-8111-111111111111',
  database_instance_id:'22222222-2222-4222-8222-222222222222',selection:contractSelection});
const scope={authority_service_id:site.service_id,database_instance_id:site.database_instance_id};
const principal={issuer_id:'issuer',issuer_epoch:'issuer_epoch',principal_id:'person'};
const scene={scene_id:'selected',display_name:'节目',obs_scene_uuid:'11111111-1111-4111-8111-111111111111'};

function fixture(){
  const session={...principal,permissions:['device.read','control.read','device.command','command.read','request.create','command.cancel']},device={device_id:'obs_device',device_kind:'obs'};
  const catalog={device_id:device.device_id,device_session_id:'session',collection_ref:'collection',collection_generation:'1',catalog_revision:'1',binding_revision:'2',status:'ready',entries:[scene]};
  const control={device_id:device.device_id,scope,control_epoch:'epoch',effective_version:'1',pending_change:null,gate_state:'ready',mode:'manual',holder:principal};
  const requestContext={...principal,context_id:'context',context_epoch:'2',service_id:site.service_id,audience:site.service_id,selection:contractSelection,operations:['submitCommand']};
  const capability={action_id:'obs.program_scene.set',capability_version:'1.0.0',completion:{supported:['effect_verified']},evidence_timeout_ms:1000};
  const stored=new Map(),storage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  const data=value=>({status:'200',body:{service_id:site.service_id,data:value}}),posts=[];
  const client={clearLocalState(){},async login(){return {status:'201',body:{data:session}};},async issueToken(){return {status:'201'};},
    async listDevices(){return data({items:[device],next_cursor:null,catalog_revision:'1'});},async getControl(){return {status:'200',body:structuredClone(control)};},
    async getCapabilities(){return data({devices:[{...device,connection_state:'ready',actions:[capability]}]});},async getSceneCatalog(){return data(structuredClone(catalog));},
    async createRequestContext(){return {status:'201',body:{data:requestContext}};},async submitCommand(body){posts.push(body);
      const {identity}=await prepareManualCommand({scope,context:requestContext,body});return {status:'202',body:{identity,decision:'accepted',command_ref:{scope,object_id:'command'}}};},
    async lookupCommandAdmission(){return {status:'200',body:{state:'not_found',adjudication:null}};},
    async getCommand(){return {status:'200',body:{record:{command_id:'command',scope,target:{device_id:device.device_id,action_id:capability.action_id},
      state:{command_id:'command',scope,phase:'finished',resource_status:'clear'}}}};}};
  return {manager:createSessionManager(site,client,storage),client,stored,control,catalog,posts,session};
}
async function read(f){await f.manager.login('person','synthetic');await f.manager.readObsScenes();}

test('手动 Cut 使用确认目录、当前控制版本及原请求身份，结算后才能关闭记录',async()=>{
  const f=fixture();await read(f);assert.equal(canSubmitObsCut(f.manager.getSnapshot()),true);
  await f.manager.submitObsCut(scene.scene_id);
  assert.equal(f.posts.length,1);
  assert.deepEqual(f.posts[0].parameters,{scene_ref:{collection_ref:'collection',collection_generation:'1',catalog_revision:'1',binding_revision:'2',scene_id:scene.scene_id}});
  assert.equal(f.manager.getSnapshot().obsCatalog,null);assert.equal(f.manager.getSnapshot().obsCommand.phase,'accepted');
  await f.manager.dismissObsCut();assert.equal(f.stored.size,1);
  await f.manager.lookupObsCut();assert.equal(f.manager.getSnapshot().command.state.resource_status,'clear');
  await f.manager.dismissObsCut();assert.equal(f.stored.size,0);
});

test('过期目录和保护态不能创建发送资格，断连撤下旧场景',async()=>{
  const f=fixture();await read(f);f.catalog.device_session_id='changed';
  await f.manager.submitObsCut(scene.scene_id);assert.equal(f.manager.getSnapshot().notice,'stale');assert.equal(f.posts.length,0);
  f.control.gate_state='protected';await f.manager.readObsScenes();assert.equal(canSubmitObsCut(f.manager.getSnapshot()),false);
  await f.manager.submitObsCut(scene.scene_id);assert.equal(f.posts.length,0);
  f.client.getSceneCatalog=async()=>({status:'503'});await f.manager.readObsScenes();assert.equal(f.manager.getSnapshot().obsCatalog,null);
});

test('发送结果未知时重登录只查原身份，查无原件仍禁止再次发送',async()=>{
  const f=fixture();await read(f);let sent=0;
  f.client.submitCommand=async()=>{sent++;throw new Error('connection');};
  await f.manager.submitObsCut(scene.scene_id);assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.stored.size,1);
  await read(f);assert.equal(f.manager.getSnapshot().obsCommand.phase,'unknown');
  await f.manager.lookupObsCut();assert.equal(f.manager.getSnapshot().obsCommand.phase,'not_found');
  await f.manager.submitObsCut(scene.scene_id);assert.equal(sent,1);assert.equal(f.stored.size,1);
});

test('显式阻止受理保留原正文、查原身份及拒绝操作 ID，返回原受理时不清除占用',async()=>{
  for(const decision of ['rejected','accepted']){
    const f=fixture();await read(f);const attempted=[];
    f.client.submitCommand=async body=>{attempted.push(body);throw new Error('connection');};
    await f.manager.submitObsCut(scene.scene_id);await read(f);
    const saved=JSON.parse([...f.stored.values()][0]),{context_id,idempotency_key,correlation_id,...content}=attempted[0],calls=[];
    assert.deepEqual(saved.rejection.content,content);
    f.client.rejectCommandAdmission=async body=>{
      calls.push(body);
      if(calls.length===1)throw new Error('rejection_response_lost');
      return {status:'200',body:{identity:body.identity,decision,command_ref:decision==='accepted'?{object_id:'command',scope}:null}};
    };
    await f.manager.rejectObsCut();assert.equal(calls.length,0);
    await f.manager.lookupObsCut();await f.manager.rejectObsCut();assert.equal(f.stored.size,1);
    await read(f);await f.manager.lookupObsCut();await f.manager.rejectObsCut();
    assert.deepEqual(calls,[{identity:saved.identity,...saved.rejection},{identity:saved.identity,...saved.rejection}]);
    assert.equal(f.manager.getSnapshot().obsCommand.phase,decision);assert.equal(attempted.length,1);
    await f.manager.dismissObsCut();assert.equal(f.stored.size,decision==='accepted'?1:0);
  }
});

test('旧查原身份或缺少取消权限时保留原记录，禁止构造拒绝请求',async()=>{
  for(const legacy of [true,false]){
    const f=fixture();await read(f);
    f.client.submitCommand=async()=>{throw new Error('connection');};
    await f.manager.submitObsCut(scene.scene_id);
    if(legacy){const [key,text]=[...f.stored][0],{rejection,...saved}=JSON.parse(text);f.stored.set(key,JSON.stringify(saved));}
    else f.session.permissions=f.session.permissions.filter(scope=>scope!=='command.cancel');
    let calls=0;f.client.rejectCommandAdmission=async()=>{calls++;};
    await read(f);await f.manager.lookupObsCut();await f.manager.rejectObsCut();
    assert.equal(calls,0);assert.equal(f.stored.size,1);assert.equal(f.manager.getSnapshot().obsCommand.phase,'not_found');
  }
});
