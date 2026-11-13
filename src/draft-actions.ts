import {contractSelection,prepareDraftChange} from '@leafseamer/sdk';
import type {BrowserSessionClient,DraftChangeOperation,Inputs,Results} from '@leafseamer/sdk';
import {validateAutomationModel,digestAutomationValue} from '@leafseamer/sdk/automation-program';
import type {Notice,Session,Site,Snapshot} from './session.ts';
import type {RecoveryStorage} from './control-actions.ts';
import {createDirectedToken} from './directed-token.ts';
export type DraftRecord=Extract<Results['seamer']['getDraft'],{status:'200'}>['body'];
type Content=Inputs['seamer']['createDefinition']['body']['content'];
type Metadata=Inputs['seamer']['createDefinition']['body']['metadata'];
export type PublishedVersion=Extract<Results['seamer']['publishDefinition'],{status:'201'}>['body'];
export type PublicationPreparation=Readonly<{definition_id:string;revision:string;content_digest:string;selection_digest:string}>;
export type PublicationHistory=Readonly<{definition_id:string;definition_version:string;artifact:Extract<Results['seamer']['getPublishedArtifact'],{status:'200'}>['body'];program:Extract<Results['seamer']['getCompiledProgram'],{status:'200'}>['body'];read_at:string}>;
export type PublicationProof=Readonly<{ref:PublicationHistory['artifact']['proof_refs'][number];value:Extract<Results['seamer']['getIndependenceProof'],{status:'200'}>['body']}>;
export type DraftRecovery=Readonly<{format:'leafseamer.gui.draft-request/1'|'leafseamer.gui.draft-request/2';publication?:PublicationPreparation;scope:DraftRecord['scope'];actor:Pick<Session,'issuer_id'|'issuer_epoch'|'principal_id'>;
 request_epoch:string;definition_id:string|null;lookup:Inputs['seamer']['lookupAutomationRequest']['body'];request_digest:string}>;
const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256&&/^[A-Za-z0-9._:/-]+$/.test(v);
const exact=(v:object,keys:string)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
export function createDraftActions({site,client,storage,state,publish,action,accept,fail}:{site:Site;client:BrowserSessionClient;storage:RecoveryStorage|null;state:()=>Snapshot;
 publish:(patch:Partial<Snapshot>)=>void;action:(run:(alive:()=>void)=>Promise<void>)=>Promise<void>;accept:(status:string,expected:string)=>void;fail:(code:Notice)=>never}){
 const target=site.seamer,remote=target?client.createDraftClient({baseUrl:target.base_url,audience:target.service_id}):null;
 let corrupt=false;
 const scope=target?{authority_service_id:target.service_id,database_instance_id:target.database_instance_id}:null;
 const sameScope=(value:DraftRecord['scope'])=>!!scope&&value.authority_service_id===scope.authority_service_id&&value.database_instance_id===scope.database_instance_id;
 const actor=(s:Session)=>({issuer_id:s.issuer_id,issuer_epoch:s.issuer_epoch,principal_id:s.principal_id});
 const sameActor=(a:DraftRecovery['actor'],s:Session)=>a.issuer_id===s.issuer_id&&a.issuer_epoch===s.issuer_epoch&&a.principal_id===s.principal_id;
 const key=(s:Session)=>'leafseamer.draft-request.v1:'+JSON.stringify([scope?.authority_service_id,scope?.database_instance_id,s.issuer_id,s.issuer_epoch,s.principal_id]);
 const ready=()=>{if(!target||!remote||!state().session)return fail('unavailable');return remote;};
 const directedToken=createDirectedToken({ready,session:()=>state().session,accept});
 function restore(session:Session){
  directedToken.reset();corrupt=false;if(!target)return;
  try{
   const raw=storage?.getItem(key(session));if(!raw)return;if(raw.length>8192)throw new Error('shape');const v=JSON.parse(raw) as DraftRecovery;
   if(!exact(v,v.format==='leafseamer.gui.draft-request/2'?'actor,definition_id,format,lookup,publication,request_digest,request_epoch,scope':'actor,definition_id,format,lookup,request_digest,request_epoch,scope')||!['leafseamer.gui.draft-request/1','leafseamer.gui.draft-request/2'].includes(v.format)||!exact(v.scope,'authority_service_id,database_instance_id')||!sameScope(v.scope)||
    !exact(v.actor,'issuer_epoch,issuer_id,principal_id')||!sameActor(v.actor,session)||!id(v.request_epoch)||!exact(v.lookup,'context_id,idempotency_key,operation_id')||
    !Object.values(v.lookup).every(id)||!['createDefinition','updateDraft','updateDefinitionMetadata','publishDefinition'].includes(v.lookup.operation_id)||
    (v.lookup.operation_id==='createDefinition'?v.definition_id!==null:!id(v.definition_id))||!/^sha256:[0-9a-f]{64}$/.test(v.request_digest))throw new Error('shape');
   if(v.lookup.operation_id==='publishDefinition'){
    const p=v.publication;if(v.format!=='leafseamer.gui.draft-request/2'||!p||!exact(p,'content_digest,definition_id,revision,selection_digest')||p.definition_id!==v.definition_id||!/^[1-9][0-9]{0,19}$/.test(p.revision)||![p.content_digest,p.selection_digest].every(value=>/^sha256:[0-9a-f]{64}$/.test(value)))throw new Error('shape');
   }else if(v.format!=='leafseamer.gui.draft-request/1')throw new Error('shape');
   publish({draftRecovery:v});
  }catch{corrupt=true;publish({notice:'recovery_unavailable'});}
 }
 function save(value:DraftRecovery){
  const s=state().session!;try{if(!storage)throw new Error('storage');const text=JSON.stringify(value);storage.setItem(key(s),text);if(storage.getItem(key(s))!==text)throw new Error('storage');}
  catch{fail('recovery_unavailable');}publish({draftRecovery:value});
 }
 function finish(){try{if(!storage)throw new Error('storage');storage.removeItem(key(state().session!));if(storage.getItem(key(state().session!))!==null)throw new Error('storage');}catch{fail('recovery_cleanup');}publish({draftRecovery:null});}
 const token=directedToken.ensure;
 function record(value:DraftRecord,expected:string|null){if(!sameScope(value.scope)||expected!==null&&value.definition_id!==expected)fail('incompatible');return value;}
 function parse(text:string):Content{try{if(new TextEncoder().encode(text).length>4194304)throw new Error('size');const v=JSON.parse(text);validateAutomationModel('LifecycleDraftContent',v);return v;}catch{return fail('invalid_draft');}}
 async function write(operation:Exclude<DraftChangeOperation,'publishDefinition'>,text:string|null,metadata:Metadata|null,alive:()=>void){
  if(corrupt)fail('recovery_unavailable');if(state().draftRecovery)fail('draft_pending');
  publish({publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null});
  const draft=state().draft;if(operation!=='createDefinition'&&(!draft||state().draftHistorical))fail('stale');
  const content=text===null?null:parse(text);
  try{if(metadata)validateAutomationModel('LifecycleDefinitionMetadata',metadata);}catch{fail('invalid_draft');}
  await token(['definition.edit','definition.read','request.create','request.read'],alive);
  const response=await ready().createRequestContext({operations:[operation,'getDraft'],ttl_ms:60000,max_unique_requests:1});alive();accept(response.status,'201');if(response.status!=='201')return;
  const context=response.body.data,s=state().session!;
  if(response.body.service_id!==target!.service_id||context.service_id!==target!.service_id||context.audience!==target!.service_id||!sameActor(context,s)||
   context.selection.contract_id!==contractSelection.contract_id||context.selection.contract_digest!==contractSelection.contract_digest)fail('incompatible');
  const requestContext={context_id:context.context_id,idempotency_key:crypto.randomUUID()};
  const prepared=await prepareDraftChange(operation==='createDefinition'?{operation,definition_id:null,scope:scope!,context,body:{context:requestContext,content:content!,metadata:metadata!}}:
   operation==='updateDraft'?{operation,definition_id:draft!.definition_id,scope:scope!,context,body:{context:requestContext,expected_draft_revision:draft!.revision,content:content!}}:
   {operation,definition_id:draft!.definition_id,scope:scope!,context,body:{context:requestContext,expected_metadata_revision:draft!.metadata_revision,metadata:metadata!}});alive();
  if(prepared.operation==='publishDefinition')return fail('incompatible');
  save({format:'leafseamer.gui.draft-request/1',scope:scope!,actor:actor(s),request_epoch:context.context_epoch,definition_id:prepared.definition_id,lookup:prepared.lookup,request_digest:prepared.request_digest});
  const result=prepared.operation==='createDefinition'?await ready().createDefinition(prepared.body):prepared.operation==='updateDraft'?await ready().updateDraft(prepared.definition_id,prepared.body):await ready().updateDefinitionMetadata(prepared.definition_id,prepared.body);
  alive();accept(result.status,operation==='createDefinition'?'201':'200');if(result.status!=='200'&&result.status!=='201')return;
  const value=record(result.body,prepared.definition_id);
  if(operation==='createDefinition'?(value.revision!=='1'||value.metadata_revision!=='1'):operation==='updateDraft'?BigInt(value.revision)!==BigInt(draft!.revision)+1n:BigInt(value.metadata_revision)!==BigInt(draft!.metadata_revision)+1n)fail('incompatible');
  publish({draft:value,draftHistorical:false});finish();
 }
 function published(value:PublishedVersion,definition:string,revision?:string){
  if(!sameScope(value.scope)||value.definition_id!==definition||!sameScope(value.artifact_ref.scope)||value.artifact_ref.kind!=='artifact'||revision!==undefined&&value.source_draft_revision!==revision)fail('incompatible');return value;
 }
 return {restore,api:{
  readDraft(definition:string){return action(async alive=>{if(!id(definition))fail('invalid_draft');publish({draft:null,draftHistorical:false,publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null});await token(['definition.read'],alive);const response=await ready().getDraft(definition);alive();accept(response.status,'200');if(response.status==='200')publish({draft:record(response.body,definition)});});},
  newDraft(){if(!state().busy&&!state().draftRecovery)publish({draft:null,draftHistorical:false,publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null,notice:null});},
  createDraft(text:string,name:string,description:string){return action(alive=>write('createDefinition',text,{name,description,layout:{}},alive));},
  saveDraft(text:string){return action(alive=>write('updateDraft',text,null,alive));},
  renameDraft(name:string,description:string){return action(alive=>write('updateDefinitionMetadata',null,{name,description,layout:state().draft?.metadata.layout??{}},alive));},
  preparePublication(){return action(async()=>{
   if(corrupt)fail('recovery_unavailable');if(state().draftRecovery)fail('draft_pending');const draft=state().draft;if(!draft||state().draftHistorical)return fail('stale');
   publish({publicationPreparation:{definition_id:draft.definition_id,revision:draft.revision,content_digest:draft.content_digest,selection_digest:draft.selection_digest},publishedVersion:null,publicationHistory:null,publicationProof:null});
  });},
  cancelPublication(){if(!state().busy)publish({publicationPreparation:null});},
  confirmPublication(){return action(async alive=>{
   if(corrupt)fail('recovery_unavailable');if(state().draftRecovery)fail('draft_pending');
   const selected=state().publicationPreparation,draft=state().draft;
   if(!selected||!draft||state().draftHistorical||selected.definition_id!==draft.definition_id||selected.revision!==draft.revision||selected.content_digest!==draft.content_digest||selected.selection_digest!==draft.selection_digest)return fail('stale');
   await token(['definition.publish','definition.read','request.create','request.read'],alive);
   const response=await ready().createRequestContext({operations:['publishDefinition','getDraft'],ttl_ms:60000,max_unique_requests:1});alive();accept(response.status,'201');if(response.status!=='201')return;
   const context=response.body.data,s=state().session!;
   if(response.body.service_id!==target!.service_id||context.service_id!==target!.service_id||context.audience!==target!.service_id||!sameActor(context,s)||context.selection.contract_id!==contractSelection.contract_id||context.selection.contract_digest!==contractSelection.contract_digest)fail('incompatible');
   const prepared=await prepareDraftChange({operation:'publishDefinition',definition_id:selected.definition_id,scope:scope!,context,body:{context:{context_id:context.context_id,idempotency_key:crypto.randomUUID()},expected_draft_revision:selected.revision,expected_content_digest:selected.content_digest,expected_selection_digest:selected.selection_digest}});alive();if(prepared.operation!=='publishDefinition')return fail('incompatible');
   save({format:'leafseamer.gui.draft-request/2',scope:scope!,actor:actor(s),request_epoch:context.context_epoch,definition_id:selected.definition_id,lookup:prepared.lookup,request_digest:prepared.request_digest,publication:selected});publish({publicationPreparation:null});
   const result=await ready().publishDefinition(selected.definition_id,prepared.body);alive();accept(result.status,'201');if(result.status!=='201')return;
   const value=published(result.body,selected.definition_id,selected.revision);if(value.published_by!==s.principal_id)fail('incompatible');publish({publishedVersion:value});finish();
  });},
  readPublication(definition:string,version:string){return action(async alive=>{
   publish({publicationHistory:null,publicationProof:null});if(!id(definition)||!/^[1-9][0-9]{0,19}$/.test(version))fail('invalid_draft');
   await token(['definition.read'],alive);const artifactResponse=await ready().getPublishedArtifact(definition,version);alive();accept(artifactResponse.status,'200');if(artifactResponse.status!=='200')return;
   const programResponse=await ready().getCompiledProgram(definition,version);alive();accept(programResponse.status,'200');if(programResponse.status!=='200')return;
   const artifact=artifactResponse.body,program=programResponse.body;if(program.definition_id!==definition||program.definition_version!==version)fail('incompatible');
   const {manifest_digest,...manifest}=artifact;
   const [manifestHash,programHash,bindingsHash]=await Promise.all([digestAutomationValue(manifest),digestAutomationValue(program),digestAutomationValue({input_bindings:program.input_bindings,action_bindings:program.action_bindings,alias_table:program.alias_table})]);alive();
   if(manifestHash!==manifest_digest||programHash!==artifact.program_digest||bindingsHash!==artifact.bindings_digest)fail('incompatible');
   const expected=state().publishedVersion;if(expected&&expected.definition_id===definition&&expected.definition_version===version&&(expected.artifact_ref.object_id!==artifact.artifact_id||expected.artifact_ref.digest!==manifest_digest||expected.program_digest!==programHash||expected.bindings_digest!==bindingsHash))fail('incompatible');
   publish({publicationHistory:{definition_id:definition,definition_version:version,artifact,program,read_at:new Date().toISOString()}});
  });},
  readPublicationProof(proofId:string){return action(async alive=>{
   publish({publicationProof:null});const history=state().publicationHistory,ref=history?.artifact.proof_refs.find(value=>value.id===proofId);if(!history||!ref)return fail('stale');
   await token(['definition.read'],alive);const response=await ready().getIndependenceProof(history.definition_id,ref.id,ref.revision);alive();accept(response.status,'200');if(response.status!=='200')return;
   const proof=response.body,hash=await digestAutomationValue(proof);alive();
   if(hash!==ref.digest||proof.program_digest!==history.artifact.program_digest||proof.bindings_digest!==history.artifact.bindings_digest||proof.graph_digest!==history.program.graph_digest||state().publicationHistory!==history)fail('incompatible');publish({publicationProof:{ref,value:proof}});
  });},
  lookupDraftRequest(){return action(async alive=>{
   const saved=state().draftRecovery;if(!saved)return fail('draft_pending');await token(['request.read','definition.read'],alive);
   const result=await ready().lookupAutomationRequest(saved.lookup);alive();if(result.status==='404')fail('draft_not_found');accept(result.status,'200');if(result.status!=='200')return;
   if(result.body.operation_id!==saved.lookup.operation_id||result.body.request_digest!==saved.request_digest)return fail('incompatible');
   if(saved.lookup.operation_id==='publishDefinition'){
    if(result.body.result.kind!=='PublishedVersion'||!saved.definition_id||!saved.publication)return fail('incompatible');const value=published(result.body.result.value,saved.definition_id,saved.publication.revision);if(value.published_by!==saved.actor.principal_id)fail('incompatible');
    publish({draft:null,draftHistorical:false,publicationPreparation:null,publishedVersion:value,publicationHistory:null,publicationProof:null});
   }else{if(result.body.result.kind!=='DraftRecord')return fail('incompatible');publish({draft:record(result.body.result.value,saved.definition_id),draftHistorical:true,publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null});}finish();
  });}
 }};
}
