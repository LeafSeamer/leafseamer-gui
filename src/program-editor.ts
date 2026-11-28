import {validateAutomationModel} from '@leafseamer/sdk/automation-program';
import type {AutomationModels} from '@leafseamer/sdk/automation-program';
import type {Snapshot} from './session.ts';
import {parseSelectionContent} from './binding-selection.ts';
import type {DraftContent} from './binding-selection.ts';
import {selectedActionSources} from './action-editor.ts';
import {checkStepStructure,stepContainers,stepPositions,applyStepPreview,StepEditError} from './step-editor.ts';
import type {Step} from './step-editor.ts';
import {checkChangedConditions} from './condition-editor.ts';
import type {Condition,ConditionTarget} from './condition-editor.ts';

type Mode='sequence'|'parallel';
export type ProgramEdit=
 |(ConditionTarget&{condition:Condition})
 |{kind:'rule-trigger';trigger_binding_id:string}
 |{kind:'group-add';mode:Mode;step:Step}
 |{kind:'group-remove';index:number}
 |{kind:'group-move';index:number;direction:-1|1}
 |{kind:'group-mode';index:number;mode:Mode}
 |{kind:'state-add';name:string}
 |{kind:'state-remove';name:string}
 |{kind:'state-initial';name:string}
 |{kind:'transition-add';transition:AutomationModels['Transition']}
 |{kind:'transition-remove';id:string}
 |{kind:'transition-configure';id:string;from_state:string;to_state:string;priority:number;trigger_binding_id:string}
 |{kind:'relocate';step_id:string;container:string;index:number}
 |{kind:'delay';step_id:string;delay_ms:number;max_lateness_ms:number};
const need=(ok:unknown,code:StepEditError['code']='stepEditInvalid')=>{if(!ok)throw new StepEditError(code);};
export function selectedEventSources(content:DraftContent,state:Snapshot){return selectedActionSources(content,state).filter(b=>b.kind==='input'&&b.value.source==='event');}
export function checkProgramStates(content:DraftContent){
 const p=content.program;if(p.kind!=='state_machine')return;
 need(p.states.includes(p.initial_state)&&p.transitions.every(t=>p.states.includes(t.from_state)&&p.states.includes(t.to_state)));
}
export function checkNewTriggers(before:DraftContent,after:DraftContent,state:Snapshot){
 const previous=before.program.kind==='rule'?[{id:'rule',trigger:before.program.trigger_binding_id}]:before.program.transitions.map(t=>({id:t.transition_id,trigger:t.trigger_binding_id}));
 const next=after.program.kind==='rule'?[{id:'rule',trigger:after.program.trigger_binding_id}]:after.program.transitions.map(t=>({id:t.transition_id,trigger:t.trigger_binding_id}));
 const events=selectedEventSources(after,state);
 for(const t of next)if(!previous.some(p=>p.id===t.id&&p.trigger===t.trigger))need(events.some(e=>e.binding_id===t.trigger),'stepEditSource');
}
export function applyProgramPreview(base:string,preview:string,state:Snapshot):string{
 const result=applyStepPreview(base,preview,state),before=parseSelectionContent(base),after=parseSelectionContent(result);
 checkProgramStates(after);checkNewTriggers(before,after,state);checkChangedConditions(before,after,state);return result;
}
export function editProgram(text:string,state:Snapshot,edit:ProgramEdit):string{
 need(!state.busy&&!state.draftHistorical&&!state.draftRecovery&&!state.bindingRecovery&&!state.bindingPreparation,'stepEditStale');
 const content=parseSelectionContent(text),p=content.program;let program:DraftContent['program']=p;
 if(edit.kind==='rule-trigger'){
  if(p.kind!=='rule')throw new StepEditError('stepEditInvalid');
  program={...p,trigger_binding_id:edit.trigger_binding_id};
 }else if(edit.kind==='rule-condition'){
  if(p.kind!=='rule')throw new StepEditError('stepEditInvalid');
  program={...p,condition:edit.condition};
 }else if(edit.kind==='group-add'||edit.kind==='group-remove'||edit.kind==='group-move'||edit.kind==='group-mode'){
  need(p.kind==='rule');if(p.kind!=='rule')throw new StepEditError('stepEditInvalid');const groups=[...p.groups];
  if(edit.kind==='group-add'){
   const step=edit.step;if(step.kind==='action')need(selectedActionSources(content,state).some(b=>b.kind==='action'&&b.binding_id===step.action_binding_id),'stepEditSource');
   groups.push({mode:edit.mode,steps:[structuredClone(step)]});
  }else{
   need(Number.isInteger(edit.index)&&edit.index>=0&&edit.index<groups.length);
   if(edit.kind==='group-remove')groups.splice(edit.index,1);
   else if(edit.kind==='group-mode')groups[edit.index]={...groups[edit.index],mode:edit.mode};
   else{const to=edit.index+edit.direction;need(to>=0&&to<groups.length);[groups[edit.index],groups[to]]=[groups[to],groups[edit.index]];}
  }
  program={...p,groups};
 }else if(edit.kind==='relocate'||edit.kind==='delay'||edit.kind==='step-guard'){
  const positions=stepPositions(content),entry=positions.find(n=>n.step.step_id===edit.step_id);need(entry,'stepEditStale');need(new Set(positions.map(n=>n.step.step_id)).size===positions.length);
  const changes=new Map<string,readonly Step[]>(),containers=stepContainers(content),from=containers.find(c=>c.path===entry!.path)!;
  const steps=[...from.steps];
  if(edit.kind==='delay'){need(entry!.step.kind==='delay');steps[entry!.index]={...entry!.step,delay_ms:edit.delay_ms,max_lateness_ms:edit.max_lateness_ms} as Step;changes.set(from.path,steps);}
  else if(edit.kind==='step-guard'){
   if(entry!.step.kind!=='action')throw new StepEditError('stepEditInvalid');
   steps[entry!.index]={...entry!.step,guard:edit.condition};changes.set(from.path,steps);
  }
  else{
   const to=containers.find(c=>c.path===edit.container);need(to,'stepEditStale');steps.splice(entry!.index,1);const target=from.path===to!.path?steps:[...to!.steps];
   need(Number.isInteger(edit.index)&&edit.index>=0&&edit.index<=target.length);target.splice(edit.index,0,entry!.step);changes.set(from.path,steps);changes.set(to!.path,target);
  }
  const replace=(steps:readonly Step[],path:string)=>changes.get(path)??steps;
  program=p.kind==='rule'?{...p,groups:p.groups.map((g,i)=>({...g,steps:replace(g.steps,'/program/groups/'+i+'/steps')}))}:
   {...p,transitions:p.transitions.map((t,i)=>({...t,...Object.fromEntries((['exit','transition','enter'] as const).map(k=>[k,replace(t[k],'/program/transitions/'+i+'/'+k)]))}))};
 }else{
  need(p.kind==='state_machine');if(p.kind!=='state_machine')throw new StepEditError('stepEditInvalid');
  if(edit.kind==='state-add'){need(!p.states.includes(edit.name));program={...p,states:[...p.states,edit.name]};}
  else if(edit.kind==='state-remove'){need(p.states.includes(edit.name)&&p.initial_state!==edit.name&&!p.transitions.some(t=>t.from_state===edit.name||t.to_state===edit.name));program={...p,states:p.states.filter(s=>s!==edit.name)};}
  else if(edit.kind==='state-initial'){need(p.states.includes(edit.name));program={...p,initial_state:edit.name};}
  else if(edit.kind==='transition-add'){
   need(selectedEventSources(content,state).some(b=>b.binding_id===edit.transition.trigger_binding_id),'stepEditSource');
   // 新转换由表单显式提供端点、优先级和事件，步骤通过同一预览另行加入。
   need(edit.transition.exit.length===0&&edit.transition.transition.length===0&&edit.transition.enter.length===0);program={...p,transitions:[...p.transitions,structuredClone(edit.transition)]};
  }else{
   const index=p.transitions.findIndex(t=>t.transition_id===edit.id);need(index>=0,'stepEditStale');
   if(edit.kind==='transition-remove')program={...p,transitions:p.transitions.filter((_,i)=>i!==index)};
   else program={...p,transitions:p.transitions.map((t,i)=>{
    if(i!==index)return t;
    if(edit.kind==='transition-condition')return {...t,condition:edit.condition};
    return {...t,from_state:edit.from_state,to_state:edit.to_state,priority:edit.priority,trigger_binding_id:edit.trigger_binding_id};
   })};
  }
 }
 const updated={...content,program};try{validateAutomationModel('LifecycleDraftContent',updated);}catch{throw new StepEditError('stepEditInvalid');}
 checkProgramStates(updated);checkNewTriggers(content,updated,state);checkStepStructure(updated,state);checkChangedConditions(content,updated,state);const result=JSON.stringify(updated,null,2);parseSelectionContent(result);return result;
}
