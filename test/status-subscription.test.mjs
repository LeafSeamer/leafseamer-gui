import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection,projectionContentDigest} from '@leafseamer/sdk';
import {createSessionManager,validateSite} from '../src/session.ts';

test('创建响应在停止后到达时，按原订阅和修订关闭', async ()=>{
  const site=validateSite({format:'leafseamer.gui.site/1',site_label:'LeafSeamer',
    service_id:'11111111-1111-4111-8111-111111111111',database_instance_id:'22222222-2222-4222-8222-222222222222',
    selection:contractSelection});
  const session={issuer_id:'issuer',issuer_epoch:'epoch',principal_id:'principal',session_id:'session',
    permissions:['status.read','request.create']};
  const ref={authority_service_id:site.service_id,database_instance_id:site.database_instance_id,
    entity_epoch:'epoch',entity_id:'scope',revision:'1',content_digest:'1'.repeat(64)};
  const scope={scope_id:'scope',scope_revision:'1',projection_profile_ref:{...ref,entity_kind:'projection_profile'},
    collections:[{entity_kind:'sources',selector_ref:{...ref,entity_kind:'selector'},relation_policy:'authorized_reference',history_policy:'current'}]};
  const scopeDigest=(await projectionContentDigest(scope)).digest;
  const requested=Promise.withResolvers(), delivered=Promise.withResolvers();
  const calls=[];
  let view;
  const client={clearLocalState(){},async login(){return {status:'201',body:{data:session}};},
    async issueToken(){return {status:'201',body:{data:{expires_in:60}}};},
    async createRequestContext(){return {status:'201',body:{data:{context_id:'context'}}};},
    async createSubscription(request){
      calls.push('create');
      const {issuer_id,issuer_epoch,principal_id,session_id}=session;
      view={scope,selection:contractSelection,purpose:'status_projection',state:'building',revision:'1',
        owner:{kind:'human',issuer_id,issuer_epoch,principal_id,session_id,client_instance_id:request.client_instance_id},
        binding:{subscription_id:'original',publisher_service_id:site.service_id,
          publisher_database_instance_id:site.database_instance_id,scope_digest:scopeDigest}};
      requested.resolve();
      await delivered.promise;
      return {status:'202',body:view};
    },
    async getSubscription(id){calls.push(['read',id]);return {status:'200',body:view};},
    async closeSubscription(id,revision){calls.push(['close',id,revision]);return {status:'200'};}};
  const manager=createSessionManager(site,client,null);
  await manager.login('operator','test-only');
  const start=manager.startStatusProjection(JSON.stringify(scope));
  await requested.promise;
  const stop=manager.stopStatusProjection();
  assert.equal(manager.getSnapshot().statusProjection.phase,'stopping');
  delivered.resolve();
  await Promise.all([start,stop]);
  assert.deepEqual(calls,['create',['read','original'],['close','original','1']]);
  assert.deepEqual(manager.getSnapshot().statusProjection,{phase:'idle',records:[]});
});
