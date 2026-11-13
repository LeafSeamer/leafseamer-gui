import {useMemo,useState} from 'react';
import type {Copy} from './i18n.ts';
import type {Snapshot} from './session.ts';
import {approvedBindings,bindingUses,editSelection,parseSelectionContent,sameSelection,SelectionEditError} from './binding-selection.ts';
import type {ApprovedBinding,DraftContent} from './binding-selection.ts';
export function BindingSelectionEditor({text,onChange,state,disabled,copy}:{text:string;onChange:(text:string)=>void;state:Snapshot;disabled:boolean;copy:Copy}){
 const [error,setError]=useState<SelectionEditError['code']|null>(null),[replacement,setReplacement]=useState<{text:string;binding:ApprovedBinding;approvalId:string}|null>(null);
 const content=useMemo<DraftContent|null>(()=>{try{return parseSelectionContent(text);}catch{return null;}},[text]);
 const choices=approvedBindings(state),approval=state.bindingApproval,locked=disabled||state.busy||!!state.bindingRecovery||!!state.bindingPreparation;
 const apply=(edit:Parameters<typeof editSelection>[1])=>{if(locked)return;try{onChange(editSelection(text,edit));setError(null);setReplacement(null);}catch(e){setError(e instanceof SelectionEditError?e.code:'selectionInvalid');}};
 const currentReplacement=replacement&&replacement.text===text&&approval?.approval_ref.id===replacement.approvalId&&choices.some(b=>sameSelection(b,replacement.binding))?replacement:null;
 return <section className="binding-selection"><h2>{copy.bindingSelectionTitle}</h2><p className="muted">{copy.bindingSelectionHint}</p>
  {!content&&<p role="status">{copy.selectionInvalid}</p>}{error&&<p role="alert">{copy[error]}</p>}
  {content&&<><h3>{copy.selectedBindings}</h3>{!content.selections.length&&<p className="muted">{copy.noSelectedBindings}</p>}
   <ul className="selection-list">{content.selections.map(selection=>{const uses=bindingUses(content.program,selection.binding_id),matched=choices.some(b=>sameSelection(b,selection));return <li key={selection.binding_id} data-selection-id={selection.binding_id}>
    <div><strong>{selection.kind==='input'?copy.bindingInput:copy.bindingAction}</strong><code>{selection.binding_id}</code><p className="muted">{matched?copy.selectionMatchesApproval:copy.selectionNotChecked}</p>
     <details><summary>{copy.selectionReference}</summary><pre>{JSON.stringify(selection.content_ref,null,2)}</pre></details>
     {!!uses.length&&<details><summary>{copy.selectionInUse} ({uses.length})</summary><ul>{uses.map(p=><li key={p}><code>{p}</code></li>)}</ul></details>}</div>
    <button disabled={locked||!!uses.length} onClick={()=>apply({kind:'remove',binding_id:selection.binding_id})}>{copy.removeSelection}</button>
   </li>;})}</ul>
   <h3>{copy.approvedChoices}</h3>{!choices.length?<p className="muted">{copy.selectionNeedsApproval}</p>:<><p className="muted">{copy.bindingApprovalId}: {approval!.approval_ref.id}</p><ul className="selection-list">{choices.map(binding=>{
    const prior=content!.selections.find(s=>s.binding_id===binding.binding_id),same=prior&&sameSelection(prior,binding),conflict=prior&&prior.kind!==binding.kind;
    return <li key={binding.binding_id} data-choice-id={binding.binding_id}><div><strong>{binding.kind==='action'?copy.bindingAction:copy.bindingInput}</strong><code>{binding.binding_id}</code>
     {binding.kind==='input'&&<p>{copy.inputSource}: {copy[({event:'inputSourceEvent',observation:'inputSourceObservation',machine:'inputSourceMachine',step_result:'inputSourceResult'} as const)[binding.value.source]]}</p>}
     <details><summary>{copy.selectionReference}</summary><pre>{JSON.stringify(binding.content_ref,null,2)}</pre></details></div>
     <button className="primary" disabled={locked||!!same||!!conflict} onClick={()=>prior?setReplacement({text,binding,approvalId:approval!.approval_ref.id}):apply({kind:'add',binding})}>{same?copy.selectionAlreadyAdded:prior?copy.prepareSelectionReplacement:copy.addSelection}</button></li>;
   })}</ul></>}
   {currentReplacement&&<aside className="notice"><h3>{copy.confirmSelectionReplacement}</h3><p>{copy.selectionReplaceHint}</p><dl><dt>{copy.selectionOldReference}</dt><dd><code>{content.selections.find(s=>s.binding_id===currentReplacement.binding.binding_id)?.content_ref.digest}</code></dd><dt>{copy.selectionNewReference}</dt><dd><code>{currentReplacement.binding.content_ref.digest}</code></dd></dl>
    <button className="primary" disabled={locked} onClick={()=>apply({kind:'replace',binding:currentReplacement.binding})}>{copy.confirmSelectionReplacement}</button><button disabled={locked} onClick={()=>setReplacement(null)}>{copy.cancelPreparation}</button></aside>}
  </>}
 </section>;
}
