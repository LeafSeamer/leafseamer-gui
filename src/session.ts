import {createBrowserSessionClient, contractSelection, SessionClientError} from '@leafseamer/sdk';
import type {BrowserSessionClient, Results} from '@leafseamer/sdk';
import {browserRecoveryStorage, createControlActions} from './control-actions.ts';
import type {ControlActionState, RecoveryStorage} from './control-actions.ts';

export type Session = Extract<Results['controller']['login'], {status: '201'}>['body']['data'];
export type Device = Extract<Results['controller']['listDevices'], {status: '200'}>['body']['data']['items'][number];
export type Control = Extract<Results['controller']['getControl'], {status: '200'}>['body'];
export type Command = Extract<Results['controller']['getCommand'], {status: '200'}>['body']['record'];
export type EvidencePage = Extract<Results['controller']['getCommandEvidence'], {status: '200'}>['body'];
export type Site = {format: 'leafseamer.gui.site/1'; site_label: string; service_id: string | null; database_instance_id: string | null; selection: typeof contractSelection};
export type Notice = 'unauthorized' | 'forbidden' | 'unavailable' | 'incompatible' | 'network' | 'stale' | 'not_found' | 'expired_view' | 'invalid_command' | 'invalid_control' | 'recovery_unavailable' | 'logout_pending' | 'logout_unconfirmed' | 'local_cleared';
export type Snapshot = Readonly<{busy: boolean; session: Session | null; loginLabel: string; devices: readonly Device[]; selected: string | null;
  control: Control | null; controlAction: ControlActionState | null; command: Command | null; evidence: EvidencePage | null; catalogRevision: string | null; lastRead: string | null; notice: Notice | null}>;
const empty = (): Snapshot => Object.freeze({busy: false, session: null, loginLabel: '', devices: Object.freeze([]), selected: null,
  control: null, controlAction: null, command: null, evidence: null, catalogRevision: null, lastRead: null, notice: null});
class Rejected extends Error { code: Notice; constructor(code: Notice) { super(code); this.code = code; } }
function accept(status: string, expected: string): void {
  if (status === expected) return;
  throw new Rejected(status === '401' ? 'unauthorized' : status === '403' ? 'forbidden' : status === '404' ? 'not_found' : status === '410' ? 'expired_view' : status === '409' ? 'stale' :
    ['400','406','415','422'].includes(status) ? 'incompatible' : 'unavailable');
}
export function validateSite(value: unknown): Site {
  if (!value || typeof value !== 'object') throw new Error('site_configuration');
  const v = value as Site, uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
  if (Object.keys(v).sort().join(',') !== 'database_instance_id,format,selection,service_id,site_label' || v.format !== 'leafseamer.gui.site/1' ||
      typeof v.site_label !== 'string' || !v.site_label.length || v.site_label.length > 120 || /[\u0000-\u001f\u007f]/.test(v.site_label) ||
      !(v.service_id === null && v.database_instance_id === null || uuid(v.service_id) && uuid(v.database_instance_id)) ||
      v.selection?.contract_id !== contractSelection.contract_id || v.selection?.contract_digest !== contractSelection.contract_digest) throw new Error('site_configuration');
  return Object.freeze({...v, selection: contractSelection});
}

// 生命周期独立于React；组件重挂载不发请求，所有操作只由显式用户事件调用。
export function createSessionManager(site: Site, client: BrowserSessionClient = createBrowserSessionClient({baseUrl: globalThis.location.origin}), recoveryStorage: RecoveryStorage | null = browserRecoveryStorage()) {
  if (!site.service_id || !site.database_instance_id) throw new Error('site_configuration');
  const audience = site.service_id, database = site.database_instance_id;
  let current = empty(), generation = 0, tokenScopes: readonly string[] = [], tokenExpires = 0;
  const listeners = new Set<() => void>();
  const evidenceCursors = new Set<string>(), evidenceIds = new Set<string>();
  const resetEvidence = () => { evidenceCursors.clear(); evidenceIds.clear(); };
  const sameScope = (scope: Command['scope']) => scope.authority_service_id === audience && scope.database_instance_id === database;
  const sameRef = (a: Command['state_ref'], b: Command['state_ref']) => a.id === b.id && a.revision === b.revision && a.digest === b.digest;
  const publish = (patch: Partial<Snapshot>) => { current = Object.freeze({...current, ...patch}); for (const fn of listeners) fn(); };
  const clearLocal = (notice: Notice | null = 'local_cleared', preserveRecovery = false) => { generation++; tokenScopes = []; tokenExpires = 0; resetEvidence(); controlActions.reset(preserveRecovery); client.clearLocalState(); current = empty(); publish({notice}); };
  async function action(run: (alive: () => void) => Promise<void>) {
    if (current.busy) return;
    const version = generation, alive = () => { if (version !== generation) throw new Error('session_generation'); };
    publish({busy: true, notice: null});
    try { await run(alive); }
    catch (error) {
      if (version !== generation) return;
      if (error instanceof Rejected && error.code !== 'unauthorized') publish({notice: error.code});
      else clearLocal(error instanceof Rejected || error instanceof SessionClientError && error.code === 'session_credentials_missing' ? 'unauthorized' : 'network', true);
    } finally { if (version === generation) publish({busy: false}); }
  }
  async function token(scopes: string[], alive: () => void) {
    if (performance.now() < tokenExpires && scopes.every(scope => tokenScopes.includes(scope))) return;
    // 其它显式操作换令牌时撤销未提交草稿；已发送的查原身份仍保留。
    if (current.controlAction?.phase === 'prepared') publish({controlAction: null});
    tokenScopes = []; tokenExpires = 0; const started = performance.now();
    const response = await client.issueToken({audience, requested_scopes: scopes}); alive(); accept(response.status, '201');
    if (response.status === '201' && Number.isSafeInteger(response.body?.data.expires_in) && response.body.data.expires_in > 0) {
      tokenScopes = [...scopes]; tokenExpires = started + response.body.data.expires_in * 1000;
    }
  }
  async function readControl(id: string, alive: () => void) {
    publish({selected: id, control: null}); await token(['control.read'], alive);
    const response = await client.getControl(id); alive(); accept(response.status, '200');
    if (response.status !== '200') return;
    if (response.body.device_id !== id || response.body.scope.authority_service_id !== audience || response.body.scope.database_instance_id !== database) throw new Rejected('incompatible');
    publish({control: response.body});
  }
  async function readDevices(alive: () => void) {
    const selected = current.selected;
    publish({devices: Object.freeze([]), selected: null, control: null, lastRead: null, catalogRevision: null});
    await token(['device.read'], alive);
    const all: Device[] = [], seen = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined, revision: string | null = null;
    for (let page = 0; page < 64; page++) {
      const response = await client.listDevices(cursor); alive(); accept(response.status, '200');
      if (response.status !== '200') return;
      const value = response.body.data;
      if (revision !== null && revision !== value.catalog_revision) throw new Rejected('stale'); revision = value.catalog_revision;
      for (const device of value.items) { if (seen.has(device.device_id) || all.length >= 4096) throw new Rejected('stale'); seen.add(device.device_id); all.push(device); }
      if (value.next_cursor === null) {
        const id = all.find(d => d.device_id === selected)?.device_id ?? all[0]?.device_id ?? null;
        publish({devices: Object.freeze(all), catalogRevision: revision, selected: id, lastRead: new Date().toISOString()});
        if (id && current.session?.permissions.includes('control.read')) await readControl(id, alive);
        return;
      }
      if (cursors.has(value.next_cursor)) throw new Rejected('stale'); cursors.add(value.next_cursor); cursor = value.next_cursor;
    }
    throw new Rejected('stale');
  }
  const controlActions = createControlActions({site, client, storage: recoveryStorage, state: () => current, publish, action, token, accept,
    fail(code): never { throw new Rejected(code); }});
  return Object.freeze({
    ...controlActions.api,
    getSnapshot: () => current,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    clearLocal,
    leavePage: () => clearLocal('local_cleared', true),
    login(login: string, password: string) { return action(async alive => {
      tokenScopes = []; tokenExpires = 0;
      publish({...empty(), busy: true});
      const response = await client.login({login, password}); alive(); accept(response.status, '201');
      if (response.status !== '201') return;
      publish({session: response.body.data, loginLabel: login});
      controlActions.restore(response.body.data);
      if (response.body.data.permissions.includes('device.read')) await readDevices(alive);
      else publish({notice: 'forbidden'});
    }); },
    refreshDevices: () => action(readDevices),
    readCommand(id: string) { return action(async alive => {
      resetEvidence(); publish({command: null, evidence: null});
      if (!/^[A-Za-z0-9._:/-]{1,256}$/.test(id)) throw new Rejected('invalid_command');
      if (!current.session?.permissions.includes('command.read')) throw new Rejected('forbidden');
      await token(['command.read'], alive);
      const response = await client.getCommand(id); alive(); accept(response.status, '200');
      if (response.status !== '200') return;
      const record = response.body.record;
      if (record.command_id !== id || !sameScope(record.scope) || record.state.command_id !== id || !sameScope(record.state.scope)) throw new Rejected('incompatible');
      publish({command: record});
    }); },
    readEvidence(next = false) { return action(async alive => {
      const command = current.command, previous = current.evidence;
      publish({evidence: null});
      if (!command || next && (!previous || previous.next_cursor === null)) throw new Rejected('stale');
      if (!current.session?.permissions.includes('command.evidence.read')) throw new Rejected('forbidden');
      if (!next) resetEvidence();
      const cursor = next ? previous!.next_cursor! : undefined;
      if (cursor && (evidenceCursors.has(cursor) || evidenceCursors.size >= 64)) throw new Rejected('stale');
      await token(['command.evidence.read'], alive);
      const response = await client.getCommandEvidence(command.command_id, {state_revision: command.state.revision, limit: 32, ...(cursor ? {cursor} : {})});
      alive(); accept(response.status, '200'); if (response.status !== '200') return;
      const page = response.body, index = command.evidence_index;
      const offset = next ? BigInt(previous!.offset) + BigInt(previous!.items.length) : 0n;
      if (!sameScope(page.scope) || page.command_id !== command.command_id || !sameRef(page.snapshot_ref, index.snapshot_ref) ||
          !sameRef(page.state_ref, index.state_ref) || page.total !== index.total || BigInt(page.offset) !== offset ||
          offset + BigInt(page.items.length) > BigInt(page.total) ||
          (page.next_cursor === null) !== (offset + BigInt(page.items.length) === BigInt(page.total)) ||
          page.next_cursor !== null && (!page.items.length || page.next_cursor === cursor || evidenceCursors.has(page.next_cursor))) throw new Rejected('stale');
      const ids = new Set<string>();
      for (const item of page.items) {
        const key = JSON.stringify([item.kind, item.source_ref.id, item.source_ref.revision]);
        if (!sameScope(item.scope) || item.command_id !== command.command_id || ids.has(key) || evidenceIds.has(key)) throw new Rejected('incompatible');
        ids.add(key);
      }
      if (cursor) evidenceCursors.add(cursor);
      for (const key of ids) evidenceIds.add(key);
      publish({evidence: page});
    }); },
    selectDevice(id: string) { return action(async alive => { if (!current.devices.some(d => d.device_id === id)) throw new Rejected('stale'); await readControl(id, alive); }); },
    refreshSession() { return action(async alive => {
      tokenScopes = []; tokenExpires = 0;
      const response = await client.refresh(crypto.randomUUID()); alive(); accept(response.status, '200');
      if (response.status === '200') { resetEvidence(); publish({session: response.body.data, devices: Object.freeze([]), selected: null, control: null, controlAction: null, command: null, evidence: null, catalogRevision: null, lastRead: null}); controlActions.restore(response.body.data); }
    }); },
    logout() { return action(async alive => {
      let notice: Notice = 'logout_unconfirmed';
      try { const response = await client.logout(); alive(); if (response.status === '202') notice = 'logout_pending'; }
      finally { if (current.session) clearLocal(notice); }
    }); },
  });
}
export type SessionManager = ReturnType<typeof createSessionManager>;
