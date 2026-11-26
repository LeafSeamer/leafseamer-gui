import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {SessionManager,Snapshot} from './session.ts';

const lifecycleLabels={
 disarmed:'runDisarmed',armed:'runArmed',running:'runRunning',paused:'runPaused',completed:'runCompleted',
} as const;

export function RunPane({manager,state,copy}:{manager:SessionManager;state:Snapshot;copy:Copy}){
 const [runId,setRunId]=useState(()=>state.runView?.record.run_id??'');
 const view=state.runView;
 const record=view?.record;
 return <section className="publication-pane" aria-labelledby="run-heading">
  <h2 id="run-heading">{copy.runStatus}</h2>
  <form className="command-search" onSubmit={event=>{
   event.preventDefault();
   void manager.readRun(runId.trim());
  }}>
   <label htmlFor="run-id">{copy.runId}</label>
   <input id="run-id" value={runId} onChange={event=>setRunId(event.target.value)} required maxLength={256}/>
   <button className="primary" disabled={state.busy||!runId.trim()}>{copy.readRun}</button>
  </form>
  {record&&view&&<div aria-live="polite">
   <dl className="facts">
    <div className="fact"><dt>{copy.runId}</dt><dd>{record.run_id}</dd></div>
    <div className="fact"><dt>{copy.runLifecycle}</dt><dd>{copy[lifecycleLabels[record.lifecycle]]}</dd></div>
    <div className="fact"><dt>{copy.dispatchEligibility}</dt><dd>{record.dispatch_eligible?copy.dispatchEligible:copy.dispatchIneligible}</dd></div>
    <div className="fact"><dt>{copy.definitionId}</dt><dd>{record.definition_id}</dd></div>
    <div className="fact"><dt>{copy.publicationVersion}</dt><dd>{record.definition_version}</dd></div>
    <div className="fact"><dt>{copy.runRevision}</dt><dd>{record.revision}</dd></div>
    <div className="fact"><dt>{copy.activeExecution}</dt><dd>{record.active_execution_id??copy.none}</dd></div>
    <div className="fact"><dt>{copy.lastExecution}</dt><dd>{record.last_execution_id??copy.none}</dd></div>
    <div className="fact"><dt>{copy.pauseLatches}</dt><dd>{record.pause_latches.length}</dd></div>
   </dl>
   <p className="muted">{view.source==='creation'?copy.runCreationReceipt:copy.lastRead} <time dateTime={view.readAt}>{new Date(view.readAt).toLocaleString()}</time></p>
   {view.source==='creation'&&<button disabled={state.busy} onClick={()=>{setRunId(record.run_id);void manager.readRun(record.run_id);}}>{copy.readCurrentRun}</button>}
  </div>}
 </section>;
}
