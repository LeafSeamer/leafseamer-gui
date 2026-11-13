import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {SessionManager,Site,Snapshot} from './session.ts';
function Review({state,manager,copy}:{state:Snapshot;manager:SessionManager;copy:Copy}){
 const [reviewed,setReviewed]=useState(false),candidate=state.bindingCandidate!;
 const inputs=candidate.bundle.bindings.filter(b=>b.kind==='input'),actions=candidate.bundle.bindings.filter(b=>b.kind==='action');
 return <div className="binding-review"><h3>{copy.bindingCandidate}</h3><p>{copy.bindingCandidateHint}</p>
  <dl className="facts"><div className="fact"><dt>{copy.bindingInputs}</dt><dd>{inputs.length}</dd></div><div className="fact"><dt>{copy.capabilityActions}</dt><dd>{actions.length}</dd></div></dl>
  <p className="capability-qualification">{actions.length&&actions.every(b=>b.kind==='action'&&b.value.footprint.complete)?copy.footprintComplete:copy.footprintIncomplete}</p>
  <details className="binding-document"><summary>{copy.bindingDocument}</summary><pre>{JSON.stringify(candidate.bundle,null,2)}</pre></details>
  <label className="binding-check"><input type="checkbox" checked={reviewed} disabled={state.busy||!!state.bindingPreparation||!!state.bindingRecovery} onChange={e=>setReviewed(e.target.checked)}/>{copy.bindingReviewed}</label>
  <button className="primary" disabled={!reviewed||state.busy||!!state.bindingPreparation||!!state.bindingRecovery} onClick={()=>manager.prepareBindingApproval()}>{copy.prepareBindingApproval}</button>
 </div>;
}
export function BindingPane({site,state,manager,copy}:{site:Site;state:Snapshot;manager:SessionManager;copy:Copy}){
 const configured=site.seamer?.binding_source,[device,setDevice]=useState(configured?.devices[0]?.device_id??''),[approval,setApproval]=useState('');
 const current=state.bindingApproval,pending=state.bindingPreparation,canRead=!!state.draft&&!state.draftHistorical;
 return <section className="binding-pane"><h2>{copy.bindingTitle}</h2><p className="muted">{copy.bindingHint}</p>
  {state.bindingRecovery&&<aside className="notice" role="status"><p>{copy.bindingUnknown}</p><p>{copy.draftRequestId}: {state.bindingRecovery.request_id}</p><button className="primary" disabled={state.busy} onClick={()=>void manager.lookupBindingRequest()}>{copy.lookupBindingRequest}</button></aside>}
  {!configured?<p className="muted">{copy.bindingUnconfigured}</p>:<form className="binding-source" onSubmit={e=>{e.preventDefault();void manager.readBindingCandidate(device);}}>
   <label htmlFor="binding-device">{copy.bindingDevice}</label><select id="binding-device" value={device} disabled={state.busy||!!state.bindingRecovery} onChange={e=>{setDevice(e.target.value);manager.clearBindingCandidate();}}>{configured.devices.map(d=><option key={d.device_id} value={d.device_id}>{d.label}</option>)}</select>
   <button className="primary" disabled={!canRead||!device||state.busy||!!state.bindingRecovery}>{copy.readBindingCandidate}</button>{!canRead&&<p className="muted">{copy.bindingNeedsDraft}</p>}
  </form>}
  {state.bindingCandidate&&<Review key={state.bindingCandidate.definition_id+state.bindingCandidate.bundle_digest} state={state} manager={manager} copy={copy}/>}
  {pending&&<aside className="notice binding-confirm" role="status"><h3>{pending.operation==='approve'?copy.confirmBindingApproval:copy.confirmBindingRevocation}</h3><p>{pending.operation==='approve'?copy.bindingConfirmHint:copy.bindingRevokeHint}</p><p>{copy.definitionId}: {pending.definition_id}</p>
   <div className="actions"><button className="primary" disabled={state.busy||!!state.bindingRecovery} onClick={()=>void manager.confirmBindingChange()}>{pending.operation==='approve'?copy.confirmBindingApproval:copy.confirmBindingRevocation}</button><button disabled={state.busy} onClick={()=>manager.cancelBindingPreparation()}>{copy.cancelPreparation}</button></div>
  </aside>}
  <form className="binding-source" onSubmit={e=>{e.preventDefault();if(state.draft)void manager.readBindingApproval(state.draft.definition_id,approval);}}><label htmlFor="binding-approval-id">{copy.bindingApprovalId}</label><input id="binding-approval-id" value={approval} onChange={e=>setApproval(e.target.value)} maxLength={36} disabled={state.busy}/><button disabled={state.busy||!approval||!state.draft}>{copy.readBindingApproval}</button></form>
  {current&&<div className="binding-current"><h3>{state.bindingHistorical?copy.bindingHistorical:copy.bindingCurrent}</h3><p className="binding-state" role="status">{current.state==='approved'?copy.bindingApproved:copy.bindingRevoked}</p>
   {state.bindingHistorical&&<p className="muted">{copy.bindingHistoricalHint}</p>}<dl className="facts"><div className="fact"><dt>{copy.bindingApprovalId}</dt><dd>{current.approval_ref.id}</dd></div><div className="fact"><dt>{copy.definitionId}</dt><dd>{current.definition_id}</dd></div><div className="fact"><dt>{copy.commandRevision}</dt><dd>{current.approval_ref.revision}</dd></div></dl>
   <div className="actions"><button disabled={state.busy} onClick={()=>void manager.readBindingApproval(current.definition_id,current.approval_ref.id)}>{copy.readBindingApproval}</button><button disabled={state.busy||state.bindingHistorical||current.state!=='approved'||!!state.bindingRecovery||!!pending} onClick={()=>manager.prepareBindingRevocation()}>{copy.prepareBindingRevocation}</button></div>
   <details className="binding-document"><summary>{copy.bindingApprovedDocument}</summary><pre>{JSON.stringify(current.bundle,null,2)}</pre></details>
  </div>}
 </section>;
}
