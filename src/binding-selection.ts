import {validateAutomationModel} from '@leafseamer/sdk/automation-program';
import type {AutomationModels} from '@leafseamer/sdk/automation-program';
import type {Snapshot} from './session.ts';
export type DraftContent=AutomationModels['LifecycleDraftContent'];
export type BindingSelection=DraftContent['selections'][number];
export type ApprovedBinding=NonNullable<Snapshot['bindingApproval']>['bundle']['bindings'][number];
export class SelectionEditError extends Error{code:'selectionInvalid'|'selectionConflict'|'selectionReferenced';constructor(code:SelectionEditError['code']){super(code);this.code=code;}}
export function parseSelectionContent(text:string):DraftContent{
 try{if(new TextEncoder().encode(text).length>4194304)throw new Error('size');const v:unknown=JSON.parse(text);validateAutomationModel('LifecycleDraftContent',v);
  if(new Set(v.selections.map(s=>s.binding_id)).size!==v.selections.length)throw new Error('duplicate');return v;
 }catch{throw new SelectionEditError('selectionInvalid');}
}
export const sameSelection=(a:BindingSelection,b:BindingSelection)=>a.kind===b.kind&&a.binding_id===b.binding_id&&a.content_ref.id===b.content_ref.id&&a.content_ref.revision===b.content_ref.revision&&a.content_ref.digest===b.content_ref.digest;
export function approvedBindings(state:Snapshot):readonly ApprovedBinding[]{
 const d=state.draft,a=state.bindingApproval;if(!d||state.draftHistorical||state.bindingHistorical||state.bindingRecovery||state.bindingPreparation||!a||a.state!=='approved'||a.purpose!=='definition_compile'||a.definition_id!==d.definition_id||a.scope.authority_service_id!==d.scope.authority_service_id||a.scope.database_instance_id!==d.scope.database_instance_id)return [];
 if(new Set(a.bundle.bindings.map(b=>b.binding_id)).size!==a.bundle.bindings.length)return [];return a.bundle.bindings;
}
// 只遍历具名DSL节点；动作参数和literal中的普通JSON不是程序引用。
export function bindingUses(program:DraftContent['program'],bindingId:string):string[]{
 const paths:string[]=[],ref=(v:AutomationModels['Value'],path:string)=>{if(v.kind==='ref'&&v.binding_id===bindingId)paths.push(path);};
 function condition(c:AutomationModels['Condition'],path:string){
  if(c.kind==='compare'){ref(c.left,path+'/left');ref(c.right,path+'/right');}
  else if(c.kind==='all'||c.kind==='any')c.items.forEach((v,i)=>condition(v,path+'/items/'+i));
  else if(c.kind==='not')condition(c.item,path+'/item');
  else if(c.kind==='exists'||c.kind==='is_null')ref(c.value,path+'/value');
 }
 function steps(values:readonly AutomationModels['Step'][],path:string){values.forEach((s,i)=>{if(s.kind!=='action')return;const p=path+'/'+i;if(s.action_binding_id===bindingId)paths.push(p+'/action_binding_id');condition(s.guard,p+'/guard');s.parameter_bindings.forEach((b,j)=>ref(b.value,p+'/parameter_bindings/'+j+'/value'));});}
 if(program.kind==='rule'){if(program.trigger_binding_id===bindingId)paths.push('/program/trigger_binding_id');condition(program.condition,'/program/condition');program.groups.forEach((g,i)=>steps(g.steps,'/program/groups/'+i+'/steps'));}
 else program.transitions.forEach((t,i)=>{const p='/program/transitions/'+i;if(t.trigger_binding_id===bindingId)paths.push(p+'/trigger_binding_id');condition(t.condition,p+'/condition');for(const field of ['exit','transition','enter'] as const)steps(t[field],p+'/'+field);});
 return paths;
}
export function editSelection(text:string,edit:{kind:'add'|'replace';binding:ApprovedBinding}|{kind:'remove';binding_id:string}):string{
 const content=parseSelectionContent(text),selections=[...content.selections],id=edit.kind==='remove'?edit.binding_id:edit.binding.binding_id,index=selections.findIndex(s=>s.binding_id===id);
 if(edit.kind==='remove'){if(index<0)throw new SelectionEditError('selectionConflict');if(bindingUses(content.program,id).length)throw new SelectionEditError('selectionReferenced');selections.splice(index,1);}
 else{const {kind,binding_id,content_ref}=edit.binding,value={kind,binding_id,content_ref:structuredClone(content_ref)};
  validateAutomationModel('LifecycleBindingSelection',value);
  if(edit.kind==='add'){if(index!==-1)throw new SelectionEditError('selectionConflict');selections.push(value);}
  else{if(index<0||selections[index].kind!==kind)throw new SelectionEditError('selectionConflict');selections[index]=value;}
 }
 const result=JSON.stringify({...content,selections},null,2);parseSelectionContent(result);return result;
}
