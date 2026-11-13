import {validateAutomationModel} from '@leafseamer/sdk/automation-program';
import type {AutomationModels} from '@leafseamer/sdk/automation-program';
import {approvedBindings,parseSelectionContent,sameSelection} from './binding-selection.ts';
import type {DraftContent} from './binding-selection.ts';
import type {Snapshot} from './session.ts';
export type ActionStep=AutomationModels['ActionStep'];
export type ParameterBinding=AutomationModels['ParameterBinding'];
export type TypeSpec=AutomationModels['TypeSpec'];
export class ActionEditError extends Error{code:'actionEditInvalid'|'actionEditSource'|'actionEditType'|'actionEditOverlap'|'actionEditStale';constructor(code:ActionEditError['code']){super(code);this.code=code;}}
const need=(ok:unknown,code:ActionEditError['code'])=>{if(!ok)throw new ActionEditError(code);};
export function actionSteps(content:DraftContent):{path:string;step:ActionStep}[]{
 const result:{path:string;step:ActionStep}[]=[],add=(steps:readonly AutomationModels['Step'][],path:string)=>steps.forEach((step,i)=>{if(step.kind==='action')result.push({path:path+'/'+i,step});});
 if(content.program.kind==='rule')content.program.groups.forEach((g,i)=>add(g.steps,'/program/groups/'+i+'/steps'));
 else content.program.transitions.forEach((t,i)=>{for(const key of ['exit','transition','enter'] as const)add(t[key],'/program/transitions/'+i+'/'+key);});return result;
}
export function selectedActionSources(content:DraftContent,state:Snapshot){return approvedBindings(state).filter(b=>content.selections.some(s=>sameSelection(s,b)));}
export const sameType=(a:TypeSpec,b:TypeSpec)=>a.kind===b.kind&&a.unit===b.unit;
export function literalMatches(value:unknown,type:TypeSpec):boolean{
 if(type.kind==='json')return true;if(type.kind==='null')return value===null;if(type.kind==='binary64')return typeof value==='number'&&Number.isFinite(value);
 if(type.kind==='integer_string')return typeof value==='string'&&/^(0|-?[1-9][0-9]{0,19})$(?![\s\S])/.test(value);return typeof value===type.kind;
}
function pointer(value:string){need(value.length<=1024&&/^(?:\/(?:[^~/]|~[01])*)*$(?![\s\S])/.test(value)&&!/[\uD800-\uDFFF]/u.test(value),'actionEditInvalid');
 const parts=value===''?[]:value.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));need(parts.every(p=>!['__proto__','prototype','constructor','-'].includes(p)&&!p.includes('${')),'actionEditInvalid');return parts;
}
export function parseParameterJson(text:string):unknown{
 try{need(new TextEncoder().encode(text).length<=4194304,'actionEditInvalid');const value:unknown=JSON.parse(text),pending=[{value,depth:0}];let count=0;
  while(pending.length){const item=pending.pop()!;need(++count<=131072&&item.depth<=64,'actionEditInvalid');if(typeof item.value==='number')need(Number.isFinite(item.value),'actionEditInvalid');if(item.value&&typeof item.value==='object')for(const v of Object.values(item.value))pending.push({value:v,depth:item.depth+1});}
  return value;
 }catch{throw new ActionEditError('actionEditInvalid');}
}
export function checkParameterBindings(action:Extract<ReturnType<typeof selectedActionSources>[number],{kind:'action'}>,sources:ReturnType<typeof selectedActionSources>,bindings:readonly ParameterBinding[]){
 const targets:string[][]=[];
 for(const binding of bindings){validateAutomationModel('ParameterBinding',binding);const parts=pointer(binding.target_pointer),slot=action.value.parameter_slots.find(s=>s.pointer===binding.target_pointer);need(slot,'actionEditSource');
  need(!targets.some(p=>p.every((v,i)=>parts[i]===v)||parts.every((v,i)=>p[i]===v)),'actionEditOverlap');targets.push(parts);
  const value=binding.value;if(value.kind==='literal'){need(literalMatches(value.value,slot!.value_type),'actionEditType');continue;}
  const source=sources.find(b=>b.kind==='input'&&b.binding_id===value.binding_id);need(source?.kind==='input'&&source.value.source===value.source,'actionEditSource');
  if(source?.kind!=='input')throw new ActionEditError('actionEditSource');pointer(value.pointer);const projection=source.value.projections.find(p=>p.pointer===value.pointer);need(projection,'actionEditSource');need(sameType(slot!.value_type,projection!.value_type),'actionEditType');
 }
}
export function applyActionEdit(text:string,state:Snapshot,path:string,edit:{action_binding_id:string;parameters:string;parameter_bindings:readonly ParameterBinding[]}):string{
 need(!state.busy&&!state.draftHistorical&&!state.draftRecovery&&!state.bindingRecovery&&!state.bindingPreparation,'actionEditStale');
 const content=parseSelectionContent(text),entry=actionSteps(content).find(s=>s.path===path);need(entry,'actionEditStale');const sources=selectedActionSources(content,state),action=sources.find(b=>b.kind==='action'&&b.binding_id===edit.action_binding_id);need(action?.kind==='action','actionEditSource');if(action?.kind!=='action')throw new ActionEditError('actionEditSource');
 const parameters=parseParameterJson(edit.parameters);need(parameters&&typeof parameters==='object'&&!Array.isArray(parameters),'actionEditInvalid');checkParameterBindings(action,sources,edit.parameter_bindings);
 const step={...entry!.step,action_binding_id:edit.action_binding_id,parameters,parameter_bindings:edit.parameter_bindings};validateAutomationModel('ActionStep',step);
 const replace=(steps:readonly AutomationModels['Step'][],prefix:string)=>steps.map((s,i)=>prefix+'/'+i===path?step:s);
 const p=content.program,program=p.kind==='rule'?{...p,groups:p.groups.map((g,i)=>({...g,steps:replace(g.steps,'/program/groups/'+i+'/steps')}))}:
  {...p,transitions:p.transitions.map((t,i)=>({...t,...Object.fromEntries((['exit','transition','enter'] as const).map(k=>[k,replace(t[k],'/program/transitions/'+i+'/'+k)]))}))};
 const result=JSON.stringify({...content,program},null,2);parseSelectionContent(result);return result;
}
