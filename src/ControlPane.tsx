import {useState} from 'react';
import type {FormEvent} from 'react';
import type {SessionManager, Snapshot} from './session.ts';
import type {Copy} from './i18n.ts';
import {samePrincipal} from './control-actions.ts';

export function ControlPane({manager, state, copy}: {manager: SessionManager; state: Snapshot; copy: Copy}) {
  const [reason, setReason] = useState(''), [force, setForce] = useState(false);
  const pending = state.controlAction, control = state.control, permissions = state.session?.permissions ?? [];
  const owner = samePrincipal(control?.holder ?? null, state.session), common = !!control && !control.pending_change && !state.busy &&
    permissions.includes('control.read') && permissions.includes('request.create');
  const acquire = common && !owner && permissions.includes('control.acquire') && (control.mode !== 'manual' || force && permissions.includes('control.emergency'));
  const release = common && owner && control.mode === 'manual' && permissions.includes('control.release');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const button = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (button?.value === 'acquireControl' && acquire) void manager.prepareControl('acquireControl', reason, force);
    if (button?.value === 'releaseControl' && release) void manager.prepareControl('releaseControl', reason);
  };
  return <section className="control-pane" aria-label={copy.controlActions}><h2>{copy.controlActions}</h2><p className="muted">{copy.controlHint}</p>
    {pending ? <article aria-live="polite">
      <p><strong>{pending.request.operation === 'acquireControl' ? copy.acquireControl : copy.releaseControl}</strong> · <span className="identifier">{pending.request.device_id}</span></p>
      <p data-control-phase={pending.phase}>{pending.phase === 'prepared' ? copy.controlPrepared : pending.phase === 'unknown' ? copy.controlUnknown : pending.phase === 'not_found' ? copy.controlNotFound : copy.controlAccepted}</p>
      {pending.prepared && <><dl className="facts"><div className="fact"><dt>{copy.controlReason}</dt><dd>{pending.prepared.body.reason}</dd></div>
        <div className="fact"><dt>{copy.version}</dt><dd>{pending.prepared.body.expected_control.epoch} / {pending.prepared.body.expected_control.version}</dd></div></dl>
        {pending.prepared.operation === 'acquireControl' && pending.prepared.body.force && <p className="warning">{copy.emergencyConfirm}</p>}
        <div className="control-buttons"><button className="primary" disabled={state.busy} onClick={() => void manager.confirmControl()}>{copy.confirmControl}</button>
          <button disabled={state.busy} onClick={() => manager.dismissControl()}>{copy.cancelPreparation}</button></div></>}
      {pending.receipt && <p className="identifier">{copy.controlOperationId}：{pending.receipt.initial_result_ref.id}</p>}
      {pending.operation && <><p data-control-state={pending.operation.state}><strong>{copy['control_' + pending.operation.state as keyof Copy]}</strong></p>
        {pending.operation.failure_code && <p className="identifier">{copy.commandReason}：{pending.operation.failure_code}</p>}
        <p className="muted">{copy.controlHistory}</p></>}
      {pending.phase !== 'prepared' && <div className="control-buttons"><button className="primary" disabled={state.busy || !permissions.includes('control.read')} onClick={() => void manager.lookupControl()}>{copy.lookupControl}</button>
        {['effective', 'rejected'].includes(pending.operation?.state ?? '') && <button disabled={state.busy} onClick={() => manager.dismissControl()}>{copy.closeControlRecord}</button>}</div>}
    </article> : <form onSubmit={submit}>
      <label htmlFor="control-reason">{copy.controlReason}</label><input id="control-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1024} required disabled={state.busy}/>
      {permissions.includes('control.emergency') && <label className="control-force"><input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} disabled={state.busy}/>{copy.emergencyControl}</label>}
      <div className="control-buttons"><button className="primary" value="acquireControl" disabled={!acquire || !reason.trim()}>{copy.acquireControl}</button>
        <button className="secondary" value="releaseControl" disabled={!release || !reason.trim()}>{copy.releaseControl}</button></div>
    </form>}
  </section>;
}
