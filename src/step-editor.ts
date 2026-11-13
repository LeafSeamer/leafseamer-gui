import {validateAutomationModel} from '@leafseamer/sdk/automation-program';
import type {AutomationModels} from '@leafseamer/sdk/automation-program';
import type {Snapshot} from './session.ts';
import {parseSelectionContent} from './binding-selection.ts';
import type {DraftContent} from './binding-selection.ts';
import {selectedActionSources,parseParameterJson} from './action-editor.ts';

export type Step=AutomationModels['Step'];
export class StepEditError extends Error{
 code:'stepEditInvalid'|'stepEditDependency'|'stepEditSource'|'stepEditStale';
 constructor(code:StepEditError['code']){super(code);this.code=code;}
}
const need=(ok:unknown,code:StepEditError['code'])=>{if(!ok)throw new StepEditError(code);};
export function stepContainers(content:DraftContent){
 const p=content.program;
 if(p.kind==='rule')return p.groups.map((g,i)=>({path:'/program/groups/'+i+'/steps',branch:'rule',mode:g.mode,steps:g.steps}));
 return p.transitions.flatMap((t,i)=>(['exit','transition','enter'] as const).map(k=>({path:'/program/transitions/'+i+'/'+k,branch:t.transition_id,mode:'sequence' as const,steps:t[k]})));
}
export function stepPositions(content:DraftContent){
 const positions:{step:Step;path:string;index:number;branch:string;rank:number}[]=[],ranks=new Map<string,number>();
 for(const c of stepContainers(content)){let rank=ranks.get(c.branch)??0;c.steps.forEach((step,index)=>{positions.push({step,path:c.path,index,branch:c.branch,rank});if(c.mode==='sequence')rank++;});if(c.mode==='parallel')rank++;ranks.set(c.branch,rank);}
 return positions;
}
// 只读取DSL的引用节点，参数及literal内的普通JSON不参与依赖分析。
function conditionRefs(c:AutomationModels['Condition']):Extract<AutomationModels['Value'],{kind:'ref'}>[]{
 const ref=(v:AutomationModels['Value'])=>v.kind==='ref'?[v]:[];
 if(c.kind==='compare')return [...ref(c.left),...ref(c.right)];
 if(c.kind==='all'||c.kind==='any')return c.items.flatMap(conditionRefs);
 if(c.kind==='not')return conditionRefs(c.item);
 if(c.kind==='exists'||c.kind==='is_null')return ref(c.value);return [];
}
export function checkStepStructure(content:DraftContent,state:Snapshot){
 const p=content.program,positions=stepPositions(content),nodes=new Map(positions.map(n=>[n.step.step_id,n]));
 need(nodes.size===positions.length&&nodes.size<=4096,'stepEditInvalid');
 if(p.kind==='state_machine')need(new Set(p.transitions.map(t=>t.transition_id)).size===p.transitions.length,'stepEditInvalid');
 const conditions=p.kind==='rule'?[p.condition]:p.transitions.map(t=>t.condition);
 need(!conditions.flatMap(conditionRefs).some(r=>r.source==='step_result'),'stepEditDependency');
 const sources=selectedActionSources(content,state),containers=new Map(stepContainers(content).map(c=>[c.path,c])),parallel=p.kind==='rule'&&p.groups.some(g=>g.mode==='parallel');
 for(const n of positions){
  const s=n.step,c=containers.get(n.path)!;
  if(p.kind==='state_machine'||c.mode==='parallel')need(s.required&&s.failure_policy==='stop','stepEditInvalid');
  if(parallel||s.required)need(s.failure_policy==='stop','stepEditInvalid');
  const dependencies=[...s.depends_on];
  if(s.kind==='action'){
   const refs=[...conditionRefs(s.guard),...s.parameter_bindings.flatMap(b=>b.value.kind==='ref'?[b.value]:[])];
   for(const r of refs){if(r.source!=='step_result')continue;
    const input=sources.find(b=>b.kind==='input'&&b.binding_id===r.binding_id);
    need(input?.kind==='input'&&input.value.source==='step_result'&&input.value.projections.some(v=>v.pointer===r.pointer),'stepEditSource');
    if(input?.kind!=='input')throw new StepEditError('stepEditSource');
    const producer=input.value.producer_step_id;need(producer&&nodes.get(producer)?.step.kind==='action','stepEditDependency');dependencies.push(producer!);
   }
  }
  for(const id of dependencies){const before=nodes.get(id);need(before&&before.branch===n.branch&&before.rank<n.rank,'stepEditDependency');}
 }
}
type Edit={kind:'add';container:string;step:Step}|{kind:'remove';step_id:string}|{kind:'move';step_id:string;direction:-1|1}|{kind:'configure';step_id:string;depends_on:readonly string[];required:boolean;failure_policy:Step['failure_policy']};
export function editSteps(text:string,state:Snapshot,edit:Edit):string{
 need(!state.busy&&!state.draftHistorical&&!state.draftRecovery&&!state.bindingRecovery&&!state.bindingPreparation,'stepEditStale');
 const content=parseSelectionContent(text),containers=stepContainers(content),positions=stepPositions(content),entry=edit.kind==='add'?null:positions.find(s=>s.step.step_id===edit.step_id);
 need(new Set(positions.map(s=>s.step.step_id)).size===positions.length,'stepEditInvalid');
 const container=containers.find(c=>c.path===(edit.kind==='add'?edit.container:entry?.path));need(container,'stepEditStale');
 const steps=[...container!.steps];
 if(edit.kind==='add'){
  validateAutomationModel('Step',edit.step);need(!positions.some(p=>p.step.step_id===edit.step.step_id),'stepEditInvalid');
  const step=edit.step;if(step.kind==='action')need(selectedActionSources(content,state).some(b=>b.kind==='action'&&b.binding_id===step.action_binding_id),'stepEditSource');
  steps.push(structuredClone(step));
 }else{
  need(entry,'stepEditStale');const index=entry!.index;
  if(edit.kind==='remove')steps.splice(index,1);
  else if(edit.kind==='move'){const next=index+edit.direction;need(next>=0&&next<steps.length,'stepEditInvalid');[steps[index],steps[next]]=[steps[next],steps[index]];}
  else steps[index]={...entry!.step,depends_on:[...edit.depends_on],required:edit.required,failure_policy:edit.failure_policy} as Step;
 }
 const replace=(old:readonly Step[],path:string)=>path===container!.path?steps:old,p=content.program;
 const program=p.kind==='rule'?{...p,groups:p.groups.map((g,i)=>({...g,steps:replace(g.steps,'/program/groups/'+i+'/steps')}))}:
  {...p,transitions:p.transitions.map((t,i)=>({...t,...Object.fromEntries((['exit','transition','enter'] as const).map(k=>[k,replace(t[k],'/program/transitions/'+i+'/'+k)]))}))};
 const updated={...content,program};try{validateAutomationModel('LifecycleDraftContent',updated);}catch{throw new StepEditError('stepEditInvalid');}
 checkStepStructure(updated,state);const result=JSON.stringify(updated,null,2);parseSelectionContent(result);return result;
}
export function applyStepPreview(base:string,preview:string,state:Snapshot):string{
 need(!state.busy&&!state.draftHistorical&&!state.draftRecovery&&!state.bindingRecovery&&!state.bindingPreparation,'stepEditStale');
 const previous=stepPositions(parseSelectionContent(base)),content=parseSelectionContent(preview),sources=selectedActionSources(content,state);
 for(const p of stepPositions(content))if(p.step.kind==='action'){
  const step=p.step,old=previous.find(n=>n.step.step_id===step.step_id)?.step;
  if(old?.kind!=='action'||old.action_binding_id!==step.action_binding_id||JSON.stringify([old.parameters,old.parameter_bindings,old.guard])!==JSON.stringify([step.parameters,step.parameter_bindings,step.guard]))need(sources.some(b=>b.kind==='action'&&b.binding_id===step.action_binding_id),'stepEditSource');
 }
 checkStepStructure(content,state);return preview;
}
export function newActionStep(step_id:string,action_binding_id:string,parameters:string):Step{
 const value=parseParameterJson(parameters);need(value&&typeof value==='object'&&!Array.isArray(value),'stepEditInvalid');
 const step={kind:'action',step_id,action_binding_id,parameters:value,parameter_bindings:[],guard:{kind:'literal',value:true},depends_on:[],required:true,failure_policy:'stop'};validateAutomationModel('ActionStep',step);return step;
}
