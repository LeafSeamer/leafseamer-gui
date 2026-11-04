import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection} from '@leafseamer/sdk';
import {createSessionManager, validateSite} from '../src/session.ts';
const site = validateSite({format: 'leafseamer.gui.site/1', site_label: '测试站点', service_id: '11111111-1111-4111-8111-111111111111',
  database_instance_id: '22222222-2222-4222-8222-222222222222', selection: contractSelection});
function fixture(pages = [{catalog_revision: '1', items: [{device_id: 'device-a'}], next_cursor: null}]) {
  const calls = [], session = {permissions: ['device.read', 'control.read']}; let index = 0;
  const client = {clearLocalState() { calls.push('clear'); }, async login() { return {status: '201', body: {data: session}}; },
    async issueToken(input) { calls.push(input.requested_scopes); return {status: '201'}; },
    async listDevices() { return {status: '200', body: {data: pages[index++]}}; },
    async getControl(id) { return {status: '200', body: {device_id: id, scope: {authority_service_id: site.service_id, database_instance_id: site.database_instance_id}, effective_version: '9007199254740993'}}; },
    async logout() { return {status: '202'}; }};
  return {client, calls, session, manager: createSessionManager(site, client)};
}
test('完整同修订目录与具名控制记录，逐操作请求权限并保持大整数原文', async () => {
  const f = fixture(); await f.manager.login('测试管理员', '合成密码');
  assert.equal(f.manager.getSnapshot().control.effective_version, '9007199254740993');
  assert.deepEqual(f.calls, [['device.read'], ['control.read']]);
  await f.manager.logout(); assert.equal(f.manager.getSnapshot().session, null); assert.equal(f.manager.getSnapshot().notice, 'logout_pending');
});
test('分页修订改变与重复设备不得发布部分目录', async () => {
  for (const next of [{catalog_revision: '2', items: [], next_cursor: null}, {catalog_revision: '1', items: [{device_id: 'a'}], next_cursor: null}]) {
    const f = fixture([{catalog_revision: '1', items: [{device_id: 'a'}], next_cursor: 'cursor'}, next]); await f.manager.login('管理员', '密码');
    assert.deepEqual(f.manager.getSnapshot().devices, []); assert.equal(f.manager.getSnapshot().notice, 'stale');
  }
});
test('控制记录跨服务或数据库拒收，不展示控制值', async () => {
  const f = fixture(); f.client.getControl = async () => ({status: '200', body: {device_id: 'device-a', scope: {authority_service_id: site.service_id, database_instance_id: 'other'}}});
  await f.manager.login('管理员', '密码'); assert.equal(f.manager.getSnapshot().control, null); assert.equal(f.manager.getSnapshot().notice, 'incompatible');
});
test('本地清理拒绝迟到登录，并且并发动作不重复发送', async () => {
  const f = fixture(); let finish, calls = 0;
  f.client.login = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = f.manager.login('管理员', '密码'); await f.manager.login('管理员', '密码'); f.manager.clearLocal();
  finish({status: '201', body: {data: f.session}}); await pending;
  assert.equal(calls, 1); assert.equal(f.manager.getSnapshot().session, null); assert.equal(f.manager.getSnapshot().busy, false);
});
test('没有目录权限不发设备读取；失败注销仍清除本地会话', async () => {
  const f = fixture(); f.session.permissions = []; await f.manager.login('管理员', '密码');
  assert.equal(f.manager.getSnapshot().notice, 'forbidden'); assert.deepEqual(f.calls, []);
  f.client.logout = async () => { throw new Error('network'); }; await f.manager.logout();
  assert.equal(f.manager.getSnapshot().session, null); assert.equal(f.manager.getSnapshot().notice, 'logout_unconfirmed');
});
test('站点拒绝未知字段与合同选择漂移', () => {
  assert.throws(() => validateSite({...site, baseUrl: 'https://elsewhere.invalid'}));
  assert.throws(() => validateSite({...site, selection: {...contractSelection, contract_digest: 'invalid'}}));
});
