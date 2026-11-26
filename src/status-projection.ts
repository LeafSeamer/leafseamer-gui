import {projectionContentDigest} from '@leafseamer/sdk';
import type {BrowserEventFrame, Inputs, Results, SourceProjectionRecord} from '@leafseamer/sdk';

export type StatusScope = Inputs['controller']['createSubscription']['body']['scope'];
export type Subscription = Extract<Results['controller']['getSubscription'], {status:'200'}>['body'];
export type SnapshotManifest = Extract<Results['controller']['getSnapshot'], {status:'200'}>['body'];
type SnapshotPage = Extract<Results['controller']['getSnapshotPage'], {status:'200'}>['body'];
type Attached = Extract<BrowserEventFrame, {type:'server.attached'}>;
type SourceRecord = SnapshotPage['content']['records'][number];
export const channelVersion = 'event-channel/0.1.0-draft.1';

export function requireProjection(condition: unknown): asserts condition {
  if (!condition) throw new Error('status_projection_integrity');
}

export async function sameProjection(a: object, b: object) {
  const [first, second] = await Promise.all([projectionContentDigest(a), projectionContentDigest(b)]);
  return first.digest === second.digest;
}

export function readStatusScope(text: string, service: string, database: string): StatusScope {
  requireProjection(text.length > 0 && text.length <= 16384);
  const value = JSON.parse(text);
  const scope = value?.scope ?? value;
  requireProjection(scope && Object.keys(scope).sort().join(',') === 'collections,projection_profile_ref,scope_id,scope_revision' &&
    typeof scope.scope_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(scope.scope_id) &&
    typeof scope.scope_revision === 'string' && /^[1-9][0-9]{0,19}$/.test(scope.scope_revision) &&
    Array.isArray(scope.collections) && scope.collections.length === 1);
  const [collection] = scope.collections;
  const profile = scope.projection_profile_ref;
  const selector = collection?.selector_ref;
  const belongs = (ref: typeof profile) => ref?.authority_service_id === service && ref?.database_instance_id === database &&
    typeof ref.content_digest === 'string' && /^[0-9a-f]{64}$/.test(ref.content_digest);
  requireProjection(belongs(profile) && belongs(selector) && profile.entity_kind === 'projection_profile' &&
    selector.entity_kind === 'selector' && collection.entity_kind === 'sources' &&
    collection.relation_policy === 'authorized_reference' && collection.history_policy === 'current');
  return scope;
}

export function sourceRecord(record: SourceRecord, binding: Attached['binding']): SourceProjectionRecord {
  requireProjection(record.entity_kind === 'sources');
  const view = record.view, key = view.source_key, ref = view.binding_ref;
  requireProjection(record.entity_id === key.registration_id && record.entity_epoch === key.source_epoch &&
    key.authority_service_id === binding.publisher_service_id && key.database_instance_id === binding.publisher_database_instance_id &&
    ref.authority_service_id === key.authority_service_id && ref.database_instance_id === key.database_instance_id &&
    ref.entity_id === key.registration_id && ref.entity_epoch === key.source_epoch && ref.entity_kind === 'source_binding' &&
    BigInt(view.contiguous_sequence) <= BigInt(view.highest_seen_sequence));
  return record;
}

export async function adoptStatusSnapshot({
  attached, scope, manifest, readPage
}: {attached: Attached; scope: StatusScope; manifest: SnapshotManifest; readPage: (index: number) => Promise<SnapshotPage>}) {
  const {snapshot_ref: snapshot, binding} = attached;
  const {manifest_digest, ...unsigned} = manifest;
  const {connection_generation, ...expectedBinding} = binding;
  const {snapshot_id, projection_profile_ref, publisher_domain_ref, ...contentBinding} = manifest.binding;
  requireProjection(snapshot && snapshot.snapshot_id === snapshot_id && snapshot.manifest_digest === manifest_digest &&
    snapshot.snapshot_cursor === manifest.snapshot_cursor && await sameProjection(expectedBinding, contentBinding) &&
    await sameProjection(scope.projection_profile_ref, projection_profile_ref) &&
    manifest_digest === (await projectionContentDigest(unsigned)).digest);
  requireProjection(manifest.page_count > 0 && manifest.page_count <= 128 && manifest.pages.length === manifest.page_count &&
    manifest.total_content_bytes <= 8388608 && manifest.collections.length === 1 && manifest.collections[0].entity_kind === 'sources');
  const records = new Map<string, SourceProjectionRecord>();
  let bytes = 0;
  for (const [index, descriptor] of manifest.pages.entries()) {
    requireProjection(descriptor.page_index === index && descriptor.content_bytes <= 245760);
    const {content, content_digest, manifest_digest: pageManifest, delivery_binding} = await readPage(index);
    const measured = await projectionContentDigest(content);
    requireProjection(pageManifest === manifest_digest && content_digest === descriptor.content_digest &&
      measured.digest === content_digest && measured.bytes === descriptor.content_bytes &&
      content.page_index === index && content.next_page_index === (index + 1 < manifest.page_count ? index + 1 : null) &&
      await sameProjection(content.binding, manifest.binding) && await sameProjection(delivery_binding, binding));
    bytes += measured.bytes;
    for (const item of content.records) {
      const record = sourceRecord(item, binding);
      requireProjection(records.size < 32 && !records.has(record.entity_id));
      records.set(record.entity_id, record);
    }
  }
  requireProjection(bytes === manifest.total_content_bytes && records.size > 0 &&
    String(records.size) === manifest.collections[0].count && records.size === manifest.source_watermarks.length);
  const watermarks = new Map(manifest.source_watermarks.map(mark => [mark.source_key.registration_id, mark]));
  for (const [id, record] of records) {
    const mark = watermarks.get(id);
    const view = record.view;
    requireProjection(mark && await sameProjection(mark, {source_key:view.source_key,binding_ref:view.binding_ref,
      baseline_sequence:view.contiguous_sequence,source_state_revision:record.entity_revision,baseline_ref:view.baseline_ref,gap_summary:view.gaps}));
  }
  const {digest} = await projectionContentDigest({entry_kind:'snapshot.baseline',payload:snapshot});
  return {snapshot, records, cursor:snapshot.snapshot_cursor, digest};
}
