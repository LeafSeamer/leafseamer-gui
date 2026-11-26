import {PublicationPreparation,PublicationPane} from './PublicationPane.tsx';
import {BindingPane} from './BindingPane.tsx';
import {BindingSelectionEditor} from './BindingSelectionEditor.tsx';
import {StepEditor} from './StepEditor.tsx';
import {ActionParameterEditor} from './ActionParameterEditor.tsx';
import {RunPane} from './RunPane.tsx';
import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {SessionManager,Site,Snapshot} from './session.ts';
function DraftEditor({site,manager,state,copy}:{site:Site;manager:SessionManager;state:Snapshot;copy:Copy}){
 const draft=state.draft;
 const [name,setName]=useState(draft?.metadata.name??''),[description,setDescription]=useState(draft?.metadata.description??'');
 const [content,setContent]=useState(draft?JSON.stringify(draft.content,null,2):''),[fileError,setFileError]=useState(false);
 const disabled=state.busy||!!state.draftRecovery||state.draftHistorical;
 return <div className="draft-editor"><section>
  <h2>{draft?copy.draftDetails:copy.createDraft}</h2>
  {draft&&<dl className="facts"><div className="fact"><dt>{copy.definitionId}</dt><dd>{draft.definition_id}</dd></div><div className="fact"><dt>{copy.draftRevision}</dt><dd>{draft.revision}</dd></div><div className="fact"><dt>{copy.metadataRevision}</dt><dd>{draft.metadata_revision}</dd></div></dl>}
  <form onSubmit={e=>{e.preventDefault();void(draft?manager.renameDraft(name,description):manager.createDraft(content,name,description));}}>
   <label htmlFor="draft-name">{copy.draftName}</label><input id="draft-name" value={name} onChange={e=>setName(e.target.value)} required maxLength={256} disabled={disabled}/>
   <label htmlFor="draft-description">{copy.draftDescription}</label><textarea id="draft-description" rows={3} value={description} onChange={e=>setDescription(e.target.value)} maxLength={4096} disabled={disabled}/>
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
  {draft&&<button className="primary" disabled={disabled||!content} onClick={()=>void manager.saveDraft(content)}>{copy.saveDraftContent}</button>}
 </section><BindingPane site={site} state={state} manager={manager} copy={copy}/>
 <BindingSelectionEditor text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <StepEditor text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <ActionParameterEditor text={content} onChange={setContent} state={state} disabled={disabled} copy={copy}/>
 <PublicationPreparation manager={manager} state={state} copy={copy} dirty={!!draft&&(content!==JSON.stringify(draft.content,null,2)||name!==draft.metadata.name||description!==draft.metadata.description)}/></div>;
}
export function DraftPane({site,manager,state,copy}:{site:Site;manager:SessionManager;state:Snapshot;copy:Copy}){
 const [definition,setDefinition]=useState('');
 if(!site.seamer)return <section className="empty-service"><h1>{copy.noAutomation}</h1><p className="muted">{copy.noAutomationHint}</p></section>;
 return <section className="draft-pane"><div className="heading"><h1>{copy.automationDrafts}</h1><button disabled={state.busy||!!state.draftRecovery} onClick={()=>manager.newDraft()}>{copy.newDraft}</button></div>
  <p>{site.seamer.service_label}</p><p className="muted">{copy.draftHint}</p>
  <RunPane manager={manager} state={state} copy={copy}/>
  <form className="command-search" onSubmit={e=>{e.preventDefault();void manager.readDraft(definition);}}><label htmlFor="definition-id">{copy.definitionId}</label>
   <input id="definition-id" value={definition} onChange={e=>setDefinition(e.target.value)} required maxLength={256}/><button className="primary" disabled={state.busy||!definition}>{copy.lookup}</button></form>
  {state.draftRecovery&&<aside className="notice" role="status"><p>{copy.draftUnknown}</p><p>{copy.draftRequestId}: {state.draftRecovery.lookup.idempotency_key}</p>
   <button className="primary" disabled={state.busy} onClick={()=>void manager.lookupDraftRequest()}>{copy.lookupDraftRequest}</button></aside>}
  {state.draftHistorical&&<aside className="notice"><p>{copy.draftHistoricalHint}</p><button className="primary" disabled={state.busy} onClick={()=>void manager.readDraft(state.draft!.definition_id)}>{copy.readCurrentDraft}</button></aside>}
  <DraftEditor key={state.draft?[state.draft.definition_id,state.draft.revision,state.draft.metadata_revision,state.draftHistorical].join(':'):'new'} site={site} manager={manager} state={state} copy={copy}/>
  <PublicationPane key={[state.draft?.definition_id,state.publishedVersion?.definition_id,state.publishedVersion?.definition_version].join(':')} manager={manager} state={state} copy={copy}/>
 </section>;
}
