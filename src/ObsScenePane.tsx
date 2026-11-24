import type {FormEvent} from 'react';
import {useState} from 'react';
import {canDismissObsCut,canRejectObsCut,canSubmitObsCut} from './obs-actions.ts';
import {commandLabels} from './i18n.ts';
import type {Copy,Language} from './i18n.ts';
import type {SessionManager,Snapshot} from './session.ts';

export function ObsScenePane({manager,state,copy,language}: {manager:SessionManager;state:Snapshot;copy:Copy;language:Language}){
  const [scene,setScene]=useState(''),[confirm,setConfirm]=useState<string|null>(null);
  const catalog=state.obsCatalog,canSend=canSubmitObsCut(state),pending=state.obsCommand;
  const record=state.command?.command_id===pending?.commandId?state.command:null;
  const canReject=canRejectObsCut(state),rejectionId=pending?.saved.rejection?.rejection_operation_id;
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(canSend&&scene)void manager.submitObsCut(scene);
  }
  return <section className="observation" aria-label={copy.obsScenes}>
    <div className="heading"><h2>{copy.obsScenes}</h2><button className="primary" disabled={state.busy||!state.session?.permissions.includes('device.read')}
      onClick={()=>void manager.readObsScenes()}>{copy.obsRead}</button></div>
    {catalog?.status==='ready'?<form className="command-search" onSubmit={submit}>
      <label htmlFor="obs-scene">{copy.obsTarget}</label>
      <select id="obs-scene" value={scene} disabled={state.busy||!canSend} required onChange={event=>setScene(event.currentTarget.value)}>
        <option value="">{copy.obsChoose}</option>
        {catalog.entries.map(entry=><option key={entry.scene_id} value={entry.scene_id}>{entry.display_name}</option>)}
      </select>
      <button className="primary" disabled={state.busy||!canSend||!scene}>{copy.obsCut}</button>
      {!canSend&&!pending&&<p className="muted">{copy.obsProtected}</p>}
    </form>:<p className="muted">{catalog?copy.obsUnconfirmed:copy.obsNoCatalog}</p>}
    {pending&&<div className="command-evidence">
      <p role="status">{pending.phase==='accepted'?copy.obsAccepted:pending.phase==='unknown'?copy.obsUnknown:pending.phase==='not_found'?copy.obsNotFound:copy.obsRejected}</p>
      {pending.commandId&&<p className="identifier">{pending.commandId}</p>}
      {record&&<p>{[record.state.phase,record.state.outcome,record.state.resource_status].map(value=>commandLabels[language][value]??value).join(' · ')}</p>}
      <div className="control-buttons">
        {pending.phase!=='rejected'&&<button className="primary" disabled={state.busy||!state.session?.permissions.includes('command.read')} onClick={()=>{setConfirm(null);void manager.lookupObsCut();}}>{copy.obsLookup}</button>}
        {canReject&&confirm!==rejectionId&&<button disabled={state.busy} onClick={()=>setConfirm(rejectionId??null)}>{copy.obsReject}</button>}
        {canDismissObsCut(state)&&<button disabled={state.busy} onClick={()=>void manager.dismissObsCut()}>{copy.obsDismiss}</button>}
      </div>
      {canReject&&confirm===rejectionId&&<div className="control-buttons">
        <p>{copy.obsRejectHint}</p><button className="primary" disabled={state.busy} onClick={()=>{setConfirm(null);void manager.rejectObsCut();}}>{copy.obsConfirmReject}</button>
        <button disabled={state.busy} onClick={()=>setConfirm(null)}>{copy.obsKeepRequest}</button>
      </div>}
    </div>}
  </section>;
}
