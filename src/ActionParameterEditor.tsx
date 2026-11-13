import {useMemo,useState} from 'react';
import type {Copy} from './i18n.ts';
import type {Snapshot} from './session.ts';
import {parseSelectionContent} from './binding-selection.ts';
import {actionSteps,selectedActionSources,sameType,parseParameterJson,applyActionEdit,checkParameterBindings,ActionEditError} from './action-editor.ts';
import type {ActionStep,ParameterBinding} from './action-editor.ts';
type Props={text:string;state:Snapshot;disabled:boolean;copy:Copy;onChange:(text:string)=>void};
function ParameterForm({text,state,disabled,copy,onChange,path,step}:{path:string;step:ActionStep}&Props){
 const [base,setBase]=useState(text),[actionId,setActionId]=useState(step.action_binding_id),[parameters,setParameters]=useState(JSON.stringify(step.parameters,null,2)),[bindings,setBindings]=useState<readonly ParameterBinding[]>(step.parameter_bindings);
 const [slot,setSlot]=useState(''),[input,setInput]=useState(''),[mode,setMode]=useState('reference'),[literal,setLiteral]=useState(''),[error,setError]=useState<ActionEditError['code']|null>(null);
 const content=useMemo(()=>{try{return parseSelectionContent(text);}catch{return null;}},[text]),sources=content?selectedActionSources(content,state):[],actions=sources.filter(b=>b.kind==='action'),action=actions.find(a=>a.binding_id===actionId);
 const locked=disabled||state.busy||!!state.bindingRecovery||!!state.bindingPreparation,stale=text!==base;
 const projections=sources.flatMap(b=>b.kind==='input'?b.value.projections.map(p=>({id:JSON.stringify([b.binding_id,p.pointer]),binding:b.value,projection:p})):[]),target=action?.value.parameter_slots.find(s=>s.pointer===slot);
 const schema=state.bindingApproval?.bundle.schemas.find(s=>s.binding_id===action?.binding_id&&s.schema_ref.digest===action.value.parameter_schema_ref.digest);
 const attempt=(run:()=>void)=>{if(locked||stale)return;try{run();setError(null);}catch(e){setError(e instanceof ActionEditError?e.code:'actionEditInvalid');}};
 function reload(){setBase(text);setActionId(step.action_binding_id);setParameters(JSON.stringify(step.parameters,null,2));setBindings(step.parameter_bindings);setSlot('');setInput('');setError(null);}
 return <div className="parameter-form"><p><code>{path}</code></p><p className="muted">{copy.actionParameterHint}</p>
  {stale&&<aside className="notice">{copy.actionEditStale}</aside>}{error&&<p role="alert">{copy[error]}</p>}
  <label htmlFor="step-action-binding">{copy.stepActionBinding}</label><select id="step-action-binding" value={actionId} disabled={locked||stale} onChange={e=>{setActionId(e.target.value);setSlot('');setInput('');}}>
   {!actions.some(a=>a.binding_id===actionId)&&<option value={actionId}>{copy.actionUnverified}: {actionId}</option>}{actions.map(a=><option key={a.binding_id} value={a.binding_id}>{a.value.capability_id} — {a.binding_id}</option>)}
  </select>{!action&&<p className="muted">{copy.actionEditSource}</p>}
  {schema&&<details><summary>{copy.parameterSchema}</summary><pre>{JSON.stringify(schema.document,null,2)}</pre></details>}
  <label htmlFor="step-parameters">{copy.stepParameters}</label><textarea id="step-parameters" rows={6} spellCheck={false} value={parameters} disabled={locked||stale} onChange={e=>setParameters(e.target.value)}/>
  <h3>{copy.stepParameterBindings}</h3><ul className="parameter-bindings">{bindings.map((b,i)=><li key={i}><code>{b.target_pointer}</code><pre>{JSON.stringify(b.value,null,2)}</pre><button disabled={locked||stale} onClick={()=>setBindings(bindings.filter((_,j)=>i!==j))}>{copy.removeParameterBinding}</button></li>)}</ul>
  <label htmlFor="parameter-target">{copy.parameterTarget}</label><select id="parameter-target" value={slot} disabled={locked||stale||!action} onChange={e=>{setSlot(e.target.value);setInput('');}}><option value="">{copy.chooseParameterTarget}</option>{action?.value.parameter_slots.map(s=><option key={s.pointer} value={s.pointer}>{s.pointer} · {s.value_type.kind}{s.value_type.unit?' · '+s.value_type.unit:''}</option>)}</select>
  <label htmlFor="parameter-value-mode">{copy.parameterValueMode}</label><select id="parameter-value-mode" value={mode} disabled={locked||stale} onChange={e=>setMode(e.target.value)}><option value="reference">{copy.parameterProjection}</option><option value="literal">{copy.parameterLiteral}</option></select>
  {mode==='reference'?<><label htmlFor="parameter-projection">{copy.parameterProjection}</label><select id="parameter-projection" value={input} disabled={locked||stale||!target} onChange={e=>setInput(e.target.value)}><option value="">{copy.chooseParameterProjection}</option>{projections.map(p=><option key={p.id} value={p.id} disabled={!target||!sameType(target.value_type,p.projection.value_type)}>{p.binding.binding_id} {p.projection.pointer} · {p.projection.value_type.kind}{p.projection.value_type.unit?' · '+p.projection.value_type.unit:''}</option>)}</select></>:
   <><label htmlFor="parameter-literal">{copy.parameterLiteral}</label><textarea id="parameter-literal" rows={2} spellCheck={false} disabled={locked||stale} value={literal} onChange={e=>setLiteral(e.target.value)}/></>}
  <button disabled={locked||stale||!target||mode==='reference'&&!input} onClick={()=>attempt(()=>{if(!action)throw new ActionEditError('actionEditSource');const selected=projections.find(p=>p.id===input);
   const value=mode==='literal'?{kind:'literal' as const,value:parseParameterJson(literal)}:selected?{kind:'ref' as const,binding_id:selected.binding.binding_id,source:selected.binding.source,pointer:selected.projection.pointer}:null;if(!value)throw new ActionEditError('actionEditSource');const next=[...bindings,{target_pointer:slot,value}];checkParameterBindings(action,sources,next);setBindings(next);
  })}>{copy.addParameterBinding}</button>
  <div className="actions"><button className="primary" disabled={locked||stale||!action} onClick={()=>attempt(()=>{const next=applyActionEdit(text,state,path,{action_binding_id:actionId,parameters,parameter_bindings:bindings});setBase(next);onChange(next);})}>{copy.applyActionParameters}</button><button disabled={locked} onClick={reload}>{copy.reloadActionParameters}</button></div>
 </div>;
}
export function ActionParameterEditor(props:Props){
 const {text,copy,state,disabled}=props,[selected,setSelected]=useState('');const content=useMemo(()=>{try{return parseSelectionContent(text);}catch{return null;}},[text]),steps=content?actionSteps(content):[],entry=steps.find(s=>s.path===selected);
 return <section className="action-parameter-editor"><h2>{copy.actionParametersTitle}</h2><p className="muted">{copy.actionStepsHint}</p>
  <label htmlFor="action-step">{copy.chooseActionStep}</label><select id="action-step" value={selected} disabled={disabled||state.busy} onChange={e=>setSelected(e.target.value)}><option value="">{copy.chooseActionStep}</option>{steps.map(s=><option key={s.path} value={s.path}>{s.step.step_id} · {s.path}</option>)}</select>
  {!steps.length&&<p className="muted">{copy.noActionSteps}</p>}{entry&&<ParameterForm key={selected} {...props} path={entry.path} step={entry.step}/>}
 </section>;
}
