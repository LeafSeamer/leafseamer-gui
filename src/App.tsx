import {useEffect, useState, useSyncExternalStore} from 'react';
import type {FormEvent, ReactNode} from 'react';
import type {SessionManager, Site, Snapshot} from './session.ts';
import {translations} from './i18n.ts';
import type {Language, Copy} from './i18n.ts';
import {CommandPane} from './CommandPane.tsx';

type Tab = 'devices' | 'commands' | 'automation' | 'session';
function Icon({name}: {name: Tab | 'alert'}) {
  const paths = {devices: 'M3 4h18v13H3z M8 21h8 M12 17v4', automation: 'M12 3v6 M5 15v-4h14v4 M5 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M19 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 3a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
    commands: 'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5', session: 'M3 4h18v14h-9l-5 4v-4H3z', alert: 'M12 7v6 M12 17h.01 M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20'};
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
function preference(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* 非敏感偏好存储不可用不阻断工作台。 */ } }
function Rows({rows}: {rows: [string, ReactNode][]}) {
  return <dl className="facts">{rows.map(([label, value]) => <div className="fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
function LoginPane({manager, state, copy, reason}: {manager: SessionManager | null; state: Snapshot; copy: Copy; reason: string | null}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    const login = String(data.get('login') ?? ''), password = String(data.get('password') ?? ''); form.reset();
    void manager?.login(login, password);
  };
  return <section className="login-pane"><h1>{copy.loginTitle}</h1><p className="muted">{copy.loginHint}</p>
    {reason && <p role="alert" className="warning">{reason}</p>}
    <form onSubmit={submit}>
      <label htmlFor="login">{copy.username}</label><input id="login" name="login" autoComplete="username" required maxLength={128} disabled={!manager || state.busy}/>
      <label htmlFor="password">{copy.password}</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={4096} disabled={!manager || state.busy}/>
      <button className="primary" disabled={!manager || state.busy}>{state.busy ? copy.signingIn : copy.login}</button>
    </form>
  </section>;
}
function DevicePane({manager, state, copy, language}: {manager: SessionManager; state: Snapshot; copy: Copy; language: Language}) {
  const device = state.devices.find(d => d.device_id === state.selected), control = state.control;
  return <><div className="heading"><h1>{copy.devices}</h1><button className="primary" onClick={() => void manager.refreshDevices()} disabled={state.busy}>{state.busy ? copy.busy : copy.refresh}</button></div>
    <div className="warning"><Icon name="alert"/><span>{copy.notice}</span></div>
    <div className="device-layout"><section className="device-list" aria-label={copy.list}><h2>{copy.list}</h2>
      {state.devices.length === 0 && <p className="muted">{state.busy ? copy.busy : state.catalogRevision === null ? copy.unread : copy.empty}</p>}
      {state.devices.map(item => <button key={item.device_id} aria-pressed={state.selected === item.device_id} className={`device-row ${state.selected === item.device_id ? 'selected' : ''}`} disabled={state.busy}
        onClick={() => void manager.selectDevice(item.device_id)}><span><strong>{item.display_name}</strong><small>{item.device_kind}</small></span><span>{copy[item.connection_state]}</span></button>)}
    </section><section className="device-detail" aria-label={device?.display_name ?? copy.choose}>
      {device ? <><h2>{device.display_name}</h2><p className="muted identifier">{copy.logicalId}：{device.device_id}</p>
        <Rows rows={[[copy.connection, copy[device.connection_state]], [copy.mode, control ? copy[control.mode] : copy.unknown],
          [copy.holder, control ? control.holder ? `${control.holder.issuer_id} / ${control.holder.issuer_epoch} / ${control.holder.principal_id}` : copy.none : copy.unknown],
          [copy.gate, control ? copy[control.gate_state] : copy.unknown], [copy.version, control?.effective_version ?? copy.unknown],
          [copy.inFlight, control?.in_flight_command_ids.length ?? copy.unknown], [copy.unresolved, control?.unresolved_command_ids.length ?? copy.unknown]]}/>
        <section className="observation"><h2>{copy.observation}</h2><p className="muted">{copy.noObservation}</p></section>
        <footer className="detail-footer"><p>{copy.readOnly}</p>{state.lastRead && <small>{copy.lastRead}：{new Date(state.lastRead).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {timeZoneName: 'short'})} · {copy.catalog} {state.catalogRevision}</small>}</footer>
      </> : <p className="muted empty-detail">{copy.choose}</p>}
    </section></div></>;
}
function SessionPane({manager, state, copy}: {manager: SessionManager; state: Snapshot; copy: Copy}) {
  const session = state.session!;
  return <><div className="heading"><h1>{copy.session}</h1><button className="primary" disabled={state.busy} onClick={() => void manager.refreshSession()}>{copy.renew}</button></div>
    <p className="muted">{copy.renewHint}</p><Rows rows={[[copy.principal, session.principal_id], [copy.issuer, session.issuer_id], [copy.issuerEpoch, session.issuer_epoch],
      [copy.sessionId, session.session_id], [copy.authRevision, session.authorization_revision], [copy.expires, session.validity.not_after],
      [copy.permissions, <ul className="permission-list">{session.permissions.map(p => <li key={p}>{p}</li>)}</ul>]]}/></>;
}
const fallback: Snapshot = Object.freeze({busy: false, session: null, loginLabel: '', devices: [], selected: null, control: null, command: null, evidence: null, lastRead: null, catalogRevision: null, notice: null});
const noopSubscribe = () => () => {}, fallbackSnapshot = () => fallback;
export default function App({site, manager}: {site: Site | null; manager: SessionManager | null}) {
  const state = useSyncExternalStore(manager?.subscribe ?? noopSubscribe, manager?.getSnapshot ?? fallbackSnapshot);
  const [tab, setTab] = useState<Tab>('devices');
  const [language, setLanguage] = useState<Language>(() => preference('leafseamer.language', 'zh') === 'en' ? 'en' : 'zh');
  const [theme, setTheme] = useState(() => preference('leafseamer.theme', 'light') === 'dark' ? 'dark' : 'light');
  const copy = translations[language];
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  const changeLanguage = (value: Language) => { setLanguage(value); savePreference('leafseamer.language', value); document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'; };
  const changeTheme = () => { const value = theme === 'light' ? 'dark' : 'light'; setTheme(value); savePreference('leafseamer.theme', value); };
  return <div className="app" data-theme={theme}><aside className="rail"><div className="wordmark">LeafSeamer</div>
    <nav aria-label="LeafSeamer">{(['devices','commands','automation','session'] as const).map(id => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined}
      onClick={() => setTab(id)}><Icon name={id}/><span>{copy[id]}</span></button>)}</nav>
    <div className="preferences"><div role="group" aria-label={copy.language}><button onClick={() => changeLanguage('zh')} aria-pressed={language === 'zh'}>简体中文</button><span>/</span><button onClick={() => changeLanguage('en')} aria-pressed={language === 'en'}>English</button></div>
      <button onClick={changeTheme} aria-label={copy.theme}>{theme === 'light' ? copy.light : copy.dark}</button></div>
  </aside><div className="workspace"><header className="topbar"><span className="site">{site?.site_label ?? 'LeafSeamer'}</span><span className="top-status">{state.session ? copy.lastKnown : copy.signedOut}</span>
    <div className="account">{state.session && <><span>{state.loginLabel}</span><button onClick={() => void manager?.logout()} disabled={state.busy}>{copy.logout}</button></>}</div></header>
    <main>{state.notice && <p role="alert" className="notice">{copy[state.notice]}</p>}
      {!state.session || !manager ? <LoginPane manager={manager} state={state} copy={copy} reason={!site?.service_id ? copy.config : location.protocol !== 'https:' ? copy.secure : null}/> :
        tab === 'devices' ? <DevicePane manager={manager} state={state} copy={copy} language={language}/> :
        tab === 'commands' ? <CommandPane manager={manager} state={state} copy={copy} language={language}/> :
        tab === 'session' ? <SessionPane manager={manager} state={state} copy={copy}/> :
        <section className="empty-service"><h1>{copy.noAutomation}</h1><p className="muted">{copy.noAutomationHint}</p></section>}
    </main>
  </div></div>;
}
