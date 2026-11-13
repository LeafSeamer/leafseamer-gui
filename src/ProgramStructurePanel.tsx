import {useState} from 'react';
import type {Copy} from './i18n.ts';
import type {Snapshot} from './session.ts';
import type {DraftContent} from './binding-selection.ts';
import {selectedEventSources} from './program-editor.ts';
import type {ProgramEdit} from './program-editor.ts';

type Props={content:DraftContent;state:Snapshot;copy:Copy;locked:boolean;onEdit:(edit:ProgramEdit)=>void};
function TransitionForm({content,state,copy,locked,onEdit,id}:{id:string}&Props){
 const p=content.program;if(p.kind!=='state_machine')return null;
 const current=p.transitions.find(t=>t.transition_id===id);
 return <TransitionFields key={id} {...{content,state,copy,locked,onEdit}} current={current}/>;
}
function TransitionFields({content,state,copy,locked,onEdit,current}:Props&{current?:Extract<DraftContent['program'],{kind:'state_machine'}>['transitions'][number]}){
 const [id,setId]=useState(''),[from,setFrom]=useState(current?.from_state??''),[to,setTo]=useState(current?.to_state??''),[priority,setPriority]=useState(String(current?.priority??0)),[trigger,setTrigger]=useState(current?.trigger_binding_id??'');
 const p=content.program;if(p.kind!=='state_machine')return null;const events=selectedEventSources(content,state);
 return <fieldset disabled={locked} className="transition-form"><legend>{current?copy.editTransition+': '+current.transition_id:copy.addTransition}</legend>
  {!current&&<><label htmlFor="new-transition-id">{copy.transitionId}</label><input id="new-transition-id" value={id} maxLength={128} onChange={e=>setId(e.target.value)}/></>}
  <label htmlFor="transition-from">{copy.transitionFrom}</label><select id="transition-from" value={from} onChange={e=>setFrom(e.target.value)}><option value="">{copy.chooseState}</option>{p.states.map(s=><option key={s} value={s}>{s}</option>)}</select>
  <label htmlFor="transition-to">{copy.transitionTo}</label><select id="transition-to" value={to} onChange={e=>setTo(e.target.value)}><option value="">{copy.chooseState}</option>{p.states.map(s=><option key={s} value={s}>{s}</option>)}</select>
  <label htmlFor="transition-priority">{copy.transitionPriority}</label><input id="transition-priority" type="number" min={-2147483648} max={2147483647} step={1} value={priority} onChange={e=>setPriority(e.target.value)}/>
  <label htmlFor="transition-trigger">{copy.transitionTrigger}</label><select id="transition-trigger" value={trigger} onChange={e=>setTrigger(e.target.value)}><option value="">{copy.chooseEvent}</option>{current&&!events.some(e=>e.binding_id===current.trigger_binding_id)&&<option value={current.trigger_binding_id}>{copy.actionUnverified}: {current.trigger_binding_id}</option>}{events.map(e=><option key={e.binding_id} value={e.binding_id}>{e.binding_id}</option>)}</select>
  {!events.length&&<p className="muted">{copy.noEventSources}</p>}<p className="muted">{current?copy.transitionPreserve:copy.transitionDefaults}</p>
  <button disabled={locked||!from||!to||priority===''||!trigger||!current&&!id} onClick={()=>onEdit(current?{kind:'transition-configure',id:current.transition_id,from_state:from,to_state:to,priority:Number(priority),trigger_binding_id:trigger}:{kind:'transition-add',transition:{transition_id:id,from_state:from,to_state:to,priority:Number(priority),trigger_binding_id:trigger,condition:{kind:'literal',value:true},exit:[],transition:[],enter:[]}})}>{current?copy.updateTransition:copy.addTransitionPreview}</button>
 </fieldset>;
}
export function ProgramStructurePanel(props:Props){
 const {content,copy,locked,onEdit}=props,p=content.program,[stateName,setStateName]=useState(''),[transition,setTransition]=useState('');
 if(p.kind==='rule')return <details className="program-structure"><summary>{copy.ruleGroups}</summary><p className="muted">{copy.groupManagementHint}</p><ol className="group-list">{p.groups.map((g,i)=><li key={i} data-group-index={i}><strong>{copy.ruleGroup} {i+1} · {g.steps.length} {copy.stepCount}</strong><select aria-label={copy.groupMode+' '+(i+1)} value={g.mode} disabled={locked} onChange={e=>onEdit({kind:'group-mode',index:i,mode:e.target.value as 'sequence'|'parallel'})}><option value="sequence">{copy.stepsSequence}</option><option value="parallel">{copy.stepsParallel}</option></select><div className="actions"><button disabled={locked||i===0} onClick={()=>onEdit({kind:'group-move',index:i,direction:-1})}>{copy.moveGroupUp}</button><button disabled={locked||i===p.groups.length-1} onClick={()=>onEdit({kind:'group-move',index:i,direction:1})}>{copy.moveGroupDown}</button><button disabled={locked||p.groups.length===1} onClick={()=>onEdit({kind:'group-remove',index:i})}>{copy.removeGroup}</button></div></li>)}</ol></details>;
 return <details className="program-structure"><summary>{copy.statesAndTransitions}</summary><p className="muted">{copy.stateManagementHint}</p>
  <label htmlFor="initial-state">{copy.initialState}</label><select id="initial-state" disabled={locked} value={p.initial_state} onChange={e=>onEdit({kind:'state-initial',name:e.target.value})}>{p.states.map(s=><option key={s} value={s}>{s}</option>)}</select>
  <ul className="state-list">{p.states.map(s=><li key={s}><span>{s}</span><button disabled={locked||s===p.initial_state||p.transitions.some(t=>t.from_state===s||t.to_state===s)} onClick={()=>onEdit({kind:'state-remove',name:s})}>{copy.removeState}</button></li>)}</ul>
  <label htmlFor="new-state-name">{copy.newStateName}</label><input id="new-state-name" disabled={locked} value={stateName} maxLength={128} onChange={e=>setStateName(e.target.value)}/><button disabled={locked||!stateName} onClick={()=>onEdit({kind:'state-add',name:stateName})}>{copy.addState}</button>
  <ul className="transition-list">{p.transitions.map(t=><li key={t.transition_id}><span>{t.transition_id}: {t.from_state} → {t.to_state}</span><button disabled={locked||p.transitions.length===1} onClick={()=>{onEdit({kind:'transition-remove',id:t.transition_id});setTransition('');}}>{copy.removeTransition}</button></li>)}</ul>
  <label htmlFor="edit-transition">{copy.editTransition}</label><select id="edit-transition" disabled={locked} value={transition} onChange={e=>setTransition(e.target.value)}><option value="">{copy.addTransition}</option>{p.transitions.map(t=><option key={t.transition_id} value={t.transition_id}>{t.transition_id}</option>)}</select>
  <TransitionForm key={transition} {...props} id={transition}/>
 </details>;
}
