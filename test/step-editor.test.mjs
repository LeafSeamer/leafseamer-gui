import test from 'node:test';
import assert from 'node:assert/strict';
import {stepContainers,stepPositions,editSteps,newActionStep,checkStepStructure,applyStepPreview} from '../src/step-editor.ts';
import {source,ref,step,delay,input,reference} from '../../leafseamer/test/automation-program-fixture.mjs';
import {compileProgram} from '../../leafseamer/dist/automation-compiler.mjs';

function fixture(){
 const model=source(),scope={authority_service_id:'seamer',database_instance_id:'db'},bindings=[...model.input_bindings.map(value=>({kind:'input',binding_id:value.binding_id,content_ref:ref,value})),...model.action_bindings.map(value=>({kind:'action',binding_id:value.binding_id,content_ref:ref,value}))];
 const content={program:model.program,policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:ref.digest},selections:bindings.map(({kind,binding_id,content_ref})=>({kind,binding_id,content_ref}))};
 const state={busy:false,draft:{definition_id:'definition',scope},bindingApproval:{scope,definition_id:'definition',state:'approved',purpose:'definition_compile',bundle:{bindings}},draftHistorical:false,bindingHistorical:false,bindingRecovery:null,bindingPreparation:null,draftRecovery:null};
 return {model,content,state,text:()=>JSON.stringify(content),edit(edit,text=JSON.stringify(content)){return editSteps(text,state,edit);}};
}
const container='/program/groups/0/steps';
test('新增动作与延迟、移动、删除及依赖设置保留其它文档字段，实际编译器接纳结果',()=>{
 const f=fixture(),original=f.text();let text=f.edit({kind:'add',container,step:newActionStep('third','action','{"value":true}')});
 text=f.edit({kind:'add',container,step:delay('wait')},text);text=f.edit({kind:'move',step_id:'wait',direction:-1},text);
 text=f.edit({kind:'configure',step_id:'third',depends_on:['first','wait'],required:false,failure_policy:'continue_if_independent'},text);
 text=f.edit({kind:'remove',step_id:'second'},text);assert.equal(f.text(),original);
 const result=JSON.parse(text);assert.deepEqual(result.program.groups[0].steps.map(s=>s.step_id),['first','wait','third']);assert.deepEqual(result.selections,f.content.selections);assert.deepEqual(result.policy_ref,f.content.policy_ref);assert.deepEqual(result.program.groups[0].steps[0],f.content.program.groups[0].steps[0]);
 assert.equal(applyStepPreview(original,text,f.state),text);compileProgram({...f.model,program:result.program});
});
test('显式依赖阻止删除、反向重排、同并行组及跨状态转换依赖',()=>{
 const f=fixture();f.content.program.groups[0].steps[1].depends_on=['first'];
 for(const edit of [{kind:'remove',step_id:'first'},{kind:'move',step_id:'first',direction:1},{kind:'configure',step_id:'second',depends_on:['missing'],required:true,failure_policy:'stop'}])assert.throws(()=>f.edit(edit),{code:'stepEditDependency'});
 f.content.program.groups[0].mode='parallel';assert.throws(()=>checkStepStructure(f.content,f.state),{code:'stepEditDependency'});
 const transition=id=>({transition_id:id,from_state:'a',to_state:'a',priority:0,trigger_binding_id:'trigger',condition:{kind:'literal',value:true},exit:[step(id+'-exit')],transition:[],enter:[step(id+'-enter')]});
 f.content.program={kind:'state_machine',initial_state:'a',states:['a'],transitions:[transition('one'),transition('two')]};
 assert.equal(stepContainers(f.content).length,6);assert.deepEqual(stepPositions(f.content).map(p=>p.rank),[0,1,0,1]);
 assert.throws(()=>f.edit({kind:'configure',step_id:'two-enter',depends_on:['one-exit'],required:true,failure_policy:'stop'}),{code:'stepEditDependency'});
 let text=f.edit({kind:'configure',step_id:'one-enter',depends_on:['one-exit'],required:true,failure_policy:'stop'});
 text=f.edit({kind:'add',container:'/program/transitions/0/transition',step:delay('between')},text);compileProgram({...f.model,program:JSON.parse(text).program});
 assert.throws(()=>f.edit({kind:'remove',step_id:'one-exit'},text),{code:'stepEditDependency'});
 for(const phase of ['exit','transition','enter']){const added=f.edit({kind:'add',container:'/program/transitions/1/'+phase,step:delay('new')});const removed=f.edit({kind:'remove',step_id:'new'},added);assert.deepEqual(JSON.parse(removed),f.content);}
});
test('隐式结果依赖要求当前精确来源；普通参数与literal中的JSON不产生依赖',()=>{
 const f=fixture(),value=input('result','step_result','first'),binding={kind:'input',binding_id:'result',content_ref:ref,value};f.state.bindingApproval.bundle.bindings.push(binding);f.content.selections.push({kind:'input',binding_id:'result',content_ref:ref});
 f.content.program.groups[0].steps[1].parameter_bindings=[{target_pointer:'/value',value:reference('result','step_result')}];
 checkStepStructure(f.content,f.state);compileProgram({...f.model,program:f.content.program,input_bindings:[...f.model.input_bindings,value]});
 for(const edit of [{kind:'remove',step_id:'first'},{kind:'move',step_id:'second',direction:-1}])assert.throws(()=>f.edit(edit),{code:'stepEditDependency'});
 f.content.program.groups[0].steps[1].parameter_bindings=[];f.content.program.groups[0].steps[1].guard={kind:'exists',value:reference('result','step_result')};assert.throws(()=>f.edit({kind:'remove',step_id:'first'}),{code:'stepEditDependency'});
 assert.throws(()=>checkStepStructure(f.content,{...f.state,bindingHistorical:true}),{code:'stepEditSource'});
 const stale=structuredClone(f.content);stale.selections.find(s=>s.binding_id==='result').content_ref.digest='sha256:'+'b'.repeat(64);assert.throws(()=>checkStepStructure(stale,f.state),{code:'stepEditSource'});
 f.content.program.groups[0].steps[1].guard={kind:'literal',value:true};f.content.program.groups[0].steps[1].parameters={value:reference('result','step_result')};f.content.program.groups[0].steps[1].parameter_bindings=[{target_pointer:'/value',value:{kind:'literal',value:reference('result','step_result')}}];
 assert.doesNotThrow(()=>f.edit({kind:'remove',step_id:'first'}));
 f.content.program.condition={kind:'exists',value:reference('result','step_result')};assert.throws(()=>checkStepStructure(f.content,f.state),{code:'stepEditDependency'});
});
test('结构容量、唯一ID、数值、必需与并行失败策略限制均拒绝，单组不能删空',()=>{
 const f=fixture();for(const added of [step('first'),{...delay('bad'),delay_ms:-1},{...delay('bad'),delay_ms:1.5},{...delay('bad'),max_lateness_ms:0}])assert.throws(()=>f.edit({kind:'add',container,step:added}));
 let text=f.edit({kind:'remove',step_id:'first'});assert.throws(()=>f.edit({kind:'remove',step_id:'second'},text),{code:'stepEditInvalid'});
 for(const required of [true,false]){f.content.program.groups[0].mode='parallel';assert.throws(()=>f.edit({kind:'configure',step_id:'first',depends_on:[],required,failure_policy:'continue_if_independent'}),{code:'stepEditInvalid'});}
 f.content.program.groups[0].mode='sequence';f.content.program.groups.push({mode:'parallel',steps:[step('parallel')]});assert.throws(()=>f.edit({kind:'configure',step_id:'first',depends_on:[],required:false,failure_policy:'continue_if_independent'}),{code:'stepEditInvalid'});
 f.content.program.groups[0].steps=Array.from({length:64},(_,i)=>delay('step'+i));assert.throws(()=>f.edit({kind:'add',container,step:delay('overflow')}),{code:'stepEditInvalid'});
});
test('预览确认重核新增动作的批准；历史、恢复及忙碌状态不写，未选择动作不能新增',()=>{
 const f=fixture(),text=f.edit({kind:'add',container,step:newActionStep('new','action','{}')});
 assert.throws(()=>applyStepPreview(f.text(),text,{...f.state,bindingHistorical:true}),{code:'stepEditSource'});
 const removed=f.edit({kind:'remove',step_id:'first'}),reused=f.edit({kind:'add',container,step:newActionStep('first','action','{"value":true}')},removed);
 assert.throws(()=>applyStepPreview(f.text(),reused,{...f.state,bindingHistorical:true}),{code:'stepEditSource'});
 for(const patch of [{busy:true},{draftRecovery:{}},{draftHistorical:true},{bindingRecovery:{}},{bindingPreparation:{}}]){
  assert.throws(()=>editSteps(f.text(),{...f.state,...patch},{kind:'remove',step_id:'first'}),{code:'stepEditStale'});assert.throws(()=>applyStepPreview(f.text(),text,{...f.state,...patch}),{code:'stepEditStale'});
 }
 assert.throws(()=>f.edit({kind:'add',container,step:newActionStep('new','unknown','{}')}),{code:'stepEditSource'});
 for(const parameters of ['null','[]','{"value":1e400}'])assert.throws(()=>newActionStep('new','action',parameters));
});
