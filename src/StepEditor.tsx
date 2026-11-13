import {useMemo,useState} from 'react';
import type {Copy} from './i18n.ts';
import type {Snapshot} from './session.ts';
import {parseSelectionContent} from './binding-selection.ts';
import {selectedActionSources} from './action-editor.ts';
import {stepContainers,stepPositions,editSteps,newActionStep,StepEditError} from './step-editor.ts';
import type {Step} from './step-editor.ts';
import {editProgram,applyProgramPreview} from './program-editor.ts';
import {ProgramStructurePanel} from './ProgramStructurePanel.tsx';

function DelayFields({step,copy,locked,onChange}:{step:Extract<Step,{kind:'delay'}>;copy:Copy;locked:boolean;onChange:(delay:number,lateness:number)=>void}){
 const [delay,setDelay]=useState(String(step.delay_ms)),[lateness,setLateness]=useState(String(step.max_lateness_ms));
 return <div className="delay-fields"><label htmlFor="edit-step-delay">{copy.stepDelay}</label><input id="edit-step-delay" type="number" min={0} max={86400000} step={1} value={delay} onChange={e=>setDelay(e.target.value)}/><label htmlFor="edit-step-lateness">{copy.stepLateness}</label><input id="edit-step-lateness" type="number" min={1} max={60000} step={1} value={lateness} onChange={e=>setLateness(e.target.value)}/><button disabled={locked||delay===''||lateness===''} onClick={()=>onChange(Number(delay),Number(lateness))}>{copy.updateDelay}</button></div>;
}

export function StepEditor({text,state,disabled,copy,onChange}:{text:string;state:Snapshot;disabled:boolean;copy:Copy;onChange:(text:string)=>void}){
 const [base,setBase]=useState(text),[working,setWorking]=useState(text),[container,setContainer]=useState(''),[selected,setSelected]=useState('');
 const [id,setId]=useState(''),[kind,setKind]=useState('delay'),[delay,setDelay]=useState(''),[lateness,setLateness]=useState(''),[action,setAction]=useState(''),[parameters,setParameters]=useState('');
 const [error,setError]=useState<StepEditError['code']|null>(null);
 const [newMode,setNewMode]=useState<'sequence'|'parallel'>('sequence'),[destination,setDestination]=useState(''),[position,setPosition]=useState('1'),[generation,setGeneration]=useState(0);
 const content=useMemo(()=>{try{return parseSelectionContent(working);}catch{return null;}},[working]);
 const containers=content?stepContainers(content):[],positions=content?stepPositions(content):[],entry=positions.find(p=>p.step.step_id===selected),group=containers.find(c=>c.path===container);
 const labels=new Map(containers.map((c,i)=>[c.path,content?.program.kind==='rule'?copy.ruleGroup+' '+(i+1):content?.program.transitions[Math.floor(i/3)].transition_id+' · '+[copy.phaseExit,copy.phaseTransition,copy.phaseEnter][i%3]]));
 const actions=content?selectedActionSources(content,state).filter(b=>b.kind==='action'):[],stale=base!==text,locked=disabled||state.busy||!!state.bindingRecovery||!!state.bindingPreparation||stale;
 const parallel=content?.program.kind==='rule'&&content.program.groups.some(g=>g.mode==='parallel'),mayOptional=entry?.step.kind==='action'&&content?.program.kind==='rule'&&containers.find(c=>c.path===entry.path)?.mode==='sequence';
 function attempt(run:()=>void){if(locked)return;try{run();setError(null);}catch(e){setError(e instanceof StepEditError?e.code:'stepEditInvalid');}}
 function reload(){setBase(text);setWorking(text);setSelected('');setContainer('');setError(null);setId('');setAction('');setParameters('');setDelay('');setLateness('');setDestination('');setGeneration(g=>g+1);}
 function configure(depends_on:readonly string[],required:boolean,failure_policy:Step['failure_policy']){setWorking(editSteps(working,state,{kind:'configure',step_id:selected,depends_on,required,failure_policy}));}
 return <section className="step-editor"><h2>{copy.stepsTitle}</h2><p className="muted">{copy.stepsHint}</p>
  {stale&&<aside className="notice">{copy.stepEditStale}</aside>}{!content&&<p className="muted">{copy.selectionInvalid}</p>}{error&&<p role="alert">{copy[error]}</p>}
  <button disabled={disabled||state.busy} onClick={reload}>{copy.reloadSteps}</button>
  {content&&<ProgramStructurePanel key={generation} content={content} state={state} copy={copy} locked={locked} onEdit={edit=>attempt(()=>{setWorking(editProgram(working,state,edit));setContainer('');setDestination('');})}/>}
  <label htmlFor="step-container">{copy.stepContainer}</label><select id="step-container" value={container} disabled={locked||!content} onChange={e=>setContainer(e.target.value)}><option value="">{copy.stepContainer}</option>{containers.map(c=><option key={c.path} value={c.path}>{labels.get(c.path)} · {c.mode==='parallel'?copy.stepsParallel:copy.stepsSequence}</option>)}{content?.program.kind==='rule'&&<option value="new-group">{copy.newRuleGroup}</option>}</select>
  {container==='new-group'&&<><label htmlFor="new-group-mode">{copy.groupMode}</label><select id="new-group-mode" disabled={locked} value={newMode} onChange={e=>setNewMode(e.target.value as 'sequence'|'parallel')}><option value="sequence">{copy.stepsSequence}</option><option value="parallel">{copy.stepsParallel}</option></select></>}
  <ol className="step-list">{positions.map(p=><li key={p.step.step_id} data-step-id={p.step.step_id}><button type="button" aria-pressed={selected===p.step.step_id} disabled={locked} onClick={()=>setSelected(p.step.step_id)}>{p.step.step_id} · {p.step.kind==='action'?copy.bindingAction:copy.delayStep}</button><small>{labels.get(p.path)} · {p.index+1}</small><span>{p.step.depends_on.length?copy.stepDependencies+': '+p.step.depends_on.join(', '):copy.noStepDependencies}</span></li>)}</ol>
  {entry&&<fieldset disabled={locked} className="step-properties"><legend>{copy.stepProperties}: {entry.step.step_id}</legend>
   <div className="actions"><button disabled={locked||entry.index===0} onClick={()=>attempt(()=>setWorking(editSteps(working,state,{kind:'move',step_id:selected,direction:-1})))}>{copy.moveStepUp}</button><button disabled={locked||entry.index===containers.find(c=>c.path===entry.path)!.steps.length-1} onClick={()=>attempt(()=>setWorking(editSteps(working,state,{kind:'move',step_id:selected,direction:1})))}>{copy.moveStepDown}</button><button onClick={()=>attempt(()=>{setWorking(editSteps(working,state,{kind:'remove',step_id:selected}));setSelected('');})}>{copy.removeStep}</button></div>
   <p className="muted">{copy.stepDependenciesHint}</p><div className="step-dependencies">{positions.filter(p=>p.branch===entry.branch&&p.rank<entry.rank).map(p=><label key={p.step.step_id}><input type="checkbox" checked={entry.step.depends_on.includes(p.step.step_id)} onChange={e=>attempt(()=>configure(e.target.checked?[...entry.step.depends_on,p.step.step_id]:entry.step.depends_on.filter(id=>id!==p.step.step_id),entry.step.required,entry.step.failure_policy))}/>{p.step.step_id}</label>)}</div>
   <label><input type="checkbox" checked={entry.step.required} disabled={!mayOptional||locked} onChange={e=>attempt(()=>configure(entry.step.depends_on,e.target.checked,'stop'))}/>{copy.stepRequired}</label>
   <label htmlFor="step-failure-policy">{copy.stepFailurePolicy}</label><select id="step-failure-policy" value={entry.step.failure_policy} onChange={e=>attempt(()=>configure(entry.step.depends_on,entry.step.required,e.target.value as Step['failure_policy']))}><option value="stop">{copy.stepStop}</option><option value="continue_if_independent" disabled={!mayOptional||entry.step.required||parallel}>{copy.stepContinue}</option></select>
   {entry.step.kind==='delay'&&<DelayFields key={selected+':'+generation} step={entry.step} copy={copy} locked={locked} onChange={(delay_ms,max_lateness_ms)=>attempt(()=>setWorking(editProgram(working,state,{kind:'delay',step_id:selected,delay_ms,max_lateness_ms})))}/>}
   <label htmlFor="move-step-container">{copy.moveStepContainer}</label><select id="move-step-container" value={destination} onChange={e=>setDestination(e.target.value)}><option value="">{copy.stepContainer}</option>{containers.map(c=><option key={c.path} value={c.path}>{labels.get(c.path)}</option>)}</select>
   <label htmlFor="move-step-position">{copy.moveStepPosition}</label><input id="move-step-position" type="number" min={1} step={1} value={position} onChange={e=>setPosition(e.target.value)}/><button disabled={locked||!destination||position===''} onClick={()=>attempt(()=>setWorking(editProgram(working,state,{kind:'relocate',step_id:selected,container:destination,index:Number(position)-1})))}>{copy.relocateStep}</button><p className="muted">{copy.relocateHint}</p>
  </fieldset>}
  <fieldset disabled={locked||!group&&container!=='new-group'}><legend>{copy.addStep}</legend>
   <label htmlFor="new-step-id">{copy.stepId}</label><input id="new-step-id" maxLength={128} value={id} onChange={e=>setId(e.target.value)}/>
   <label htmlFor="new-step-kind">{copy.stepKind}</label><select id="new-step-kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="delay">{copy.delayStep}</option><option value="action">{copy.bindingAction}</option></select>
   {kind==='delay'?<><label htmlFor="new-step-delay">{copy.stepDelay}</label><input id="new-step-delay" type="number" min={0} max={86400000} step={1} value={delay} onChange={e=>setDelay(e.target.value)}/><label htmlFor="new-step-lateness">{copy.stepLateness}</label><input id="new-step-lateness" type="number" min={1} max={60000} step={1} value={lateness} onChange={e=>setLateness(e.target.value)}/></>:
    <><label htmlFor="new-step-action">{copy.stepActionBinding}</label><select id="new-step-action" value={action} onChange={e=>setAction(e.target.value)}><option value="">{copy.stepActionBinding}</option>{actions.map(a=><option key={a.binding_id} value={a.binding_id}>{a.value.capability_id} — {a.binding_id}</option>)}</select><label htmlFor="new-step-parameters">{copy.stepParameters}</label><textarea id="new-step-parameters" rows={3} value={parameters} onChange={e=>setParameters(e.target.value)}/></>}
   <p className="muted">{copy.newStepDefaults}</p><button disabled={locked||!group&&container!=='new-group'||!id||(kind==='delay'?delay===''||lateness==='':!action||!parameters)} onClick={()=>attempt(()=>{
    const step:Step=kind==='action'?newActionStep(id,action,parameters):{kind:'delay',step_id:id,delay_ms:Number(delay),max_lateness_ms:Number(lateness),depends_on:[],required:true,failure_policy:'stop'};
    if(container==='new-group'){setWorking(editProgram(working,state,{kind:'group-add',mode:newMode,step}));setContainer('/program/groups/'+containers.length+'/steps');}else setWorking(editSteps(working,state,{kind:'add',container,step}));setSelected(id);setId('');
   })}>{copy.addStepPreview}</button>
  </fieldset>
  <p className="muted">{working!==base?copy.stepsPending:copy.stepsUnchanged}</p><button className="primary" disabled={locked||!content||working===base} onClick={()=>attempt(()=>{const next=applyProgramPreview(base,working,state);setBase(next);onChange(next);})}>{copy.applySteps}</button>
 </section>;
}
