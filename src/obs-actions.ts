import {prepareManualCommand} from '@leafseamer/sdk';
import type {BrowserSessionClient, Inputs, PreparedManualCommand, Results} from '@leafseamer/sdk';
import {samePrincipal} from './control-actions.ts';
import type {RecoveryStorage} from './control-actions.ts';
import type {Notice, Session, Site, Snapshot} from './session.ts';

type Identity = PreparedManualCommand['identity'];
type Admission = Extract<Results['controller']['submitCommand'], {status:'202'}>['body'];
export type SceneCatalog = Extract<Results['controller']['getSceneCatalog'],{status:'200'}>['body']['data'];
type Rejection = Omit<Inputs['controller']['rejectCommandAdmission']['body'],'identity'>;
type Saved = Readonly<{device_id:string; identity:Identity; rejection?:Rejection}>;
export type ObsCommand = Readonly<{saved:Saved; phase:'unknown'|'not_found'|'accepted'|'rejected'; commandId:string|null}>;
const actionId = 'obs.program_scene.set';
const writeScopes = ['device.read','control.read','device.command','command.read','request.create'];
const canRead = (session:Session|null,scope:string) => session?.permissions.includes(scope) === true;
const availableAction = (state:Snapshot) => state.capabilities?.devices.find(device=>device.device_id===state.selected&&device.connection_state==='ready')
  ?.actions.find(action=>action.action_id===actionId&&action.capability_version==='1.0.0'&&action.completion.supported.includes('effect_verified'));
const hasControl = (state:Snapshot) => state.control?.device_id===state.selected&&state.control?.mode==='manual'&&
  state.control.gate_state==='ready'&&state.control.pending_change===null&&samePrincipal(state.control.holder,state.session);
export function canSubmitObsCut(state:Snapshot){
  return !state.obsCommand&&state.obsCatalog?.device_id===state.selected&&state.obsCatalog?.status==='ready'&&
    !!availableAction(state)&&hasControl(state)&&writeScopes.every(scope=>canRead(state.session,scope));
}
export function canDismissObsCut(state:Snapshot){
  const pending=state.obsCommand,record=state.command;
  return pending?.phase==='rejected'||pending?.phase==='accepted'&&record?.command_id===pending.commandId&&
    record.state.phase==='finished'&&record.state.resource_status==='clear';
}
export function canRejectObsCut(state:Snapshot){
  const pending=state.obsCommand;
  return pending?.phase==='not_found'&&pending.saved.device_id===state.selected&&!!pending.saved.rejection&&
    samePrincipal(pending.saved.identity.key,state.session)&&canRead(state.session,'command.cancel');
}
const sceneRef=(catalog:SceneCatalog,scene_id:string)=>({collection_ref:catalog.collection_ref,collection_generation:catalog.collection_generation,
  catalog_revision:catalog.catalog_revision,binding_revision:catalog.binding_revision,scene_id});
const sameScene = (left:SceneCatalog,right:SceneCatalog,id:string) => left.device_session_id===right.device_session_id&&right.status==='ready'&&
  JSON.stringify(sceneRef(left,id))===JSON.stringify(sceneRef(right,id))&&left.entries.find(scene=>scene.scene_id===id)?.obs_scene_uuid===
    right.entries.find(scene=>scene.scene_id===id)?.obs_scene_uuid;

export function createObsActions({site,client,storage,state,publish,action,token,accept,fail,clearEvidence}: {
  site:Site; client:BrowserSessionClient; storage:RecoveryStorage|null; state:()=>Snapshot; publish:(patch:Partial<Snapshot>)=>void;
  action:(run:(alive:()=>void)=>Promise<void>)=>Promise<void>; token:(scopes:string[],alive:()=>void)=>Promise<void>;
  accept:(status:string,expected:string)=>void; fail:(code:Notice)=>never; clearEvidence:()=>void;
}){
  const keyFor=(owner:Pick<Session,'issuer_id'|'issuer_epoch'|'principal_id'>)=>
    `leafseamer.obs-command.v1:${JSON.stringify([site.service_id,site.database_instance_id,owner.issuer_id,owner.issuer_epoch,owner.principal_id])}`;
  const sameScope=(scope:Identity['key']['target_scope'])=>scope.authority_service_id===site.service_id&&scope.database_instance_id===site.database_instance_id;
  const bounded=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,256}$/.test(value);
  function reset(preserve=false){
    const session=state().session;
    if(!preserve&&session)try{storage?.removeItem(keyFor(session));}catch{/* 清除会话凭据独立于恢复存储。 */}
  }
  function restore(session:Session){
    try{
      const text=storage?.getItem(keyFor(session));if(!text)return;
      if(text.length>8192)throw new Error('shape');
      const saved=JSON.parse(text) as Saved,k=saved.identity.key;
      if(!['device_id,identity','device_id,identity,rejection'].includes(Object.keys(saved).sort().join(','))||!bounded(saved.device_id)||
        Object.keys(saved.identity).sort().join(',')!=='key,request_digest'||!/^sha256:[0-9a-f]{64}$/.test(saved.identity.request_digest)||
        Object.keys(k).sort().join(',')!=='idempotency_key,issuer_epoch,issuer_id,operation_id,principal_id,request_epoch,target_scope'||
        Object.keys(k.target_scope).sort().join(',')!=='authority_service_id,database_instance_id'||!sameScope(k.target_scope)||
        !samePrincipal(k,session)||k.operation_id!=='createCommand'||![k.request_epoch,k.idempotency_key].every(bounded))throw new Error('shape');
      const r=saved.rejection;
      const rejection=r&&Object.keys(r).sort().join(',')==='content,rejection_operation_id'&&bounded(r.rejection_operation_id)&&
        r.content?.device_id===saved.device_id&&r.content.action_id===actionId&&r.content.origin==='manual'&&r.content.automation_binding===null?r:undefined;
      // 旧记录或缺少原正文时仍可查询，不能从当前场景重建原请求。
      publish({obsCommand:{saved:{device_id:saved.device_id,identity:saved.identity,...(rejection&&{rejection})},phase:'unknown',commandId:null}});
    }catch{reset();}
  }
  function save(saved:Saved){
    try{
      if(!storage)throw new Error('storage');
      const key=keyFor(saved.identity.key),text=JSON.stringify(saved);storage.setItem(key,text);
      if(storage.getItem(key)!==text)throw new Error('storage');
    }catch{fail('recovery_unavailable');}
  }
  function adopt(admission:Admission,saved:Saved){
    const {identity,command_ref,decision}=admission,a=identity.key,b=saved.identity.key;
    if(!sameScope(a.target_scope)||!samePrincipal(a,b)||a.operation_id!==b.operation_id||a.request_epoch!==b.request_epoch||
      a.idempotency_key!==b.idempotency_key||identity.request_digest!==saved.identity.request_digest||
      (decision==='accepted'?!command_ref||!sameScope(command_ref.scope):decision!=='rejected'||command_ref!==null))return fail('incompatible');
    const pending:ObsCommand={saved,phase:decision==='accepted'?'accepted':'rejected',commandId:command_ref?.object_id??null};
    publish({obsCommand:pending});return pending;
  }
  async function readCatalog(device:string,alive:()=>void){
    const response=await client.getSceneCatalog(device);alive();accept(response.status,'200');
    if(response.status!=='200')return fail('unavailable');
    const {data}=response.body;
    if(response.body.service_id!==site.service_id||data.device_id!==device||
      new Set(data.entries.map(scene=>scene.scene_id)).size!==data.entries.length||
      new Set(data.entries.map(scene=>scene.obs_scene_uuid)).size!==data.entries.length)return fail('incompatible');
    return data;
  }
  async function readControl(device:string,alive:()=>void){
    const response=await client.getControl(device);alive();accept(response.status,'200');
    if(response.status!=='200')return fail('unavailable');
    if(response.body.device_id!==device||!sameScope(response.body.scope))return fail('incompatible');
    publish({control:response.body});return response.body;
  }
  return {reset,restore,api:{
    readObsScenes(){return action(async alive=>{
      publish({obsCatalog:null,capabilities:null,capabilitiesReadAt:null,control:null});
      const current=state(),device=current.devices.find(value=>value.device_id===current.selected&&value.device_kind==='obs');
      if(!device)return fail('stale');
      if(!canRead(current.session,'device.read'))return fail('forbidden');
      const control=canRead(current.session,'control.read');
      await token(control?['device.read','control.read']:['device.read'],alive);
      const response=await client.getCapabilities(device.device_id);alive();accept(response.status,'200');
      if(response.status!=='200')return;
      const {data}=response.body;
      if(response.body.service_id!==site.service_id||data.devices.length!==1||data.devices[0].device_id!==device.device_id||data.devices[0].device_kind!=='obs')return fail('incompatible');
      const catalog=await readCatalog(device.device_id,alive);
      if(control)await readControl(device.device_id,alive);
      publish({obsCatalog:catalog,capabilities:data,capabilitiesReadAt:new Date().toISOString()});
    });},
    submitObsCut(sceneId:string){return action(async alive=>{
      const current=state(),catalog=current.obsCatalog,capability=availableAction(current);
      if(!canSubmitObsCut(current)||!catalog||!capability||!catalog.entries.some(entry=>entry.scene_id===sceneId))return fail('stale');
      const device=catalog.device_id;
      publish({control:null,obsCatalog:null});
      await token(writeScopes,alive);
      const latest=await readCatalog(device,alive);
      const control=await readControl(device,alive);publish({obsCatalog:latest});
      if(!sameScene(catalog,latest,sceneId)||!hasControl(state()))return fail('stale');
      const context=await client.createRequestContext({audience:site.service_id!,operations:['submitCommand'],ttl_ms:60000,max_unique_requests:1});
      alive();accept(context.status,'201');if(context.status!=='201')return;
      if(!samePrincipal(context.body.data,current.session))return fail('incompatible');
      const prepared=await prepareManualCommand({scope:control.scope,context:context.body.data,body:{
        context_id:context.body.data.context_id,idempotency_key:crypto.randomUUID(),device_id:device,action_id:capability.action_id,capability_version:capability.capability_version,
        expected_control:{epoch:control.control_epoch,version:control.effective_version},parameters:{scene_ref:sceneRef(latest,sceneId)},
        origin:'manual',automation_binding:null,required_completion:'effect_verified',preconditions:[],dispatch:{mode:'immediate',max_queue_ms:5000},evidence_timeout_ms:capability.evidence_timeout_ms,
      }});alive();
      const {context_id,idempotency_key,correlation_id,...content}=prepared.body;
      const saved:Saved={device_id:device,identity:prepared.identity,rejection:{content,rejection_operation_id:crypto.randomUUID()}};
      save(saved);clearEvidence();
      publish({obsCommand:{saved,phase:'unknown',commandId:null},obsCatalog:null,control:null,command:null,evidence:null});
      const response=await client.submitCommand(prepared.body);alive();
      if(response.status==='202'||response.status==='200'){adopt(response.body,saved);return;}
      accept(response.status,'202');
    });},
    lookupObsCut(){return action(async alive=>{
      let pending=state().obsCommand;
      if(!pending||!samePrincipal(pending.saved.identity.key,state().session))return fail('stale');
      if(!canRead(state().session,'command.read'))return fail('forbidden');
      await token(['command.read'],alive);
      if(pending.phase==='unknown'||pending.phase==='not_found'){
        const response=await client.lookupCommandAdmission(pending.saved.identity);alive();accept(response.status,'200');
        if(response.status!=='200')return;
        const found=response.body.adjudication;
        if(response.body.state==='not_found'&&found===null){publish({obsCommand:{...pending,phase:'not_found'}});return;}
        if(response.body.state!=='found'||!found)return fail('incompatible');
        pending=adopt(found,pending.saved);
      }
      if(!pending.commandId)return;
      const response=await client.getCommand(pending.commandId);alive();accept(response.status,'200');
      if(response.status!=='200')return;
      const record=response.body.record;
      if(record.command_id!==pending.commandId||record.state.command_id!==pending.commandId||!sameScope(record.scope)||!sameScope(record.state.scope)||
        record.target.device_id!==pending.saved.device_id||record.target.action_id!==actionId)return fail('incompatible');
      clearEvidence();publish({command:record,evidence:null});
    });},
    rejectObsCut(){return action(async alive=>{
      const pending=state().obsCommand,rejection=pending?.saved.rejection;
      if(!pending||!rejection||!canRejectObsCut(state()))return fail('stale');
      await token(['command.cancel'],alive);
      // Controller 对原键进行原子裁决。若受理已先提交，仍采用原受理记录。
      publish({obsCommand:{...pending,phase:'unknown'}});
      const response=await client.rejectCommandAdmission({identity:pending.saved.identity,...rejection});
      alive();accept(response.status,'200');if(response.status==='200')adopt(response.body,pending.saved);
    });},
    dismissObsCut(){return action(async()=>{
      const current=state();
      if(!current.session||!canDismissObsCut(current))return;
      try{
        const key=keyFor(current.session);
        if(!storage)throw new Error('storage');storage.removeItem(key);
        if(storage.getItem(key)!==null)throw new Error('storage');
      }catch{return fail('recovery_cleanup');}
      publish({obsCommand:null});
    });},
  }};
}
