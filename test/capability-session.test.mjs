import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection} from '@leafseamer/sdk';
import {createSessionManager,validateSite} from '../src/session.ts';
const site=validateSite({format:'leafseamer.gui.site/1',site_label:'测试',service_id:'11111111-1111-4111-8111-111111111111',database_instance_id:'22222222-2222-4222-8222-222222222222',selection:contractSelection});
function fixture(){
 const devices=['first','second'].map(device_id=>({device_id,device_kind:'simulator'})),calls=[],session={permissions:['device.read']};
 const client={clearLocalState(){},async login(){return {status:'201',body:{data:session}};},async issueToken(input){calls.push(['token',input.requested_scopes]);return {status:'201'};},
  async listDevices(){return {status:'200',body:{data:{items:devices,catalog_revision:'1',next_cursor:null}}};},
  async getCapabilities(id){calls.push(['capabilities',id]);return {status:'200',body:{service_id:site.service_id,data:{devices:[devices.find(d=>d.device_id===id)],catalog_revision:'1'}}};},
  async refresh(){return {status:'200',body:{data:session}};},async logout(){return {status:'202'};}};
 return {client,calls,session,manager:createSessionManager(site,client,null)};
}
test('只读账户可选择设备，能力读取仅由显式操作触发并申请device.read',async()=>{
 const f=fixture();await f.manager.login('person','password');assert.equal(f.calls.filter(c=>c[0]==='capabilities').length,0);
 await f.manager.selectDevice('second');assert.equal(f.manager.getSnapshot().selected,'second');assert.equal(f.manager.getSnapshot().notice,null);
 await f.manager.readCapabilities();assert.equal(f.manager.getSnapshot().capabilities.devices[0].device_id,'second');
 assert.equal(typeof f.manager.getSnapshot().capabilitiesReadAt,'string');assert.deepEqual(f.calls.at(-2),['token',['device.read']]);
});
test('设备选择、目录刷新、会话续期与注销清除旧能力',async()=>{
 for(const operation of [m=>m.selectDevice('second'),m=>m.refreshDevices(),m=>m.refreshSession(),m=>m.logout()]){
  const f=fixture();await f.manager.login('person','password');await f.manager.readCapabilities();assert.ok(f.manager.getSnapshot().capabilities);
  await operation(f.manager);assert.equal(f.manager.getSnapshot().capabilities,null);assert.equal(f.manager.getSnapshot().capabilitiesReadAt,null);
 }
});
test('失败读取与错服务、错设备、复数设备响应不得保留旧能力',async()=>{
 for(const response of [{status:'503'},{status:'403'},{status:'404'},
  {status:'200',body:{service_id:'other',data:{devices:[{device_id:'first',device_kind:'simulator'}]}}},
  {status:'200',body:{service_id:site.service_id,data:{devices:[{device_id:'other',device_kind:'simulator'}]}}},
  {status:'200',body:{service_id:site.service_id,data:{devices:[{device_id:'first',device_kind:'simulator'},{device_id:'second',device_kind:'simulator'}]}}}]){
  const f=fixture();await f.manager.login('person','password');await f.manager.readCapabilities();f.client.getCapabilities=async()=>response;
  await f.manager.readCapabilities();assert.equal(f.manager.getSnapshot().capabilities,null);assert.equal(f.manager.getSnapshot().capabilitiesReadAt,null);assert.ok(f.manager.getSnapshot().notice);
 }
});
test('清理后的迟到能力响应不能重新进入界面，并发点击不重复发送',async()=>{
 const f=fixture();await f.manager.login('person','password');let finish;const old=f.client.getCapabilities;
 f.client.getCapabilities=async id=>new Promise(resolve=>{finish=async()=>resolve(await old(id));});
 const pending=f.manager.readCapabilities();while(!finish)await Promise.resolve();await f.manager.readCapabilities();f.manager.clearLocal();await finish();await pending;
 assert.equal(f.manager.getSnapshot().capabilities,null);assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.calls.filter(c=>c[0]==='capabilities').length,1);
});
