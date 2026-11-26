import {useState} from 'react';
import type {FormEvent} from 'react';
import type {Language} from './i18n.ts';
import type {SessionManager} from './session.ts';
import type {StatusProjection} from './status-subscription.ts';

const text = {
  zh:{title:'来源状态订阅',scope:'已授权范围 JSON',start:'开始订阅',stop:'停止订阅',source:'来源登记标识',
    frontier:'连续序号',highest:'最高已见序号',gaps:'缺口',
    phase:{idle:'未订阅',connecting:'正在连接',syncing:'正在校验快照和增量',live:'正在接收实时状态',recovering:'正在恢复订阅',
      stopping:'正在关闭订阅',denied:'当前会话无法读取此范围',invalid_scope:'范围 JSON 无效或属于其他站点',unavailable:'订阅暂不可用'},
    sourceState:{baseline_required:'等待来源基线',synchronized:'已同步',desynchronized:'存在缺口',quarantined:'已隔离',closed:'已关闭'}},
  en:{title:'Source status subscription',scope:'Authorized scope JSON',start:'Start subscription',stop:'Stop subscription',source:'Source registration',
    frontier:'Contiguous sequence',highest:'Highest observed sequence',gaps:'Gaps',
    phase:{idle:'No active subscription',connecting:'Connecting',syncing:'Verifying snapshot and updates',live:'Receiving live status',recovering:'Recovering subscription',
      stopping:'Closing subscription',denied:'This session cannot read the scope',invalid_scope:'Invalid scope JSON or a different site',unavailable:'Subscription unavailable'},
    sourceState:{baseline_required:'Awaiting source baseline',synchronized:'Synchronized',desynchronized:'Gap detected',quarantined:'Quarantined',closed:'Closed'}}
} as const;

export function StatusProjectionPane({manager, projection, language}: {
  manager: SessionManager; projection: StatusProjection; language: Language;
}) {
  const copy = text[language], [scope,setScope] = useState('');
  const running = ['connecting','syncing','live','recovering','stopping'].includes(projection.phase);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void manager.startStatusProjection(scope);
  };
  return <section className="status-projection" aria-labelledby="source-status-title">
    <h2 id="source-status-title">{copy.title}</h2>
    <form onSubmit={submit}>
      <label htmlFor="status-scope">{copy.scope}</label>
      <textarea id="status-scope" value={scope} onChange={event=>setScope(event.target.value)} rows={3}
        maxLength={16384} disabled={running} required/>
      <div className="actions">
        <button type="submit" className="primary" disabled={running || !scope.trim()}>{copy.start}</button>
        {running && <button type="button" disabled={projection.phase==='stopping'}
          onClick={()=>void manager.stopStatusProjection()}>{copy.stop}</button>}
      </div>
    </form>
    <p className="muted" role="status">{copy.phase[projection.phase]}</p>
    {projection.records.length > 0 && <ul className="source-status-list">
      {projection.records.map(({entity_id,view})=><li key={entity_id}>
        <strong>{copy.sourceState[view.state]}</strong>
        <dl className="facts">
          <div className="fact"><dt>{copy.source}</dt><dd>{entity_id}</dd></div>
          <div className="fact"><dt>{copy.frontier}</dt><dd>{view.contiguous_sequence}</dd></div>
          <div className="fact"><dt>{copy.highest}</dt><dd>{view.highest_seen_sequence}</dd></div>
          <div className="fact"><dt>{copy.gaps}</dt><dd>{view.gaps.length}</dd></div>
        </dl>
      </li>)}
    </ul>}
  </section>;
}
