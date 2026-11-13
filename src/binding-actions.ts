import {contractSelection} from '@leafseamer/sdk';
import type {BrowserSessionClient,Inputs,Results} from '@leafseamer/sdk';
import {digestAutomationValue} from '@leafseamer/sdk/automation-program';
import type {Notice,Session,Site,Snapshot} from './session.ts';
import type {RecoveryStorage} from './control-actions.ts';
import {createDirectedToken} from './directed-token.ts';
export type BindingCandidate=Extract<Results['seamer']['queryBindingCandidate'],{status:'200'}>['body']&{device_id:string};
export type BindingApproval=Extract<Results['seamer']['getBindingApproval'],{status:'200'}>['body'];
export type BindingPreparation=Readonly<{operation:'approve'|'revoke';definition_id:string;approval_id:string;bundle_digest:string}>;
export type BindingRecovery=Readonly<{format:'leafseamer.gui.binding-request/1';scope:{authority_service_id:string;database_instance_id:string};actor:{issuer_id:string;issuer_epoch:string;principal_id:string};
 operation:'approve'|'revoke';definition_id:string;approval_id:string;request_id:string;request_digest:string;bundle_digest:string}>;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^sha256:[0-9a-f]{64}$/.test(v);
const exact=(v:unknown,keys:string)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
export function createBindingActions({site,client,storage,state,publish,action,accept,fail}:{site:Site;client:BrowserSessionClient;storage:RecoveryStorage|null;state:()=>Snapshot;
 publish:(patch:Partial<Snapshot>)=>void;action:(run:(alive:()=>void)=>Promise<void>)=>Promise<void>;accept:(status:string,expected:string)=>void;fail:(code:Notice)=>never}){
 const target=site.seamer,remote=target?client.createDraftClient({baseUrl:target.base_url,audience:target.service_id}):null;
 const scope=target?{authority_service_id:target.service_id,database_instance_id:target.database_instance_id}:null;
 let corrupt=false;
 const actor=(s:Session)=>({issuer_id:s.issuer_id,issuer_epoch:s.issuer_epoch,principal_id:s.principal_id});
 const sameActor=(a:BindingRecovery['actor'],s:Session)=>a.issuer_id===s.issuer_id&&a.issuer_epoch===s.issuer_epoch&&a.principal_id===s.principal_id;
 const sameScope=(s:BindingApproval['scope'])=>!!s&&s.authority_service_id===scope?.authority_service_id&&s.database_instance_id===scope?.database_instance_id;
 const key=(s:Session)=>'leafseamer.binding-request.v1:'+JSON.stringify([scope?.authority_service_id,scope?.database_instance_id,s.issuer_id,s.issuer_epoch,s.principal_id]);
 const ready=()=>{if(!remote||!target||!state().session)return fail('unavailable');return remote;};
 const directedToken=createDirectedToken({ready,session:()=>state().session,accept});
 const writable=()=>{if(corrupt)fail('recovery_unavailable');if(state().bindingRecovery)fail('binding_pending');};
 const source=(device_id:string,expected_registration_ref:Inputs['seamer']['queryBindingCandidate']['body']['expected_registration_ref']=null):Inputs['seamer']['queryBindingCandidate']['body']=>{
  const fixed=target?.binding_source;if(!fixed||!fixed.devices.some(d=>d.device_id===device_id))return fail('unavailable');
  return {binding_id:fixed.binding_id,device_id,expected_registration_ref,scope:{format:'leafseamer.device-binding-scope/1',authority_service_id:site.service_id!,database_instance_id:site.database_instance_id!,device_ids:fixed.devices.map(d=>d.device_id).sort()}};
 };
 const token=directedToken.ensure;
 async function bundle(value:BindingApproval['bundle'],expected:string,alive:()=>void){
  if(await digestAutomationValue(value)!==expected||await digestAutomationValue(value.registration)!==value.registration_ref.digest)fail('incompatible');alive();
 }
 async function view(value:BindingApproval,definition:string,approvalId:string,alive:()=>void){
  if(!sameScope(value.scope)||value.definition_id!==definition||value.approval_ref.id!==approvalId||!['1','2'].includes(value.approval_ref.revision)||value.approval_ref.revision!==(value.state==='approved'?'1':'2'))fail('incompatible');
  await bundle(value.bundle,value.bundle_digest,alive);if(await digestAutomationValue(value.registration_ref)!==await digestAutomationValue(value.bundle.registration_ref))fail('incompatible');return value;
 }
 function restore(session:Session){
  directedToken.reset();corrupt=false;if(!target)return;
  try{const raw=storage?.getItem(key(session));if(!raw)return;if(raw.length>4096)throw new Error('size');const v=JSON.parse(raw) as BindingRecovery;
   if(!exact(v,'actor,approval_id,bundle_digest,definition_id,format,operation,request_digest,request_id,scope')||v.format!=='leafseamer.gui.binding-request/1'||!exact(v.scope,'authority_service_id,database_instance_id')||!sameScope(v.scope)||!exact(v.actor,'issuer_epoch,issuer_id,principal_id')||!sameActor(v.actor,session)||!['approve','revoke'].includes(v.operation)||![v.definition_id,v.approval_id,v.request_id].every(uuid)||![v.request_digest,v.bundle_digest].every(hash))throw new Error('shape');
   publish({bindingRecovery:v});
  }catch{corrupt=true;publish({notice:'recovery_unavailable'});}
 }
 function save(v:BindingRecovery){try{if(!storage)throw new Error('storage');const text=JSON.stringify(v);storage.setItem(key(state().session!),text);if(storage.getItem(key(state().session!))!==text)throw new Error('storage');}catch{fail('recovery_unavailable');}publish({bindingRecovery:v});}
 function finish(){try{if(!storage)throw new Error('storage');storage.removeItem(key(state().session!));if(storage.getItem(key(state().session!))!==null)throw new Error('storage');}catch{fail('recovery_cleanup');}publish({bindingRecovery:null});}
 return {restore,api:{
  clearBindingCandidate(){if(!state().busy)publish({bindingCandidate:null,bindingPreparation:null});},
  readBindingCandidate(deviceId:string){return action(async alive=>{
   publish({bindingCandidate:null,bindingPreparation:null});const draft=state().draft;if(!draft||state().draftHistorical)return fail('stale');const query=source(deviceId);
   await token(['auth.read'],alive);const r=await ready().queryBindingCandidate(draft.definition_id,query);alive();accept(r.status,'200');if(r.status!=='200')return;
   const ref=r.body.bundle.registration_ref,registration=r.body.bundle.registration;
   if(r.body.definition_id!==draft.definition_id||ref.scope.authority_service_id!==site.service_id||ref.scope.database_instance_id!==site.database_instance_id||!registration||typeof registration!=='object'||Array.isArray(registration)||!('device_id' in registration)||registration.device_id!==deviceId)fail('incompatible');
   await bundle(r.body.bundle,r.body.bundle_digest,alive);publish({bindingCandidate:{...r.body,device_id:deviceId}});
  });},
  prepareBindingApproval(){if(state().busy)return;const c=state().bindingCandidate,d=state().draft;if(!c||!d||state().draftHistorical||c.definition_id!==d.definition_id)return;publish({bindingPreparation:{operation:'approve',definition_id:d.definition_id,approval_id:crypto.randomUUID(),bundle_digest:c.bundle_digest}});},
  prepareBindingRevocation(){if(state().busy)return;const v=state().bindingApproval;if(!v||v.state!=='approved'||state().bindingHistorical)return;publish({bindingPreparation:{operation:'revoke',definition_id:v.definition_id,approval_id:v.approval_ref.id,bundle_digest:v.bundle_digest}});},
  cancelBindingPreparation(){if(!state().busy)publish({bindingPreparation:null});},
  confirmBindingChange(){return action(async alive=>{
   writable();const p=state().bindingPreparation,c=state().bindingCandidate,v=state().bindingApproval;if(!p)return fail('stale');
   if(p.operation==='approve'&&(!c||!state().draft||state().draftHistorical||state().draft!.definition_id!==p.definition_id||c.definition_id!==p.definition_id||c.bundle_digest!==p.bundle_digest)||p.operation==='revoke'&&(!v||state().bindingHistorical||v.state!=='approved'||v.approval_ref.id!==p.approval_id||v.definition_id!==p.definition_id||v.bundle_digest!==p.bundle_digest))return fail('stale');
   await token(['auth.manage','auth.read','request.create','request.read'],alive);const operation=p.operation==='approve'?'approveDefinitionBindings':'revokeBindingApproval';
   const r=await ready().createRequestContext({operations:[operation],ttl_ms:60000,max_unique_requests:1});alive();accept(r.status,'201');if(r.status!=='201')return;
   const context=r.body.data,s=state().session!;if(r.body.service_id!==target!.service_id||context.service_id!==target!.service_id||context.audience!==target!.service_id||!sameActor(context,s)||context.selection.contract_id!==contractSelection.contract_id||context.selection.contract_digest!==contractSelection.contract_digest)fail('incompatible');
   const request_id=crypto.randomUUID(),request=p.operation==='approve'?{request_id,approval_id:p.approval_id,definition_id:p.definition_id,expected_bundle_digest:p.bundle_digest}:{request_id,approval_id:p.approval_id,expected_revision:'1'};
   const request_digest=await digestAutomationValue(request);alive();save({format:'leafseamer.gui.binding-request/1',scope:scope!,actor:actor(s),operation:p.operation,definition_id:p.definition_id,approval_id:p.approval_id,request_id,request_digest,bundle_digest:p.bundle_digest});publish({bindingPreparation:null});
   const result=p.operation==='approve'?await ready().approveDefinitionBindings(p.definition_id,{context:{context_id:context.context_id},source:source(c!.device_id,c!.bundle.registration_ref),request_id,approval_id:p.approval_id,expected_bundle_digest:p.bundle_digest}):await ready().revokeBindingApproval(p.definition_id,p.approval_id,{context:{context_id:context.context_id},request_id,expected_revision:'1'});
   alive();accept(result.status,p.operation==='approve'?'201':'200');if(result.status!=='201'&&result.status!=='200')return;
   const value=await view(result.body,p.definition_id,p.approval_id,alive);if(value.bundle_digest!==p.bundle_digest||value.state!==(p.operation==='approve'?'approved':'revoked'))fail('incompatible');publish({bindingApproval:value,bindingHistorical:false});finish();
  });},
  readBindingApproval(definition:string,approvalId:string){return action(async alive=>{
   publish({bindingApproval:null,bindingPreparation:null,bindingHistorical:false});if(!uuid(definition)||!uuid(approvalId))fail('invalid_binding');await token(['auth.read'],alive);
   const r=await ready().getBindingApproval(definition,approvalId);alive();accept(r.status,'200');if(r.status==='200')publish({bindingApproval:await view(r.body,definition,approvalId,alive),bindingHistorical:false});
  });},
  lookupBindingRequest(){return action(async alive=>{
   const saved=state().bindingRecovery;if(!saved)return fail('binding_pending');await token(['auth.read','request.read'],alive);
   const r=await ready().lookupBindingApproval(saved.definition_id,{request_id:saved.request_id,request_digest:saved.request_digest});alive();accept(r.status,'200');if(r.status!=='200')return;
   if(r.body.request_id!==saved.request_id||r.body.request_digest!==saved.request_digest||r.body.definition_id!==saved.definition_id)fail('incompatible');if(!r.body.result)return fail('binding_not_found');
   const value=await view(r.body.result,saved.definition_id,saved.approval_id,alive);if(value.bundle_digest!==saved.bundle_digest||value.state!==(saved.operation==='approve'?'approved':'revoked'))fail('incompatible');publish({bindingApproval:value,bindingHistorical:true,bindingPreparation:null});finish();
  });}
 }};
}
