import {createBrowserSessionClient, contractSelection, SessionClientError} from '@leafseamer/sdk';
import type {BrowserSessionClient, Results} from '@leafseamer/sdk';
import {browserRecoveryStorage, createControlActions} from './control-actions.ts';
import type {ControlActionState, RecoveryStorage} from './control-actions.ts';
import {createBindingActions} from './binding-actions.ts';
import type {BindingCandidate,BindingApproval,BindingPreparation,BindingRecovery} from './binding-actions.ts';
import {createDraftActions} from './draft-actions.ts';
import type {DraftRecord,DraftRecovery,PublishedVersion,PublicationPreparation,PublicationHistory,PublicationProof} from './draft-actions.ts';
import {createObsActions} from './obs-actions.ts';
import type {ObsCommand,SceneCatalog} from './obs-actions.ts';

export type Session = Extract<Results['controller']['login'], {status: '201'}>['body']['data'];
export type Device = Extract<Results['controller']['listDevices'], {status: '200'}>['body']['data']['items'][number];
export type Capabilities = Extract<Results['controller']['getCapabilities'], {status:'200'}>['body']['data'];
export type Control = Extract<Results['controller']['getControl'], {status: '200'}>['body'];
export type Command = Extract<Results['controller']['getCommand'], {status: '200'}>['body']['record'];
export type EvidencePage = Extract<Results['controller']['getCommandEvidence'], {status: '200'}>['body'];
import type {Site} from './site.ts';
export {validateSite} from './site.ts';
export type {Site} from './site.ts';
export type Notice = 'binding_pending' | 'binding_not_found' | 'invalid_binding' | 'recovery_cleanup' | 'invalid_draft' | 'draft_pending' | 'draft_not_found' | 'unauthorized' | 'forbidden' | 'unavailable' | 'incompatible' | 'network' | 'stale' | 'not_found' | 'expired_view' | 'invalid_command' | 'invalid_control' | 'recovery_unavailable' | 'logout_pending' | 'logout_unconfirmed' | 'local_cleared';
export type Snapshot = Readonly<{busy: boolean; session: Session | null; loginLabel: string; devices: readonly Device[]; selected: string | null;
  obsCatalog:SceneCatalog|null;obsCommand:ObsCommand|null;
  bindingCandidate:BindingCandidate|null;bindingApproval:BindingApproval|null;bindingPreparation:BindingPreparation|null;bindingRecovery:BindingRecovery|null;bindingHistorical:boolean;capabilities:Capabilities|null;capabilitiesReadAt:string|null;draft:DraftRecord|null;draftRecovery:DraftRecovery|null;draftHistorical:boolean;publicationPreparation:PublicationPreparation|null;publishedVersion:PublishedVersion|null;publicationHistory:PublicationHistory|null;publicationProof:PublicationProof|null;control: Control | null; controlAction: ControlActionState | null; command: Command | null; evidence: EvidencePage | null; catalogRevision: string | null; lastRead: string | null; notice: Notice | null}>;
const empty = (): Snapshot => Object.freeze({busy: false, session: null, loginLabel: '', devices: Object.freeze([]), selected: null,
  obsCatalog:null,obsCommand:null,
  bindingCandidate:null,bindingApproval:null,bindingPreparation:null,bindingRecovery:null,bindingHistorical:false,capabilities:null,capabilitiesReadAt:null,draft:null,draftRecovery:null,draftHistorical:false,publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null,control: null, controlAction: null, command: null, evidence: null, catalogRevision: null, lastRead: null, notice: null});
class Rejected extends Error { code: Notice; constructor(code: Notice) { super(code); this.code = code; } }
function accept(status: string, expected: string): void {
  if (status === expected) return;
  throw new Rejected(status === '401' ? 'unauthorized' : status === '403' ? 'forbidden' : status === '404' ? 'not_found' : status === '410' ? 'expired_view' : status === '409' ? 'stale' :
    ['400','406','415','422'].includes(status) ? 'incompatible' : 'unavailable');
}
// 生命周期独立于React；组件重挂载不发请求，所有操作只由显式用户事件调用。
export function createSessionManager(site: Site, client: BrowserSessionClient = createBrowserSessionClient({baseUrl: globalThis.location.origin,maxResponseBytes:8388608}), recoveryStorage: RecoveryStorage | null = browserRecoveryStorage()) {
  if (!site.service_id || !site.database_instance_id) throw new Error('site_configuration');
  const audience = site.service_id, database = site.database_instance_id;
  let current = empty(), generation = 0, tokenScopes: readonly string[] = [], tokenExpires = 0;
  const listeners = new Set<() => void>();
  const evidenceCursors = new Set<string>(), evidenceIds = new Set<string>();
  const resetEvidence = () => { evidenceCursors.clear(); evidenceIds.clear(); };
  const sameScope = (scope: Command['scope']) => scope.authority_service_id === audience && scope.database_instance_id === database;
  const sameRef = (a: Command['state_ref'], b: Command['state_ref']) => a.id === b.id && a.revision === b.revision && a.digest === b.digest;
  const publish = (patch: Partial<Snapshot>) => { current = Object.freeze({...current,...(Object.hasOwn(patch,'draft')&&patch.draft?.definition_id!==current.draft?.definition_id?{bindingCandidate:null,bindingPreparation:null}:{}), ...patch}); for (const fn of listeners) fn(); };
  const clearLocal = (notice: Notice | null = 'local_cleared', preserveRecovery = false) => { generation++; tokenScopes = []; tokenExpires = 0; resetEvidence(); controlActions.reset(preserveRecovery); obsActions.reset(preserveRecovery||current.obsCommand!==null); client.clearLocalState(); current = empty(); publish({notice}); };
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
    publish({devices: Object.freeze([]), selected: null, control: null, capabilities:null,capabilitiesReadAt:null,obsCatalog:null,lastRead: null, catalogRevision: null});
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
  const draftActions=createDraftActions({site,client,storage:recoveryStorage,state:()=>current,publish,action,accept,fail(code):never{throw new Rejected(code);}});
  const bindingActions=createBindingActions({site,client,storage:recoveryStorage,state:()=>current,publish,action,accept,fail(code):never{throw new Rejected(code);}});
  const obsActions=createObsActions({site,client,storage:recoveryStorage,state:()=>current,publish,action,token,accept,clearEvidence:resetEvidence,
    fail(code):never{throw new Rejected(code);}});
  return Object.freeze({
    ...bindingActions.api,
    ...draftActions.api,
    ...controlActions.api,
    ...obsActions.api,
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
      controlActions.restore(response.body.data);draftActions.restore(response.body.data);bindingActions.restore(response.body.data);
      obsActions.restore(response.body.data);
      if (response.body.data.permissions.includes('device.read')) await readDevices(alive);
      else if(!site.seamer)publish({notice: 'forbidden'});
    }); },
    refreshDevices: () => action(readDevices),
    readCapabilities() { return action(async alive=>{
      publish({capabilities:null,capabilitiesReadAt:null});
      const id=current.selected,device=current.devices.find(value=>value.device_id===id);
      if(!id||!device)throw new Rejected('stale');
      if(!current.session?.permissions.includes('device.read'))throw new Rejected('forbidden');
      await token(['device.read'],alive);
      const response=await client.getCapabilities(id);alive();accept(response.status,'200');
      if(response.status!=='200')return;
      const catalog=response.body.data;
      if(response.body.service_id!==audience||catalog.devices.length!==1||catalog.devices[0].device_id!==id||catalog.devices[0].device_kind!==device.device_kind)throw new Rejected('incompatible');
      publish({capabilities:catalog,capabilitiesReadAt:new Date().toISOString()});
    }); },
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
    selectDevice(id: string) { return action(async alive => { if (!current.devices.some(d => d.device_id === id)) throw new Rejected('stale'); publish({selected:id,control:null,capabilities:null,capabilitiesReadAt:null,obsCatalog:null}); if(current.session?.permissions.includes('control.read'))await readControl(id, alive); }); },
    refreshSession() { return action(async alive => {
      tokenScopes = []; tokenExpires = 0;
      const response = await client.refresh(crypto.randomUUID()); alive(); accept(response.status, '200');
      if (response.status === '200') { resetEvidence(); publish({bindingCandidate:null,bindingApproval:null,bindingPreparation:null,bindingRecovery:null,bindingHistorical:false,capabilities:null,capabilitiesReadAt:null,obsCatalog:null,obsCommand:null,draft:null,draftHistorical:false,publicationPreparation:null,publishedVersion:null,publicationHistory:null,publicationProof:null,session: response.body.data, devices: Object.freeze([]), selected: null, control: null, controlAction: null, command: null, evidence: null, catalogRevision: null, lastRead: null}); controlActions.restore(response.body.data);draftActions.restore(response.body.data);bindingActions.restore(response.body.data);obsActions.restore(response.body.data); }
    }); },
    logout() { return action(async alive => {
      let notice: Notice = 'logout_unconfirmed';
      try { const response = await client.logout(); alive(); if (response.status === '202') notice = 'logout_pending'; }
      finally { if (current.session) clearLocal(notice); }
    }); },
  });
}
export type SessionManager = ReturnType<typeof createSessionManager>;
