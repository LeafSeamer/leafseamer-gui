import {prepareControlChange} from '@leafseamer/sdk';
import type {BrowserSessionClient, ControlChangeOperation, PreparedControlChange, Results} from '@leafseamer/sdk';
import type {Control, Notice, Session, Site, Snapshot} from './session.ts';

type Identity = PreparedControlChange['identity'];
type Receipt = Extract<Results['controller']['acquireControl'], {status: '202'}>['body'];
type Operation = Extract<Results['controller']['getControlOperation'], {status: '200'}>['body'];
type Saved = Readonly<{format: 'leafseamer.gui.control-request/1'; operation: ControlChangeOperation; device_id: string; identity: Identity}>;
export type ControlActionState = Readonly<{request: Saved; phase: 'prepared' | 'unknown' | 'accepted' | 'not_found';
  prepared: PreparedControlChange | null; receipt: Receipt | null; operation: Operation | null}>;
export type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function browserRecoveryStorage(): RecoveryStorage | null { try { return globalThis.sessionStorage ?? null; } catch { return null; } }
type Principal = Pick<Session, 'issuer_id' | 'issuer_epoch' | 'principal_id'>;
export const samePrincipal = (a: Principal | null, b: Principal | null) => !!a && !!b &&
  a.issuer_id === b.issuer_id && a.issuer_epoch === b.issuer_epoch && a.principal_id === b.principal_id;
const sameIdentity = (a: Identity, b: Identity) => a.request_digest === b.request_digest && samePrincipal(a.key, b.key) &&
  a.key.operation_id === b.key.operation_id && a.key.request_epoch === b.key.request_epoch && a.key.idempotency_key === b.key.idempotency_key &&
  a.key.target_scope.authority_service_id === b.key.target_scope.authority_service_id && a.key.target_scope.database_instance_id === b.key.target_scope.database_instance_id;

// 持久层只保存查原身份，没有请求正文、凭据或恢复发送队列。
export function createControlActions({site, client, storage, state, publish, action, token, accept, fail}: {
  site: Site; client: BrowserSessionClient; storage: RecoveryStorage | null; state: () => Snapshot;
  publish: (value: Partial<Snapshot>) => void; action: (run: (alive: () => void) => Promise<void>) => Promise<void>;
  token: (scopes: string[], alive: () => void) => Promise<void>; accept: (status: string, expected: string) => void; fail: (code: Notice) => never;
}) {
  const key = `leafseamer.control-request.v1:${site.service_id}:${site.database_instance_id}`;
  const sameScope = (scope: Control['scope']) => scope.authority_service_id === site.service_id && scope.database_instance_id === site.database_instance_id;
  const scopes = (operation: ControlChangeOperation, force = false) => ['control.read', 'request.create', operation === 'acquireControl' ? 'control.acquire' : 'control.release', ...(force ? ['control.emergency'] : [])];
  function requirePermissions(required: string[]) { if (!state().session || required.some(p => !state().session!.permissions.includes(p))) fail('forbidden'); }
  function save(value: Saved) {
    try { if (!storage) throw new Error('storage'); storage.setItem(key, JSON.stringify(value)); if (storage.getItem(key) !== JSON.stringify(value)) throw new Error('storage'); }
    catch { fail('recovery_unavailable'); }
  }
  function reset(preserve = false) { if (!preserve) try { storage?.removeItem(key); } catch { /* 清凭据不能被偏好存储故障阻断。 */ } }
  function restore(session: Session) {
    try {
      const text = storage?.getItem(key); if (!text) return;
      if (text.length > 8192) throw new Error('shape');
      const saved = JSON.parse(text) as Saved, k = saved.identity?.key;
      if (Object.keys(saved).sort().join(',') !== 'device_id,format,identity,operation' || saved.format !== 'leafseamer.gui.control-request/1' ||
          !['acquireControl', 'releaseControl'].includes(saved.operation) || typeof saved.device_id !== 'string' || !/^[A-Za-z0-9._:/-]{1,256}$/.test(saved.device_id) ||
          !k || k.operation_id !== saved.operation || !sameScope(k.target_scope) || Object.keys(k.target_scope).sort().join(',') !== 'authority_service_id,database_instance_id' || !samePrincipal(k, session) ||
          Object.keys(saved.identity).sort().join(',') !== 'key,request_digest' || Object.keys(k).sort().join(',') !== 'idempotency_key,issuer_epoch,issuer_id,operation_id,principal_id,request_epoch,target_scope' ||
          ![k.issuer_id,k.issuer_epoch,k.principal_id,k.request_epoch,k.idempotency_key].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256) ||
          !/^sha256:[0-9a-f]{64}$/.test(saved.identity.request_digest)) throw new Error('shape');
      publish({controlAction: {request: saved, phase: 'unknown', prepared: null, receipt: null, operation: null}});
    } catch { reset(); }
  }
  function receipt(value: Receipt, saved: Saved) {
    if (value.result_kind !== 'control_operation' || !sameIdentity(value.identity, saved.identity)) fail('incompatible');
    return value;
  }
  async function readCurrent(device: string, alive: () => void) {
    publish({selected: device, control: null});
    const result = await client.getControl(device); alive(); accept(result.status, '200');
    if (result.status !== '200') return;
    if (result.body.device_id !== device || !sameScope(result.body.scope)) fail('incompatible');
    publish({control: result.body}); return result.body;
  }
  return {
    reset, restore,
    api: {
      prepareControl(operation: ControlChangeOperation, reason: string, force = false) { return action(async alive => {
        if (state().controlAction || !state().selected || !reason.trim() || reason.length > 1024) fail('invalid_control');
        const required = scopes(operation, force); requirePermissions(required); await token(required, alive);
        const device = state().selected!, control = await readCurrent(device, alive); if (!control) return;
        if (control.pending_change || (operation === 'releaseControl' ? control.mode !== 'manual' || !samePrincipal(control.holder, state().session) :
            samePrincipal(control.holder, state().session) || control.mode === 'manual' && !force)) fail('stale');
        const response = await client.createRequestContext({audience: site.service_id!, operations: [operation], ttl_ms: 60000, max_unique_requests: 1});
        alive(); accept(response.status, '201'); if (response.status !== '201') return;
        const context = response.body.data; if (!samePrincipal(context, state().session)) fail('incompatible');
        const body = {context_id: context.context_id, idempotency_key: crypto.randomUUID(), expected_control: {epoch: control.control_epoch, version: control.effective_version}, reason};
        const common = {device_id: device, scope: control.scope, context};
        const prepared = await prepareControlChange(operation === 'acquireControl' ? {...common, operation, body: {...body, force}} : {...common, operation, body}); alive();
        publish({controlAction: {request: {format: 'leafseamer.gui.control-request/1', operation, device_id: device, identity: prepared.identity}, phase: 'prepared', prepared, receipt: null, operation: null}});
      }); },
      confirmControl() { return action(async alive => {
        const pending = state().controlAction, prepared = pending?.prepared;
        if (!pending || pending.phase !== 'prepared' || !prepared || !samePrincipal(pending.request.identity.key, state().session)) return fail('stale');
        const required = scopes(prepared.operation, prepared.operation === 'acquireControl' && prepared.body.force === true); requirePermissions(required);
        // 请求上下文绑定准备时的原令牌；确认不能换令牌或重新签发上下文。
        save(pending.request);
        // 先封存查原身份并销毁本页发送资格；并发点击、异常或重载都不能重发。
        publish({controlAction: {...pending, phase: 'unknown', prepared: null}});
        const response = await (prepared.operation === 'acquireControl' ? client.acquireControl(prepared.device_id, prepared.body) : client.releaseControl(prepared.device_id, prepared.body)); alive();
        if (response.status !== '202' && response.status !== '200') { accept(response.status, '202'); return; }
        publish({controlAction: {...pending, phase: 'accepted', prepared: null, receipt: receipt(response.body, pending.request), operation: null}});
      }); },
      lookupControl() { return action(async alive => {
        const pending = state().controlAction;
        if (!pending || pending.phase === 'prepared' || !samePrincipal(pending.request.identity.key, state().session)) return fail('stale');
        requirePermissions(['control.read']); await token(['control.read'], alive);
        let found = pending.receipt;
        publish({controlAction: {...pending, operation: null}});
        if (!found) {
          const response = await client.lookupControlRequest(pending.request.identity); alive(); accept(response.status, '200'); if (response.status !== '200') return;
          if (response.body.status === 'not_found') { if (response.body.receipt !== null) fail('incompatible'); publish({controlAction: {...pending, phase: 'not_found', operation: null}}); return; }
          if (!response.body.receipt) return fail('incompatible'); found = receipt(response.body.receipt, pending.request);
        }
        publish({controlAction: {...pending, phase: 'accepted', receipt: found, operation: null}});
        const response = await client.getControlOperation(found.initial_result_ref.id); alive(); accept(response.status, '200'); if (response.status !== '200') return;
        const operation = response.body;
        if (operation.operation_id !== found.initial_result_ref.id || operation.device_id !== pending.request.device_id || !sameScope(operation.scope) ||
            !sameIdentity(operation.identity, pending.request.identity) || !samePrincipal(operation.requester, pending.request.identity.key) ||
            operation.kind !== (pending.request.operation === 'acquireControl' ? 'acquire' : 'release') || BigInt(operation.revision) < BigInt(found.initial_result_ref.revision) ||
            operation.revision === found.initial_result_ref.revision && operation.operation_digest !== found.initial_result_ref.digest) fail('incompatible');
        publish({controlAction: {...pending, phase: 'accepted', receipt: found, operation}});
        await readCurrent(pending.request.device_id, alive);
      }); },
      dismissControl() { if (state().busy) return; const pending = state().controlAction;
        if (!pending || pending.phase === 'prepared' || ['effective', 'rejected'].includes(pending.operation?.state ?? '')) { reset(); publish({controlAction: null}); }
      },
    },
  };
}
