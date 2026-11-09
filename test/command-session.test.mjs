import test from 'node:test';
import assert from 'node:assert/strict';
import {contractSelection} from '@leafseamer/sdk';
import {createSessionManager, validateSite} from '../src/session.ts';
const site = validateSite({format:'leafseamer.gui.site/1',site_label:'测试',service_id:'11111111-1111-4111-8111-111111111111',database_instance_id:'22222222-2222-4222-8222-222222222222',selection:contractSelection});
const scope = {authority_service_id:site.service_id,database_instance_id:site.database_instance_id};
const ref = id => ({id,revision:'9007199254740993',digest:'sha256:'+'a'.repeat(64)});
function fixture() {
  const calls=[], session={permissions:['command.read','command.evidence.read']};
  const command={command_id:'command-a',scope,state:{command_id:'command-a',scope,revision:'9007199254740993'},accepted_at:null,
    evidence_index:{snapshot_ref:ref('snapshot'),state_ref:ref('state'),total:'2'}};
  const item=n=>({command_id:command.command_id,scope,kind:'observation',source_ref:ref('evidence-'+n)});
  const page=(offset=0)=>({command_id:command.command_id,scope,...command.evidence_index,offset:String(offset),items:[item(offset)],next_cursor:offset===0?'next':null});
  const client={clearLocalState(){calls.push('clear');},async login(){return {status:'201',body:{data:session}};},
    async issueToken(input){calls.push(input.requested_scopes);return {status:'201'};},
    async getCommand(id){calls.push(id);return {status:'200',body:{view:'current',record:structuredClone(command)}};},
    async getCommandEvidence(id,query){calls.push(query);return {status:'200',body:page(query.cursor?1:0)};},
    async refresh(){return {status:'200',body:{data:session}};}};
  return {command,session,client,page,calls,manager:createSessionManager(site,client)};
}
async function open(f){await f.manager.login('测试人员','合成密码');await f.manager.readCommand('command-a');}
test('命令及证据使用独立权限，保留null和大整数，后页固定相同修订',async()=>{
  const f=fixture();await open(f);assert.equal(f.manager.getSnapshot().command.accepted_at,null);
  await f.manager.readEvidence();assert.equal(f.manager.getSnapshot().evidence.offset,'0');
  await f.manager.readEvidence(true);assert.equal(f.manager.getSnapshot().evidence.offset,'1');
  assert.deepEqual(f.calls,[['command.read'],'command-a',['command.evidence.read'],{state_revision:'9007199254740993',limit:32},['command.evidence.read'],{state_revision:'9007199254740993',limit:32,cursor:'next'}]);
  await f.manager.refreshSession();assert.equal(f.manager.getSnapshot().command,null);assert.equal(f.manager.getSnapshot().evidence,null);
});
test('命令串台或跨库拒绝；不存在与过期修订明确报告并清理旧内容',async()=>{
  for(const change of [r=>r.command_id='other',r=>r.scope={...scope,database_instance_id:'other'},r=>r.state.command_id='other']){
    const f=fixture();await open(f);change(f.command);await f.manager.readCommand('command-a');assert.equal(f.manager.getSnapshot().command,null);assert.equal(f.manager.getSnapshot().notice,'incompatible');
  }
  for(const [status,notice] of [['404','not_found'],['410','expired_view'],['403','forbidden']]){
    const f=fixture();await open(f);f.client.getCommand=async()=>({status});await f.manager.readCommand('command-a');assert.equal(f.manager.getSnapshot().command,null);assert.equal(f.manager.getSnapshot().notice,notice);
  }
});
test('证据范围、引用、命令身份、重复项及游标循环拒绝，失败页不保留旧证据',async()=>{
  for(const mutate of [p=>p.offset='0',p=>p.total='3',p=>p.snapshot_ref=ref('other'),p=>p.state_ref=ref('other'),p=>p.command_id='other',p=>p.items[0].command_id='other',p=>p.items[0].source_ref=ref('evidence-0'),p=>p.next_cursor='next',p=>p.items=[]]){
    const f=fixture();await open(f);await f.manager.readEvidence();f.client.getCommandEvidence=async()=>{const p=f.page(1);mutate(p);return {status:'200',body:p};};
    await f.manager.readEvidence(true);assert.equal(f.manager.getSnapshot().evidence,null);assert.ok(['stale','incompatible'].includes(f.manager.getSnapshot().notice));
  }
});
test('权限不足不取证据，服务器撤权清证据，会话失效清全部数据',async()=>{
  const f=fixture();await open(f);f.session.permissions=['command.read'];const count=f.calls.length;await f.manager.readEvidence();assert.equal(f.calls.length,count);assert.equal(f.manager.getSnapshot().notice,'forbidden');
  f.session.permissions.push('command.evidence.read');await f.manager.readEvidence();f.client.getCommandEvidence=async()=>({status:'403'});await f.manager.readEvidence(true);assert.equal(f.manager.getSnapshot().evidence,null);
  f.client.getCommand=async()=>({status:'401'});await f.manager.readCommand('command-a');assert.equal(f.manager.getSnapshot().session,null);assert.equal(f.manager.getSnapshot().command,null);
});
test('清理后迟到证据不能回填，非法标识不发请求',async()=>{
  const f=fixture();await open(f);let resolve;f.client.getCommandEvidence=()=>new Promise(r=>resolve=r);const pending=f.manager.readEvidence();
  await new Promise(r=>setImmediate(r));f.manager.clearLocal();resolve({status:'200',body:f.page()});await pending;assert.equal(f.manager.getSnapshot().evidence,null);
  const g=fixture();await open(g);const count=g.calls.length;await g.manager.readCommand('bad id');assert.equal(g.calls.length,count);assert.equal(g.manager.getSnapshot().notice,'invalid_command');
});
