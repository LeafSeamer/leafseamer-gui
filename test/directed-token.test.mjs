import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectedToken} from '../src/directed-token.ts';
test('复用同会话足够权限的原令牌，期限含往返且不因读取续期，换会话与reset重新签发',async t=>{
 let now=100,owner={},calls=0,latency=0;t.mock.method(performance,'now',()=>now);
 const token=createDirectedToken({session:()=>owner,accept:(status)=>assert.equal(status,'201'),ready:()=>({async issueToken(){calls++;now+=latency;return {status:'201',body:{data:{expires_in:1}}};}})});
 await token.ensure(['auth.read','request.read'],()=>{});now=500;await token.ensure(['auth.read'],()=>{});assert.equal(calls,1);
 now=1100;await token.ensure(['auth.read'],()=>{});assert.equal(calls,2);await token.ensure(['auth.manage'],()=>{});assert.equal(calls,3);
 owner={};await token.ensure(['auth.manage'],()=>{});assert.equal(calls,4);token.reset();await token.ensure(['auth.manage'],()=>{});assert.equal(calls,5);
 token.reset();latency=1000;await token.ensure(['auth.read'],()=>{});await token.ensure(['auth.read'],()=>{});assert.equal(calls,7);
});
test('拒绝、签发异常与无有效期限不恢复旧复用提示，迟到响应不能建立提示',async()=>{
 let owner={},calls=0,result={status:'201',body:{data:{expires_in:60}}},failure=false;
 const token=createDirectedToken({session:()=>owner,accept:status=>{if(status!=='201')throw new Error('denied');},ready:()=>({async issueToken(){calls++;if(failure)throw new Error('network');return result;}})});
 await token.ensure(['read'],()=>{});result={status:'403'};await assert.rejects(token.ensure(['manage'],()=>{}),/denied/);result={status:'201',body:{data:{expires_in:60}}};await token.ensure(['read'],()=>{});assert.equal(calls,3);
 failure=true;await assert.rejects(token.ensure(['manage'],()=>{}),/network/);failure=false;await token.ensure(['read'],()=>{});assert.equal(calls,5);
 token.reset();result={status:'201',body:{data:{expires_in:0}}};await token.ensure(['read'],()=>{});await token.ensure(['read'],()=>{});assert.equal(calls,7);
 result={status:'201',body:{data:{expires_in:60}}};let checks=0;await assert.rejects(token.ensure(['read'],()=>{if(++checks===2)throw new Error('late');}),/late/);await token.ensure(['read'],()=>{});assert.equal(calls,9);
 owner=null;await token.ensure(['read'],()=>{});owner={};await token.ensure(['read'],()=>{});assert.equal(calls,11);
});
