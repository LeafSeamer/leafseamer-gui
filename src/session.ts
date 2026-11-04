import {createBrowserSessionClient, contractSelection, SessionClientError} from '@leafseamer/sdk';
import type {BrowserSessionClient, Results} from '@leafseamer/sdk';

export type Session = Extract<Results['controller']['login'], {status: '201'}>['body']['data'];
export type Device = Extract<Results['controller']['listDevices'], {status: '200'}>['body']['data']['items'][number];
export type Control = Extract<Results['controller']['getControl'], {status: '200'}>['body'];
export type Site = {format: 'leafseamer.gui.site/1'; site_label: string; service_id: string | null; database_instance_id: string | null; selection: typeof contractSelection};
export type Notice = 'unauthorized' | 'forbidden' | 'unavailable' | 'incompatible' | 'network' | 'stale' | 'logout_pending' | 'logout_unconfirmed' | 'local_cleared';
export type Snapshot = Readonly<{busy: boolean; session: Session | null; loginLabel: string; devices: readonly Device[]; selected: string | null;
  control: Control | null; catalogRevision: string | null; lastRead: string | null; notice: Notice | null}>;
const empty = (): Snapshot => Object.freeze({busy: false, session: null, loginLabel: '', devices: Object.freeze([]), selected: null,
  control: null, catalogRevision: null, lastRead: null, notice: null});
class Rejected extends Error { code: Notice; constructor(code: Notice) { super(code); this.code = code; } }
function accept(status: string, expected: string): void {
  if (status === expected) return;
  throw new Rejected(status === '401' ? 'unauthorized' : status === '403' ? 'forbidden' : status === '409' ? 'stale' :
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
export function createSessionManager(site: Site, client: BrowserSessionClient = createBrowserSessionClient({baseUrl: globalThis.location.origin})) {
  if (!site.service_id || !site.database_instance_id) throw new Error('site_configuration');
  const audience = site.service_id, database = site.database_instance_id;
  let current = empty(), generation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => { current = Object.freeze({...current, ...patch}); for (const fn of listeners) fn(); };
  const clearLocal = (notice: Notice | null = 'local_cleared') => { generation++; client.clearLocalState(); current = empty(); publish({notice}); };
  async function action(run: (alive: () => void) => Promise<void>) {
    if (current.busy) return;
    const version = generation, alive = () => { if (version !== generation) throw new Error('session_generation'); };
    publish({busy: true, notice: null});
    try { await run(alive); }
    catch (error) {
      if (version !== generation) return;
      if (error instanceof Rejected && error.code !== 'unauthorized') publish({notice: error.code});
      else clearLocal(error instanceof Rejected || error instanceof SessionClientError && error.code === 'session_credentials_missing' ? 'unauthorized' : 'network');
    } finally { if (version === generation) publish({busy: false}); }
  }
  async function token(scopes: string[], alive: () => void) {
    const response = await client.issueToken({audience, requested_scopes: scopes}); alive(); accept(response.status, '201');
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
  return Object.freeze({
    getSnapshot: () => current,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    clearLocal,
    login(login: string, password: string) { return action(async alive => {
      publish({...empty(), busy: true});
      const response = await client.login({login, password}); alive(); accept(response.status, '201');
      if (response.status !== '201') return;
      publish({session: response.body.data, loginLabel: login});
      if (response.body.data.permissions.includes('device.read')) await readDevices(alive);
      else publish({notice: 'forbidden'});
    }); },
    refreshDevices: () => action(readDevices),
    selectDevice(id: string) { return action(async alive => { if (!current.devices.some(d => d.device_id === id)) throw new Rejected('stale'); await readControl(id, alive); }); },
    refreshSession() { return action(async alive => {
      const response = await client.refresh(crypto.randomUUID()); alive(); accept(response.status, '200');
      if (response.status === '200') publish({session: response.body.data, devices: Object.freeze([]), selected: null, control: null, catalogRevision: null, lastRead: null});
    }); },
    logout() { return action(async alive => {
      let notice: Notice = 'logout_unconfirmed';
      try { const response = await client.logout(); alive(); if (response.status === '202') notice = 'logout_pending'; }
      finally { if (current.session) clearLocal(notice); }
    }); },
  });
}
export type SessionManager = ReturnType<typeof createSessionManager>;
