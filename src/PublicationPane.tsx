import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {SessionManager,Site,Snapshot} from './session.ts';
import {runSource} from './draft-actions.ts';

export function PublicationPreparation({manager,state,copy,dirty}:{manager:SessionManager;state:Snapshot;copy:Copy;dirty:boolean}){
 const draft=state.draft,prepared=state.publicationPreparation;
 if(!draft)return null;
 const disabled=state.busy||!!state.draftRecovery||state.draftHistorical||dirty;
 return <section className="publication-prepare"><h2>{copy.publishDefinition}</h2><p className="muted">{copy.publicationHint}</p>
  {dirty&&<p role="status">{copy.publicationSaveFirst}</p>}
  {prepared?<div className="notice"><p>{copy.publicationPrepared}</p><dl className="facts">
   <div className="fact"><dt>{copy.definitionId}</dt><dd>{prepared.definition_id}</dd></div><div className="fact"><dt>{copy.draftRevision}</dt><dd>{prepared.revision}</dd></div>
   <div className="fact"><dt>{copy.contentDigest}</dt><dd>{prepared.content_digest}</dd></div><div className="fact"><dt>{copy.selectionDigest}</dt><dd>{prepared.selection_digest}</dd></div>
  </dl><div className="actions"><button className="primary" disabled={disabled} onClick={()=>void manager.confirmPublication()}>{copy.confirmPublication}</button><button disabled={state.busy} onClick={()=>manager.cancelPublication()}>{copy.cancelPreparation}</button></div></div>:
   <button className="primary" disabled={disabled} onClick={()=>void manager.preparePublication()}>{copy.preparePublication}</button>}
 </section>;
}
function ProofReader({manager,state,copy}:{manager:SessionManager;state:Snapshot;copy:Copy}){
 const [selected,setSelected]=useState(''),history=state.publicationHistory!,proof=state.publicationProof?.ref.id===selected?state.publicationProof.value:null;
 if(!history.artifact.proof_refs.length)return <p>{copy.noPublicationProofs}</p>;
 return <div><form className="command-search" onSubmit={event=>{event.preventDefault();void manager.readPublicationProof(selected);}}>
  <label htmlFor="publication-proof">{copy.publicationProof}</label><select id="publication-proof" value={selected} onChange={event=>setSelected(event.target.value)} disabled={state.busy} required>
   <option value="">{copy.chooseProof}</option>{history.artifact.proof_refs.map(ref=><option key={ref.id} value={ref.id}>{ref.id} · {ref.revision}</option>)}
  </select><button disabled={state.busy||!selected}>{copy.lookup}</button>
 </form>{proof&&<dl className="facts"><div className="fact"><dt>{copy.proofStep}</dt><dd>{proof.failed_step_id}</dd></div><div className="fact"><dt>{copy.proofVerdict}</dt><dd>{proof.verdict==='independent'?copy.proofIndependent:copy.proofUnconfirmed}</dd></div><div className="fact"><dt>{copy.proofSuccessors}</dt><dd>{proof.successor_step_ids.length}</dd></div></dl>}</div>;
}
export function PublicationPane({site,manager,state,copy}:{site:Site;manager:SessionManager;state:Snapshot;copy:Copy}){
 const published=state.publishedVersion,history=state.publicationHistory;
 const source=runSource(state,site),receipt=state.runView?.source==='creation'?state.runView.record:null;
 const showReceipt=receipt&&(!source||receipt.definition_id===source.definition_id&&receipt.definition_version===source.definition_version);
 const [definition,setDefinition]=useState(published?.definition_id??state.draft?.definition_id??''),[version,setVersion]=useState(published?.definition_version??'');
 return <section className="publication-history"><h2>{copy.publicationHistory}</h2>
  {published&&<aside className="notice" role="status"><p>{copy.publicationSaved}</p><dl className="facts"><div className="fact"><dt>{copy.definitionId}</dt><dd>{published.definition_id}</dd></div><div className="fact"><dt>{copy.publicationVersion}</dt><dd>{published.definition_version}</dd></div><div className="fact"><dt>{copy.draftRevision}</dt><dd>{published.source_draft_revision}</dd></div></dl></aside>}
  <p className="muted">{copy.publicationHistoryHint}</p>
  <form className="command-search" onSubmit={event=>{event.preventDefault();void manager.readPublication(definition,version);}}><label htmlFor="publication-definition">{copy.definitionId}</label>
   <input id="publication-definition" value={definition} onChange={event=>setDefinition(event.target.value)} required maxLength={256}/><label htmlFor="publication-version">{copy.publicationVersion}</label>
   <input id="publication-version" value={version} onChange={event=>setVersion(event.target.value)} required inputMode="numeric" pattern="[1-9][0-9]{0,19}" maxLength={20}/><button className="primary" disabled={state.busy||!definition||!version}>{copy.readPublication}</button>
  </form>
  {history&&<div><dl className="facts"><div className="fact"><dt>{copy.definitionId}</dt><dd>{history.definition_id}</dd></div><div className="fact"><dt>{copy.publicationVersion}</dt><dd>{history.definition_version}</dd></div>
   <div className="fact"><dt>{copy.programDigest}</dt><dd>{history.artifact.program_digest}</dd></div><div className="fact"><dt>{copy.bindingsDigest}</dt><dd>{history.artifact.bindings_digest}</dd></div><div className="fact"><dt>{copy.artifactDigest}</dt><dd>{history.artifact.manifest_digest}</dd></div>
   <div className="fact"><dt>{copy.lastRead}</dt><dd>{history.read_at}</dd></div></dl><ProofReader key={history.artifact.manifest_digest} manager={manager} state={state} copy={copy}/></div>}
  {source&&<button className="primary" disabled={state.busy||!!state.draftRecovery} onClick={()=>void manager.createRun(source)}>{copy.createDisarmedRun}</button>}
  {showReceipt&&<p role="status">{copy.runCreated} <a href="#run-heading">{receipt.run_id}</a></p>}
 </section>;
}
