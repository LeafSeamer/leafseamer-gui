import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedBindings,bindingUses,editSelection,parseSelectionContent} from '../src/binding-selection.ts';
import {registered} from '../../leafseamer-controller/test/fixtures/device-bindings.mjs';
const scope={authority_service_id:'11111111-1111-4111-8111-111111111111',database_instance_id:'22222222-2222-4222-8222-222222222222'};
const literal={kind:'literal',value:true},ref=id=>({kind:'ref',source:'observation',binding_id:id,pointer:'/value'});
const action={kind:'action',step_id:'step',depends_on:[],required:true,failure_policy:'stop',action_binding_id:'action',guard:literal,parameters:{value:{kind:'ref',binding_id:'ordinary-json'}},parameter_bindings:[]};
const content=()=>({policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:'sha256:'+'a'.repeat(64)},program:{kind:'rule',trigger_binding_id:'event',condition:literal,groups:[{mode:'sequence',steps:[structuredClone(action)]}]},selections:[]});
test('选择编辑保存完整原文语义，仅复制精确引用，重复和隐式替换被拒绝',t=>{
 const bindings=registered(t).bindings().bindings,original=content(),text=JSON.stringify(original);let edited=text;
 for(const binding of bindings)edited=editSelection(edited,{kind:'add',binding});const parsed=parseSelectionContent(edited);
 assert.deepEqual(parsed.program,original.program);assert.deepEqual(parsed.policy_ref,original.policy_ref);assert.deepEqual(parsed.selections,bindings.map(({kind,binding_id,content_ref})=>({kind,binding_id,content_ref})));assert.deepEqual(original,content());
 assert.throws(()=>editSelection(edited,{kind:'add',binding:bindings[0]}),{code:'selectionConflict'});
 const changed={...bindings[0],content_ref:{...bindings[0].content_ref,revision:'2',digest:'sha256:'+'b'.repeat(64)}};
 const replaced=parseSelectionContent(editSelection(edited,{kind:'replace',binding:changed}));assert.deepEqual(replaced.selections[0].content_ref,changed.content_ref);assert.deepEqual(replaced.program,original.program);
 assert.throws(()=>editSelection(edited,{kind:'replace',binding:{...changed,kind:'action'}}),{code:'selectionConflict'});
 const removed=parseSelectionContent(editSelection(edited,{kind:'remove',binding_id:bindings[0].binding_id}));assert.equal(removed.selections.length,1);assert.deepEqual(removed.program,original.program);
 const duplicate={...original,selections:[parsed.selections[0],parsed.selections[0]]};assert.throws(()=>parseSelectionContent(JSON.stringify(duplicate)),{code:'selectionInvalid'});
});
test('只识别具名表达式引用，覆盖规则与状态机，不把literal和普通参数当引用',()=>{
 const c=content(),s=c.program.groups[0].steps[0];s.guard={kind:'all',items:[{kind:'not',item:{kind:'exists',value:ref('observation')}},{kind:'compare',operator:'eq',value_type:{kind:'json',unit:null},left:{kind:'literal',value:{kind:'ref',binding_id:'literal-json'}},right:ref('observation')}]};s.parameter_bindings=[{target_pointer:'/value',value:ref('parameter')}];
 assert.deepEqual(bindingUses(c.program,'event'),['/program/trigger_binding_id']);assert.deepEqual(bindingUses(c.program,'action'),['/program/groups/0/steps/0/action_binding_id']);assert.equal(bindingUses(c.program,'observation').length,2);assert.equal(bindingUses(c.program,'parameter').length,1);
 assert.deepEqual(bindingUses(c.program,'ordinary-json'),[]);assert.deepEqual(bindingUses(c.program,'literal-json'),[]);
 const machine={kind:'state_machine',states:['a','b'],initial_state:'a',transitions:[{transition_id:'t',from_state:'a',to_state:'b',priority:0,trigger_binding_id:'event',condition:{kind:'is_null',value:ref('condition')},exit:[s],transition:[s],enter:[s]}]};
 assert.equal(bindingUses(machine,'action').length,3);assert.equal(bindingUses(machine,'observation').length,6);assert.deepEqual(bindingUses(machine,'event'),['/program/transitions/0/trigger_binding_id']);assert.deepEqual(bindingUses(machine,'condition'),['/program/transitions/0/condition/value']);
 c.selections=[{kind:'action',binding_id:'action',content_ref:{id:'action',revision:'1',digest:'sha256:'+'a'.repeat(64)}}];assert.throws(()=>editSelection(JSON.stringify(c),{kind:'remove',binding_id:'action'}),{code:'selectionReferenced'});
});
test('历史、撤销、跨定义、跨库及未确认批准不能成为添加来源',t=>{
 const bundle=registered(t).bindings(),draft={definition_id:'definition',scope},approval={scope,definition_id:'definition',state:'approved',purpose:'definition_compile',bundle};
 const state={draft,bindingApproval:approval,draftHistorical:false,bindingHistorical:false,bindingRecovery:null,bindingPreparation:null};assert.equal(approvedBindings(state).length,2);
 for(const patch of [{draftHistorical:true},{bindingHistorical:true},{bindingRecovery:{}},{bindingPreparation:{}},{draft:null},{bindingApproval:{...approval,state:'revoked'}},{bindingApproval:{...approval,definition_id:'other'}},{bindingApproval:{...approval,scope:{...scope,database_instance_id:'other'}}}])assert.deepEqual(approvedBindings({...state,...patch}),[]);
});
