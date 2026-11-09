import type {FormEvent} from 'react';
import type {SessionManager, Snapshot} from './session.ts';
import type {Copy, Language} from './i18n.ts';
import {commandLabels} from './i18n.ts';

export function CommandPane({manager, state, copy, language}: {manager: SessionManager; state: Snapshot; copy: Copy; language: Language}) {
  const command = state.command, page = state.evidence;
  const label = (value: string) => commandLabels[language][value] ?? value;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); void manager.readCommand(String(new FormData(event.currentTarget).get('command_id') ?? '').trim());
  };
  return <section className="command-pane"><div className="heading"><h1>{copy.commands}</h1></div>
    <p className="muted">{copy.commandHint}</p>
    <form className="command-search" onSubmit={submit}>
      <label htmlFor="command-id">{copy.commandId}</label>
      <input id="command-id" name="command_id" required maxLength={256} autoComplete="off" disabled={state.busy}/>
      <button className="primary" disabled={state.busy || !state.session?.permissions.includes('command.read')}>{state.busy ? copy.busy : copy.lookup}</button>
    </form>
    {command && <article aria-label={copy.commandDetails}>
      <h2>{copy.commandDetails}</h2><p className="identifier">{command.command_id}</p>
      <dl className="facts">{([
        [copy.logicalId, command.target.device_id], [copy.commandAction, command.target.action_id],
        [copy.commandRevision, command.state.revision], [copy.commandPhase, label(command.state.phase)],
        [copy.commandOutcome, label(command.state.outcome)], [copy.commandEffect, label(command.state.effect_status)],
        [copy.commandResources, label(command.state.resource_status)], [copy.commandAccepted, command.accepted_at ?? copy.noReferenceTime],
        [copy.commandCompletion, command.completion.achieved ? label(command.completion.achieved) : copy.noCompletion],
        [copy.commandReason, command.state.reason_code ?? copy.none],
      ] as [string, string][]).map(([key, value]) => <div className="fact" key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <p className="muted">{copy.commandHistorical}</p>
      <section className="command-evidence" aria-label={copy.commandEvidence}>
        <div className="heading"><h2>{copy.commandEvidence}</h2><button disabled={state.busy || !state.session?.permissions.includes('command.evidence.read')} onClick={() => void manager.readEvidence()}>{copy.readEvidence}</button></div>
        {!state.session?.permissions.includes('command.evidence.read') && <p className="muted">{copy.evidencePermission}</p>}
        {page && <><p>{copy.evidenceRange} {page.items.length ? (BigInt(page.offset) + 1n).toString() : '0'}–{(BigInt(page.offset) + BigInt(page.items.length)).toString()} / {page.total}</p>
          {page.items.length === 0 && <p className="muted">{copy.noEvidence}</p>}
          {page.items.map(item => <details key={JSON.stringify([item.kind, item.source_ref.id, item.source_ref.revision])}><summary>{label(item.kind)} · {item.source_ref.id} · {copy.commandRevision} {item.source_ref.revision}</summary>
            <pre>{JSON.stringify(item, null, 2)}</pre></details>)}
          {page.next_cursor !== null && <button className="primary" disabled={state.busy} onClick={() => void manager.readEvidence(true)}>{copy.nextEvidence}</button>}
        </>}
      </section>
    </article>}
  </section>;
}
