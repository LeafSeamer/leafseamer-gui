import {PublicationPreparation,PublicationPane} from './PublicationPane.tsx';
import {BindingPane} from './BindingPane.tsx';
import {BindingSelectionEditor} from './BindingSelectionEditor.tsx';
import {StepEditor} from './StepEditor.tsx';
import {ActionParameterEditor} from './ActionParameterEditor.tsx';
import {RunPane} from './RunPane.tsx';
import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {SessionManager,Site,Snapshot} from './session.ts';
import type {DraftConflict,DraftRecord} from './draft-actions.ts';

const documentText=(draft:DraftRecord|null)=>draft?JSON.stringify(draft.content,null,2):'';

function DraftComparison({label,content,metadata,revision,metadataRevision,copy}:{
 label:string;content:string;metadata:string;revision?:string;metadataRevision?:string;copy:Copy;
}){
 const [opened,setOpened]=useState(false);
 return <section className="draft-comparison">
  <h3>{label}</h3>
  {revision&&<p>{copy.draftRevision} {revision} · {copy.metadataRevision} {metadataRevision}</p>}
  <details onToggle={event=>setOpened(event.currentTarget.open)}><summary>{copy.draftConflictShow}</summary>
   {opened&&<><h4>{copy.draftContent}</h4><pre>{content}</pre><h4>{copy.draftConflictMetadataLabel}</h4><pre>{metadata}</pre></>}
  </details>
 </section>;
}

function DraftConflictPane({conflict,contentBase,metadataBase,content,metadata,copy,disabled,onRead,onResolve}:{
 conflict:DraftConflict;contentBase:DraftRecord;metadataBase:DraftRecord;content:string;metadata:DraftRecord['metadata'];copy:Copy;
 disabled:boolean;onRead:()=>void;onResolve:(keepEdits:boolean)=>void;
}){
 const {current,operation}=conflict;
 return <section className="notice draft-conflict">
  <h2>{operation==='updateDraft'?copy.draftConflictContent:copy.draftConflictMetadata}</h2>
  <p>{copy.draftConflictHint}</p>
  <div className="draft-comparisons">
   <DraftComparison label={copy.draftConflictBase} revision={contentBase.revision} metadataRevision={metadataBase.metadata_revision} content={documentText(contentBase)}
    metadata={JSON.stringify(metadataBase.metadata,null,2)} copy={copy}/>
   {current&&<DraftComparison label={copy.draftConflictCurrent} revision={current.revision} metadataRevision={current.metadata_revision} content={documentText(current)}
    metadata={JSON.stringify(current.metadata,null,2)} copy={copy}/>}
   <DraftComparison label={copy.draftConflictLocal} content={content} metadata={JSON.stringify(metadata,null,2)} copy={copy}/>
  </div>
  <div className="actions">
   <button disabled={disabled} onClick={onRead}>{copy.draftConflictRead}</button>
   {current&&<><button className="primary" disabled={disabled} onClick={()=>onResolve(true)}>{copy.draftConflictKeep}</button>
    <button disabled={disabled} onClick={()=>onResolve(false)}>{copy.draftConflictDiscard}</button></>}
  </div>
 </section>;
}

function DraftEditor({site,manager,state,copy}:{site:Site;manager:SessionManager;state:Snapshot;copy:Copy}){
 const draft=state.draft;
 const [metadataEdit,setMetadataEdit]=useState<{base:DraftRecord|null;name?:string;description?:string}|null>(null);
 const [contentEdit,setContentEdit]=useState<{base:DraftRecord|null;text:string}|null>(null),[fileError,setFileError]=useState(false);
 const savedContent=documentText(draft),metadataBase=metadataEdit?.base??draft;
 const content=contentEdit?.text??savedContent;
 const name=metadataEdit?.name??metadataBase?.metadata.name??'',description=metadataEdit?.description??metadataBase?.metadata.description??'';
 const blocked=state.busy||!!state.draftRecovery||state.draftHistorical,disabled=blocked||!!state.draftConflict;
 const setContent=(text:string)=>setContentEdit(edit=>({base:edit?.base??draft,text}));
 function setMetadata(field:'name'|'description',value:string){
  setMetadataEdit(edit=>({...edit,base:edit?.base??draft,[field]:value}));
 }
 async function saveContent(){
  if(!draft||disabled)return;
  await manager.saveDraft(content,contentEdit?.base??undefined);
  const {draft:updated,draftRecovery}=manager.getSnapshot();
  if(updated?.definition_id===draft.definition_id&&updated.revision===(BigInt(draft.revision)+1n).toString()&&!draftRecovery)setContentEdit(null);
 }
 async function saveMetadata(){
  if(disabled)return;
  if(!draft){await manager.createDraft(content,name,description);return;}
  await manager.renameDraft(name,description,metadataEdit?.base??undefined);
  const {draft:updated,draftRecovery}=manager.getSnapshot();
  if(updated?.definition_id===draft.definition_id&&updated.metadata_revision===(BigInt(draft.metadata_revision)+1n).toString()&&!draftRecovery)setMetadataEdit(null);
 }
 function resolveConflict(keepEdits:boolean){
  const current=manager.adoptDraftConflict();if(!current)return;
  setContentEdit(edit=>keepEdits&&edit?{...edit,base:current}:null);
  setMetadataEdit(edit=>keepEdits&&edit?{...edit,base:current}:null);
 }
 return <div className="draft-editor">
 {state.draftConflict&&<DraftConflictPane conflict={state.draftConflict} contentBase={contentEdit?.base??state.draftConflict.base}
  metadataBase={metadataEdit?.base??state.draftConflict.base} content={content} metadata={{name,description,layout:metadataBase?.metadata.layout??{}}}
  copy={copy} disabled={blocked} onRead={()=>void manager.readDraftConflict()} onResolve={resolveConflict}/>}
 <section>
  <h2>{draft?copy.draftDetails:copy.createDraft}</h2>
  {draft&&<dl className="facts"><div className="fact"><dt>{copy.definitionId}</dt><dd>{draft.definition_id}</dd></div><div className="fact"><dt>{copy.draftRevision}</dt><dd>{draft.revision}</dd></div><div className="fact"><dt>{copy.metadataRevision}</dt><dd>{draft.metadata_revision}</dd></div></dl>}
  <form onSubmit={e=>{e.preventDefault();void saveMetadata();}}>
   <label htmlFor="draft-name">{copy.draftName}</label><input id="draft-name" value={name} onChange={e=>setMetadata('name',e.target.value)} required maxLength={256} disabled={disabled}/>
   <label htmlFor="draft-description">{copy.draftDescription}</label><textarea id="draft-description" rows={3} value={description} onChange={e=>setMetadata('description',e.target.value)} maxLength={4096} disabled={disabled}/>
   <button className="primary" disabled={disabled||!name.trim()||!draft&&!content}>{draft?copy.saveMetadata:copy.createDraft}</button>
  </form>
 </section><section>
  <h2>{copy.draftContent}</h2><p className="muted">{copy.draftContentHint}</p>
  <label className="draft-import">{copy.importDraft}<input type="file" accept=".json,application/json" disabled={disabled} onChange={async e=>{
   const file=e.target.files?.[0];e.target.value='';if(!file)return;
   try{if(file.size>4194304)throw new Error('size');const text=await file.text();setContent(text);setFileError(false);}catch{setFileError(true);}
  }}/></label>
  {fileError&&<p role="alert">{copy.invalid_draft}</p>}
  <label htmlFor="draft-content">{copy.definitionDocument}</label><textarea className="draft-code" id="draft-content" rows={18} spellCheck={false} value={content} onChange={e=>setContent(e.target.value)} disabled={disabled}/>
  {draft&&<button className="primary" disabled={disabled||!content} onClick={()=>void saveContent()}>{copy.saveDraftContent}</button>}
 </section><BindingPane site={site} state={state} manager={manager} copy={copy}/>
 <BindingSelectionEditor text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <StepEditor key={'steps:'+draft?.revision} text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <ActionParameterEditor key={'parameters:'+draft?.revision} text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <PublicationPreparation manager={manager} state={state} copy={copy} dirty={!!state.draftConflict||!!draft&&(content!==savedContent||name!==draft.metadata.name||description!==draft.metadata.description)}/></div>;
}
export function DraftPane({site,manager,state,copy}:{site:Site;manager:SessionManager;state:Snapshot;copy:Copy}){
 const [definition,setDefinition]=useState('');
 if(!site.seamer)return <section className="empty-service"><h1>{copy.noAutomation}</h1><p className="muted">{copy.noAutomationHint}</p></section>;
 return <section className="draft-pane"><div className="heading"><h1>{copy.automationDrafts}</h1><button disabled={state.busy||!!state.draftRecovery||!!state.draftConflict} onClick={()=>manager.newDraft()}>{copy.newDraft}</button></div>
  <p>{site.seamer.service_label}</p><p className="muted">{copy.draftHint}</p>
  <RunPane manager={manager} state={state} copy={copy}/>
  <form className="command-search" onSubmit={e=>{e.preventDefault();void manager.readDraft(definition);}}><label htmlFor="definition-id">{copy.definitionId}</label>
   <input id="definition-id" value={definition} onChange={e=>setDefinition(e.target.value)} required maxLength={256}/><button className="primary" disabled={state.busy||!!state.draftConflict||!definition}>{copy.lookup}</button></form>
  {state.draftRecovery&&<aside className="notice" role="status"><p>{copy.draftUnknown}</p><p>{copy.draftRequestId}: {state.draftRecovery.lookup.idempotency_key}</p>
   <button className="primary" disabled={state.busy} onClick={()=>void manager.lookupDraftRequest()}>{copy.lookupDraftRequest}</button></aside>}
  {state.draftHistorical&&<aside className="notice"><p>{copy.draftHistoricalHint}</p><button className="primary" disabled={state.busy} onClick={()=>void manager.readDraft(state.draft!.definition_id)}>{copy.readCurrentDraft}</button></aside>}
  <DraftEditor key={state.draft?[state.draft.definition_id,state.draftHistorical].join(':'):'new'} site={site} manager={manager} state={state} copy={copy}/>
  <PublicationPane key={[state.draft?.definition_id,state.publishedVersion?.definition_id,state.publishedVersion?.definition_version].join(':')} site={site} manager={manager} state={state} copy={copy}/>
 </section>;
}
