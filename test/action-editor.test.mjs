import test from 'node:test';
import assert from 'node:assert/strict';
import {actionSteps,applyActionEdit,checkParameterBindings,selectedActionSources,parseParameterJson} from '../src/action-editor.ts';
import {registered} from '../../leafseamer-controller/test/fixtures/device-bindings.mjs';
import {source,ref} from '../../leafseamer/test/automation-program-fixture.mjs';
import {compileProgram} from '../../leafseamer/dist/automation-compiler.mjs';
function fixture(t){
 const bundle=registered(t).bindings(),model=source(),scope={authority_service_id:'seamer',database_instance_id:'db'},content={program:model.program,policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:ref.digest},selections:bundle.bindings.map(({kind,binding_id,content_ref})=>({kind,binding_id,content_ref}))};
 const state={busy:false,draft:{definition_id:'definition',scope},bindingApproval:{scope,definition_id:'definition',state:'approved',purpose:'definition_compile',bundle},draftHistorical:false,bindingHistorical:false,bindingRecovery:null,bindingPreparation:null,draftRecovery:null};
 const action=bundle.bindings.find(b=>b.kind==='action'),input=bundle.bindings.find(b=>b.kind==='input'),binding={target_pointer:'/value',value:{kind:'ref',binding_id:input.binding_id,source:'observation',pointer:'/value'}};
 return {bundle,model,state,content,action,input,binding,text:JSON.stringify(content)};
}
test('规则动作参数只改目标步骤并保留其余字段，实际编译器接纳相同投影类型',t=>{
 const f=fixture(t),entry=actionSteps(f.content)[0],edit={action_binding_id:f.action.binding_id,parameters:'{"value":3}',parameter_bindings:[f.binding]};
 const result=JSON.parse(applyActionEdit(f.text,f.state,entry.path,edit)),step=result.program.groups[0].steps[0];
 assert.deepEqual(step,{...entry.step,action_binding_id:f.action.binding_id,parameters:{value:3},parameter_bindings:[f.binding]});assert.deepEqual(result.program.groups[0].steps[1],f.content.program.groups[0].steps[1]);assert.deepEqual(result.selections,f.content.selections);assert.deepEqual(result.policy_ref,f.content.policy_ref);
 const compiled=compileProgram({...f.model,program:result.program,input_bindings:[...f.model.input_bindings,f.input.value],action_bindings:[...f.model.action_bindings,f.action.value]});assert.equal(compiled.stepPlan(step.step_id).parameters[0].value.tree.value_type.kind,'binary64');
});
test('状态机exit/transition/enter分别精确编辑，不更改状态、优先级、触发器和其它步骤',t=>{
 const f=fixture(t),step=f.model.program.groups[0].steps[0];f.content.program={kind:'state_machine',states:['a','b'],initial_state:'a',transitions:[{transition_id:'move',from_state:'a',to_state:'b',priority:1,trigger_binding_id:'trigger',condition:{kind:'literal',value:false},exit:[{...step,step_id:'exit'}],transition:[{...step,step_id:'move'}],enter:[{...step,step_id:'enter'}]}]};
 const entries=actionSteps(f.content);assert.equal(entries.length,3);
 for(const [i,key] of ['exit','transition','enter'].entries()){
  const result=JSON.parse(applyActionEdit(JSON.stringify(f.content),f.state,entries[i].path,{action_binding_id:f.action.binding_id,parameters:'{"value":2}',parameter_bindings:[]}));
  const expected=structuredClone(f.content);expected.program.transitions[0][key][0]={...expected.program.transitions[0][key][0],action_binding_id:f.action.binding_id,parameters:{value:2}};assert.deepEqual(result,expected);
 }
});
test('精确选择、当前批准、类型、单位、来源种类与目标重叠逐项拒绝',t=>{
 const f=fixture(t),sources=selectedActionSources(f.content,f.state),check=bindings=>checkParameterBindings(f.action,sources,bindings);
 assert.throws(()=>check([{...f.binding,value:{...f.binding.value,pointer:'/sample_sequence'}}]),{code:'actionEditType'});
 assert.throws(()=>check([{...f.binding,value:{...f.binding.value,source:'event'}}]),{code:'actionEditSource'});
 assert.throws(()=>check([{...f.binding,value:{kind:'literal',value:'7'}}]),{code:'actionEditType'});
 check([{...f.binding,value:{kind:'literal',value:7}}]);assert.throws(()=>check([f.binding,f.binding]),{code:'actionEditOverlap'});
 const changed=structuredClone(sources);changed.find(s=>s.kind==='input').value.projections[0].value_type.unit='dB';assert.throws(()=>checkParameterBindings(f.action,changed,[f.binding]),{code:'actionEditType'});
 const nested={...f.action,value:{...f.action.value,parameter_slots:[...f.action.value.parameter_slots,{pointer:'/value/nested',value_type:{kind:'binary64',unit:null}}]}};assert.throws(()=>checkParameterBindings(nested,sources,[f.binding,{...f.binding,target_pointer:'/value/nested'}]),{code:'actionEditOverlap'});
 const edit={action_binding_id:f.action.binding_id,parameters:'{}',parameter_bindings:[]},path=actionSteps(f.content)[0].path;
 for(const patch of [{bindingHistorical:true},{bindingApproval:{...f.state.bindingApproval,state:'revoked'}},{bindingApproval:{...f.state.bindingApproval,definition_id:'other'}},{bindingApproval:{...f.state.bindingApproval,scope:{...f.state.bindingApproval.scope,database_instance_id:'other'}}}])assert.throws(()=>applyActionEdit(f.text,{...f.state,...patch},path,edit),{code:'actionEditSource'});
 for(const patch of [{busy:true},{draftRecovery:{}},{bindingPreparation:{}},{bindingRecovery:{}}])assert.throws(()=>applyActionEdit(f.text,{...f.state,...patch},path,edit),{code:'actionEditStale'});
 const stale=structuredClone(f.content);stale.selections.find(s=>s.kind==='action').content_ref.digest='sha256:'+'b'.repeat(64);assert.throws(()=>applyActionEdit(JSON.stringify(stale),f.state,path,edit),{code:'actionEditSource'});
 assert.throws(()=>applyActionEdit(f.text,f.state,'/program/nope',edit),{code:'actionEditStale'});
 for(const parameters of ['[]','null','1','{"value":1e400}'])assert.throws(()=>applyActionEdit(f.text,f.state,path,{...edit,parameters}),{code:'actionEditInvalid'});
 assert.deepEqual(parseParameterJson('{"__proto__":{"value":1}}'),JSON.parse('{"__proto__":{"value":1}}'));assert.equal({}.value,undefined);
});
