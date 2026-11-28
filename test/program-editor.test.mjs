import test from 'node:test';
import assert from 'node:assert/strict';
import {editProgram,applyProgramPreview} from '../src/program-editor.ts';
import {source,ref,step,delay,input,reference} from '../../leafseamer/test/automation-program-fixture.mjs';
import {compileProgram} from '../../leafseamer/dist/automation-compiler.mjs';

function fixture(){
 const model=source(),scope={authority_service_id:'seamer',database_instance_id:'db'},bindings=[...model.input_bindings.map(value=>({kind:'input',binding_id:value.binding_id,content_ref:ref,value})),...model.action_bindings.map(value=>({kind:'action',binding_id:value.binding_id,content_ref:ref,value}))];
 const content={program:model.program,policy_ref:{kind:'policy',scope,object_id:'policy',revision:'1',digest:ref.digest},selections:bindings.map(({kind,binding_id,content_ref})=>({kind,binding_id,content_ref}))};
 const state={busy:false,draft:{definition_id:'definition',scope},bindingApproval:{scope,definition_id:'definition',state:'approved',purpose:'definition_compile',bundle:{bindings}},draftHistorical:false,bindingHistorical:false,bindingRecovery:null,bindingPreparation:null,draftRecovery:null};
 return {model,content,state,text:()=>JSON.stringify(content),edit(edit,text=JSON.stringify(content)){return editProgram(text,state,edit);}};
}
const transition=(id,extra={})=>({transition_id:id,from_state:'idle',to_state:'running',priority:0,trigger_binding_id:'trigger',condition:{kind:'literal',value:true},exit:[],transition:[],enter:[],...extra});
const machine=f=>{f.content.program={kind:'state_machine',states:['idle','running'],initial_state:'idle',transitions:[transition('start',{exit:[step('first')],enter:[step('second')]})]};return f;};
test('规则触发器只采用当前批准且精确选择的事件，修改保留原条件和步骤',()=>{
 const f=fixture(),alternate=input('alternate'),selection={kind:'input',binding_id:alternate.binding_id,content_ref:ref};
 f.state.bindingApproval.bundle.bindings.push({...selection,value:alternate});
 const change={kind:'rule-trigger',trigger_binding_id:alternate.binding_id};
 assert.throws(()=>f.edit(change),{code:'stepEditSource'});
 f.content.selections.push(selection);
 const original=f.text(),preview=f.edit(change),updated=JSON.parse(preview);
 assert.deepEqual(updated,{...f.content,program:{...f.content.program,trigger_binding_id:'alternate'}});
 compileProgram({...f.model,input_bindings:[...f.model.input_bindings,alternate],program:updated.program});
 assert.equal(f.text(),original);
 assert.equal(applyProgramPreview(original,preview,f.state),preview);
 assert.throws(()=>applyProgramPreview(original,preview,{...f.state,bindingHistorical:true}),{code:'stepEditSource'});
 alternate.source='observation';assert.throws(()=>f.edit(change),{code:'stepEditSource'});
 assert.throws(()=>machine(f).edit(change),{code:'stepEditInvalid'});
});
test('规则组新增、模式、重排、删除与跨组移动保持文档并由实际编译器接纳',()=>{
 const f=fixture(),original=f.text();let text=f.edit({kind:'group-add',mode:'parallel',step:delay('wait')});
 text=f.edit({kind:'relocate',step_id:'second',container:'/program/groups/1/steps',index:0},text);
 assert.deepEqual(JSON.parse(text).program.groups.map(g=>g.steps.map(s=>s.step_id)),[['first'],['second','wait']]);
 text=f.edit({kind:'group-mode',index:1,mode:'sequence'},text);text=f.edit({kind:'group-move',index:1,direction:-1},text);compileProgram({...f.model,program:JSON.parse(text).program});
 text=f.edit({kind:'group-remove',index:1},text);const result=JSON.parse(text);assert.deepEqual(result.program.groups[0].steps.map(s=>s.step_id),['second','wait']);assert.deepEqual(result.selections,f.content.selections);assert.deepEqual(result.policy_ref,f.content.policy_ref);assert.equal(f.text(),original);assert.equal(applyProgramPreview(original,text,f.state),text);
});
test('组变化不得破坏显式或结果依赖，迁出最后步骤、重复ID与容量均拒绝',()=>{
 const f=fixture();f.content.program.groups[0].steps[1].depends_on=['first'];assert.throws(()=>f.edit({kind:'group-mode',index:0,mode:'parallel'}),{code:'stepEditDependency'});
 let text=f.edit({kind:'group-add',mode:'sequence',step:delay('wait')});text=f.edit({kind:'relocate',step_id:'second',container:'/program/groups/1/steps',index:0},text);
 assert.throws(()=>f.edit({kind:'group-move',index:0,direction:1},text),{code:'stepEditDependency'});assert.throws(()=>f.edit({kind:'group-remove',index:0},text),{code:'stepEditDependency'});assert.throws(()=>f.edit({kind:'relocate',step_id:'first',container:'/program/groups/1/steps',index:0},text),{code:'stepEditInvalid'});
 assert.throws(()=>f.edit({kind:'group-add',mode:'sequence',step:delay('first')}),{code:'stepEditInvalid'});
 f.content.program.groups[0].steps[1].depends_on=[];const binding={kind:'input',binding_id:'result',content_ref:ref,value:input('result','step_result','first')};f.state.bindingApproval.bundle.bindings.push(binding);f.content.selections.push({kind:'input',binding_id:'result',content_ref:ref});f.content.program.groups[0].steps[1].guard={kind:'exists',value:reference('result','step_result')};
 assert.throws(()=>f.edit({kind:'group-mode',index:0,mode:'parallel'}),{code:'stepEditDependency'});
 f.content.program.groups=Array.from({length:64},(_,i)=>({mode:'sequence',steps:[delay('wait'+i)]}));assert.throws(()=>f.edit({kind:'group-add',mode:'sequence',step:delay('overflow')}),{code:'stepEditInvalid'});
});
test('状态、初始状态、转换端点与优先级编辑保留条件阶段并拒绝悬空引用',()=>{
 const f=machine(fixture()),original=f.text();let text=f.edit({kind:'state-add',name:'ready'});text=f.edit({kind:'state-initial',name:'ready'},text);
 text=f.edit({kind:'transition-configure',id:'start',from_state:'ready',to_state:'running',priority:7,trigger_binding_id:'trigger'},text);let result=JSON.parse(text);assert.deepEqual(result.program.transitions[0],{...f.content.program.transitions[0],from_state:'ready',priority:7});
 text=f.edit({kind:'state-remove',name:'idle'},text);text=f.edit({kind:'transition-add',transition:transition('return',{from_state:'running',to_state:'ready'})},text);compileProgram({...f.model,program:JSON.parse(text).program});
 text=f.edit({kind:'transition-remove',id:'start'},text);assert.equal(JSON.parse(text).program.transitions.length,1);assert.equal(f.text(),original);
 for(const edit of [{kind:'state-remove',name:'ready'},{kind:'state-remove',name:'running'},{kind:'state-initial',name:'missing'},{kind:'transition-remove',id:'return'},{kind:'state-add',name:'ready'},{kind:'transition-configure',id:'return',from_state:'missing',to_state:'ready',priority:0,trigger_binding_id:'trigger'}])assert.throws(()=>f.edit(edit,text),{code:'stepEditInvalid'});
 assert.throws(()=>f.edit({kind:'transition-add',transition:transition('start')}),{code:'stepEditInvalid'});
});
test('跨阶段移动和延迟编辑保留依赖，只接受同分支更早的生产者',()=>{
 const f=machine(fixture());f.content.program.transitions[0].enter[0].depends_on=['first'];let text=f.edit({kind:'relocate',step_id:'first',container:'/program/transitions/0/transition',index:0});
 assert.deepEqual(JSON.parse(text).program.transitions[0].exit,[]);compileProgram({...f.model,program:JSON.parse(text).program});
 assert.throws(()=>f.edit({kind:'relocate',step_id:'first',container:'/program/transitions/0/enter',index:1},text),{code:'stepEditDependency'});
 text=f.edit({kind:'transition-add',transition:transition('other')},text);assert.throws(()=>f.edit({kind:'relocate',step_id:'first',container:'/program/transitions/1/enter',index:0},text),{code:'stepEditDependency'});
 f.content.program.transitions[0].transition=[delay('wait')];text=f.edit({kind:'delay',step_id:'wait',delay_ms:350,max_lateness_ms:10});assert.deepEqual(JSON.parse(text).program.transitions[0].transition[0],{...delay('wait'),delay_ms:350,max_lateness_ms:10});
 for(const [delay_ms,max_lateness_ms] of [[1.5,100],[0,0],[86400001,1]])assert.throws(()=>f.edit({kind:'delay',step_id:'wait',delay_ms,max_lateness_ms}),{code:'stepEditInvalid'});
 assert.throws(()=>f.edit({kind:'delay',step_id:'first',delay_ms:0,max_lateness_ms:1}),{code:'stepEditInvalid'});
});
test('新事件采用在预览和确认时都核验批准，观察输入不能冒充事件',()=>{
 const f=machine(fixture()),text=f.edit({kind:'transition-add',transition:transition('new')});assert.throws(()=>applyProgramPreview(f.text(),text,{...f.state,bindingHistorical:true}),{code:'stepEditSource'});
 f.state.bindingApproval.bundle.bindings[0].value.source='observation';assert.throws(()=>f.edit({kind:'transition-add',transition:transition('new')}),{code:'stepEditSource'});
 assert.doesNotThrow(()=>f.edit({kind:'transition-configure',id:'start',from_state:'running',to_state:'idle',priority:1,trigger_binding_id:'trigger'}));
 assert.throws(()=>f.edit({kind:'transition-configure',id:'start',from_state:'running',to_state:'idle',priority:1,trigger_binding_id:'unverified'}),{code:'stepEditSource'});
 for(const patch of [{busy:true},{draftHistorical:true},{draftRecovery:{}},{bindingPreparation:{}},{bindingRecovery:{}}])assert.throws(()=>editProgram(f.text(),{...f.state,...patch},{kind:'state-add',name:'new'}),{code:'stepEditStale'});
});
