import {contractSelection, decodeBrowserEventFrame, encodeBrowserEventFrame, eventChannelProtocol, projectionContentDigest} from '@leafseamer/sdk';
import type {BrowserEventFrame, BrowserEventInput, BrowserSessionClient, SourceProjectionRecord} from '@leafseamer/sdk';
import type {Session, Site} from './session.ts';
import {adoptStatusSnapshot, channelVersion, readStatusScope, requireProjection, sameProjection, sourceRecord} from './status-projection.ts';
import type {StatusScope, Subscription} from './status-projection.ts';

type Phase = 'idle' | 'connecting' | 'syncing' | 'live' | 'recovering' | 'stopping' | 'unavailable' | 'invalid_scope' | 'denied';
export type StatusProjection = Readonly<{phase: Phase; records: readonly SourceProjectionRecord[]}>;
export const emptyStatusProjection: StatusProjection = Object.freeze({phase:'idle',records:Object.freeze([])});
type Run = {session: Session; scope: StatusScope; scopeDigest: string; clientId: string; id?: string;
  create?: Parameters<BrowserSessionClient['createSubscription']>[0]; createResult?: Promise<Subscription>; adoption?: Adoption};
type Cursor = {cursor: string; digest: string};
type Adoption = Awaited<ReturnType<typeof adoptStatusSnapshot>> & {previous?: Cursor};
type Ticket = Extract<Awaited<ReturnType<BrowserSessionClient['issueWsTicket']>>, {status:'201'}>['body'];
type Attached = Extract<BrowserEventFrame, {type:'server.attached'}>;
type Http = <T extends {status:string}>(signal: AbortSignal, request: () => Promise<T>) => Promise<T>;
const active = new Set(['building','snapshot_ready','catching_up','live']);

class ProjectionHttpError extends Error {
  readonly status: string;
  constructor(status: string) { super('status_projection_http'); this.status = status; }
}
function requireStatus(actual: string, ...expected: string[]) {
  if (!expected.includes(actual)) throw new ProjectionHttpError(actual);
}
const delay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  signal.addEventListener('abort', stop, {once:true});
});

function openStatusSocket(ticket: string, signal: AbortSignal) {
  requireProjection(ticket.length === 43 && /^[A-Za-z0-9_-]+$/.test(ticket));
  const url = new URL('/api/v1/events', location.origin);
  url.protocol = 'wss:';
  const socket = new WebSocket(url, [eventChannelProtocol, 'leafseamer.ticket.' + ticket]);
  const queued: string[] = [];
  let pending: {resolve: (text: string) => void; reject: (error: Error) => void} | undefined, closed = false;
  function close() {
    if (closed) return;
    closed = true;
    queued.length = 0;
    pending?.reject(new Error('status_projection_connection'));
    pending = undefined;
    signal.removeEventListener('abort', close);
    socket.close();
  }
  signal.addEventListener('abort', close, {once:true});
  socket.addEventListener('close', close);
  socket.addEventListener('error', close);
  socket.addEventListener('message', event => {
    if (closed) return;
    if (typeof event.data !== 'string' || event.data.length > 65536 || queued.length === 4) { close(); return; }
    if (pending) { const waiter = pending; pending = undefined; waiter.resolve(event.data); }
    else queued.push(event.data);
  });
  return {
    close,
    async receive(timeout = 0) {
      if (closed) throw new Error('status_projection_connection');
      const timer = timeout ? setTimeout(close, timeout) : undefined;
      try {
        const value = queued.shift() ?? await new Promise<string>((resolve, reject) => { pending = {resolve,reject}; });
        return await decodeBrowserEventFrame(value);
      } finally { clearTimeout(timer); }
    },
    async send(frame: BrowserEventInput) {
      const value = await encodeBrowserEventFrame(frame);
      if (closed || signal.aborted || socket.readyState !== WebSocket.OPEN || socket.protocol !== eventChannelProtocol ||
          socket.bufferedAmount > 65536) throw new Error('status_projection_connection');
      socket.send(value);
    }
  };
}

export function createStatusSubscription({site, client, session, http, publish}: {
  site: Site; client: BrowserSessionClient; session: () => Session | null; http: Http; publish: (view: StatusProjection) => void;
}) {
  let run: Run | undefined, abort: AbortController | undefined;
  const authority = site.service_id!, database = site.database_instance_id!;
  const state = (phase: Phase, records: readonly SourceProjectionRecord[] = []) =>
    publish(Object.freeze({phase,records:Object.freeze(records)}));
  function current(run: Run, signal: AbortSignal) {
    signal.throwIfAborted();
    if (session() !== run.session) throw new Error('status_projection_session');
  }
  async function request<T extends {status:string}>(run: Run, signal: AbortSignal, work: () => Promise<T>) {
    current(run, signal);
    const result = await http(signal, work);
    current(run, signal);
    return result;
  }
  async function context(run: Run, signal: AbortSignal, operation: 'createSubscription' | 'issueWsTicket') {
    const result = await request(run, signal, () => client.createRequestContext({
      audience:authority,operations:[operation],ttl_ms:30000,max_unique_requests:1
    }));
    if (result.status !== '201') throw new ProjectionHttpError(result.status);
    return result.body.data.context_id;
  }
  async function verify(run: Run, view: Subscription) {
    const {owner,binding} = view, actor = run.session;
    requireProjection(owner.kind === 'human' && owner.session_id === actor.session_id && owner.principal_id === actor.principal_id &&
      owner.issuer_id === actor.issuer_id && owner.issuer_epoch === actor.issuer_epoch && owner.client_instance_id === run.clientId &&
      view.purpose === 'status_projection' && binding.publisher_service_id === authority &&
      binding.publisher_database_instance_id === database && binding.scope_digest === run.scopeDigest &&
      (!run.id || binding.subscription_id === run.id) && await sameProjection(run.scope, view.scope) &&
      await sameProjection(contractSelection, view.selection));
    return view;
  }
  async function read(run: Run, signal: AbortSignal) {
    const result = await request(run, signal, () => client.getSubscription(run.id!));
    if (result.status !== '200') throw new ProjectionHttpError(result.status);
    return verify(run, result.body);
  }
  async function create(run: Run, signal: AbortSignal) {
    run.create ??= {context_id:await context(run,signal,'createSubscription'),idempotency_key:crypto.randomUUID(),
      client_instance_id:run.clientId,purpose:'status_projection',scope:run.scope};
    const input = run.create;
    current(run, signal);
    const pending = http(signal, () => client.createSubscription(input)).then(async result => {
      if (result.status !== '200' && result.status !== '202') throw new ProjectionHttpError(result.status);
      const view = await verify(run, result.body);
      run.id = view.binding.subscription_id;
      return view;
    });
    run.createResult = pending;
    try {
      const view = await pending;
      current(run, signal);
      return view;
    } finally { if (run.createResult === pending) run.createResult = undefined; }
  }
  async function ready(run: Run, signal: AbortSignal) {
    let view = run.id ? await read(run, signal) : await create(run, signal);
    if (view.state === 'revoked') throw new ProjectionHttpError('403');
    if (!active.has(view.state)) {
      run.id = undefined; run.create = undefined; run.adoption = undefined;
      view = await create(run, signal);
    }
    const until = performance.now() + 6000;
    while (view.state === 'building' && performance.now() < until) {
      await delay(125, signal);
      view = await read(run, signal);
    }
    requireProjection(view.state === 'snapshot_ready' || view.state === 'catching_up' || view.state === 'live');
    return view;
  }
  async function issue(run: Run, signal: AbortSignal, view: Subscription): Promise<Ticket> {
    const subscription_id = view.binding.subscription_id;
    const context_id = await context(run,signal,'issueWsTicket');
    const result = await request(run, signal, () => client.issueWsTicket({context_id,idempotency_key:crypto.randomUUID(),
      subscription_id,client_instance_id:run.clientId,scope_digest:run.scopeDigest,
      expected_authorization_revision:view.binding.authorization_revision}));
    if (result.status !== '201') throw new ProjectionHttpError(result.status);
    const ticket = result.body, {binding} = ticket, channel = binding.channel;
    requireProjection(!binding.consumed && binding.origin === location.origin && channel.transport === 'human_ticket' &&
      channel.publisher_service_id === authority && channel.publisher_database_instance_id === database &&
      channel.subscription_id === subscription_id && binding.scope_digest === run.scopeDigest &&
      binding.authorization_revision === view.binding.authorization_revision && await sameProjection(channel.owner,view.owner) &&
      await sameProjection(channel.selection,contractSelection));
    return ticket;
  }
  async function download(run: Run, signal: AbortSignal, attached: Attached) {
    const {subscription_id, connection_generation} = attached.binding;
    const manifest = await request(run, signal, () => client.getSnapshot(subscription_id, connection_generation));
    if (manifest.status !== '200') throw new ProjectionHttpError(manifest.status);
    return adoptStatusSnapshot({attached,scope:run.scope,manifest:manifest.body,async readPage(index) {
      const result = await request(run, signal, () =>
        client.getSnapshotPage(subscription_id, attached.snapshot_ref!.snapshot_id, index, connection_generation));
      if (result.status !== '200') throw new ProjectionHttpError(result.status);
      return result.body;
    }});
  }
  async function connected(run: Run, signal: AbortSignal, onLive: () => void) {
    const view = await ready(run, signal), binding = view.binding;
    let adoption = run.adoption, resume: Extract<BrowserEventInput, {type:'client.attach'}>['resume'] = null;
    if (view.state !== 'snapshot_ready') {
      requireProjection(adoption && view.snapshot_ref && await sameProjection(adoption.snapshot,view.snapshot_ref));
      const known = [adoption,adoption.previous].find(item => item?.cursor === view.ack_cursor && item.digest === view.ack_payload_digest);
      requireProjection(known);
      resume = {ack_kind:'projection_applied',cursor:known.cursor,payload_digest:known.digest};
    }
    const ticket = await issue(run, signal, view), channel = openStatusSocket(ticket.ticket, signal);
    try {
      const hello = await channel.receive(5000);
      requireProjection(hello.type === 'contract.ready' && await sameProjection(hello.channel,ticket.binding.channel));
      const {authorization_revision, scope_digest, stream_epoch, stream_id, subscription_id} = binding;
      await channel.send({schema_version:channelVersion,type:'client.attach',owner:view.owner,subscription_id,
        authorization_revision,scope_digest,stream_epoch,stream_id,connection_attempt_id:crypto.randomUUID(),
        expected_connection_generation:binding.connection_generation,replace_existing:binding.connection_generation !== '0',resume});
      const attached = await channel.receive(5000);
      requireProjection(attached.type === 'server.attached' && attached.snapshot_ref && view.snapshot_ref &&
        await sameProjection(attached.snapshot_ref,view.snapshot_ref) &&
        await sameProjection(attached.binding,{...binding,connection_generation:String(BigInt(binding.connection_generation)+1n)}) &&
        attached.state === (resume ? 'catching_up' : 'snapshot_ready') && attached.ack_cursor === view.ack_cursor &&
        attached.ack_payload_digest === view.ack_payload_digest);
      current(run, signal);
      state('syncing');
      if (!resume) {
        adoption = await download(run, signal, attached);
        current(run, signal);
        run.adoption = adoption;
        await channel.send({schema_version:channelVersion,type:'client.snapshot.applied',binding:attached.binding,snapshot:attached.snapshot_ref});
      }
      requireProjection(adoption);
      let frontier = resume?.cursor ?? adoption.cursor, live = false;
      for (;;) {
        const frame = await channel.receive(live ? 0 : 5000);
        current(run, signal);
        requireProjection((frame.type === 'server.data' || frame.type === 'server.sync.ready') &&
          await sameProjection(frame.binding,attached.binding) && frame.delivery_mode === (live ? 'live' : 'reconcile') &&
          frame.previous_cursor === frontier && frame.cursor === String(BigInt(frontier)+1n));
        const entry = frame.type === 'server.data' ? frame.entry :
          {entry_kind:'sync.ready',payload:{baseline_snapshot_id:frame.baseline_snapshot_id}};
        requireProjection(frame.payload_digest === (await projectionContentDigest(entry)).digest);
        if (frame.type === 'server.sync.ready') requireProjection(!live && frame.baseline_snapshot_id === adoption.snapshot.snapshot_id);
        if (frame.cursor === adoption.cursor) requireProjection(frame.payload_digest === adoption.digest);
        else {
          requireProjection(frontier === adoption.cursor);
          if (frame.type === 'server.data') {
            requireProjection(frame.entry.entry_kind === 'entity.upsert');
            const updated = sourceRecord(frame.entry.payload,attached.binding), previous = adoption.records.get(updated.entity_id);
            requireProjection(previous && updated.entity_epoch === previous.entity_epoch &&
              BigInt(updated.entity_revision) > BigInt(previous.entity_revision) &&
              BigInt(updated.view.contiguous_sequence) >= BigInt(previous.view.contiguous_sequence) &&
              await sameProjection(updated.view.source_key,previous.view.source_key) &&
              await sameProjection(updated.view.binding_ref,previous.view.binding_ref));
            adoption.records.set(updated.entity_id,updated);
          }
          adoption.previous = {cursor:adoption.cursor,digest:adoption.digest};
          adoption.cursor = frame.cursor; adoption.digest = frame.payload_digest;
        }
        current(run, signal);
        await channel.send({schema_version:channelVersion,type:'client.ack',binding:attached.binding,
          ack_kind:'projection_applied',cursor:frame.cursor,payload_digest:frame.payload_digest});
        frontier = frame.cursor;
        if (frame.type === 'server.sync.ready' && !live) {
          const until = performance.now() + 3000;
          let confirmedCheckpoint = false;
          do {
            const confirmed = await read(run, signal);
            requireProjection(await sameProjection(confirmed.binding, attached.binding));
            if (confirmed.ack_cursor === frontier && confirmed.ack_payload_digest === frame.payload_digest) {
              requireProjection(confirmed.state === 'live' || confirmed.state === 'catching_up');
              confirmedCheckpoint = true;
              live = confirmed.state === 'live';
              break;
            }
            await delay(75,signal);
          } while (performance.now() < until);
          requireProjection(confirmedCheckpoint);
          if (live) onLive();
        }
        current(run,signal);
        if (live) state('live',[...adoption.records.values()]);
      }
    } finally { channel.close(); }
  }
  async function stopRemote(run: Run, signal: AbortSignal) {
    if (!run.id) return;
    for (let retries=0; retries<3; retries++) {
      const view = await read(run,signal);
      if (!active.has(view.state)) return;
      const result = await request(run,signal,() => client.closeSubscription(run.id!,view.revision));
      if (result.status === '409') continue;
      requireStatus(result.status,'200','410');
      return;
    }
    throw new ProjectionHttpError('409');
  }
  return {
    async start(text: string) {
      if (abort) return;
      const actor = session();
      if (!(actor?.permissions.includes('status.read') && actor.permissions.includes('request.create'))) { state('denied'); return; }
      let scope: StatusScope;
      try { scope = readStatusScope(text,authority,database); } catch { state('invalid_scope'); return; }
      const lifecycle = new AbortController();
      abort = lifecycle;
      const signal = lifecycle.signal;
      state('connecting');
      try {
        const {digest:scopeDigest} = await projectionContentDigest(scope);
        signal.throwIfAborted();
        if (run && run.scopeDigest !== scopeDigest) await stopRemote(run,signal);
        if (!run || run.scopeDigest !== scopeDigest) run = {session:actor,scope,scopeDigest,clientId:crypto.randomUUID()};
        let failures = 0, replaced = false;
        while (!signal.aborted) {
          try { await connected(run,signal,() => { failures = 0; replaced = false; }); }
          catch (error) {
            if (signal.aborted) return;
            if (error instanceof ProjectionHttpError && ['400','401','403','404','422'].includes(error.status)) {
              state(error.status === '401' || error.status === '403' ? 'denied' : 'unavailable');
              return;
            }
            state('recovering');
            if (error instanceof Error && error.message === 'status_projection_integrity' && !replaced && run.id) {
              await stopRemote(run,signal);
              run.id = undefined; run.create = undefined; run.adoption = undefined; replaced = true;
            }
            if (++failures === 4) throw error;
            await delay(failures*250,signal);
          }
        }
      } catch { if (!signal.aborted) state('unavailable'); }
      finally { if (abort === lifecycle) abort = undefined; }
    },
    async stop() {
      abort?.abort();
      const retained = run;
      if (!retained) { abort = undefined; state('idle'); return; }
      const lifecycle = new AbortController();
      abort = lifecycle;
      state('stopping');
      try {
        await retained.createResult?.catch(()=>{});
        lifecycle.signal.throwIfAborted();
        if (!retained.id && retained.create) { state('unavailable'); return; }
        await stopRemote(retained,lifecycle.signal);
        lifecycle.signal.throwIfAborted();
        run = undefined;
        state('idle');
      }
      catch { if (!lifecycle.signal.aborted) state('unavailable'); }
      finally { if (abort === lifecycle) abort = undefined; }
    },
    reset() { abort?.abort(); abort = undefined; run = undefined; }
  };
}
