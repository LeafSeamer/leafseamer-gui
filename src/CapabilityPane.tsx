import {useState} from 'react';
import {commandLabels} from './i18n.ts';
import type {SessionManager,Snapshot} from './session.ts';
import type {Copy,Language} from './i18n.ts';
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function SchemaDetails({label,document,copy}:{label:string;document:unknown;copy:Copy}){
 const [open,setOpen]=useState(false);
 return <details className="capability-schema" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{label} · {copy.schemaDocument}</summary>
  {open?<pre>{JSON.stringify(document,null,2)}</pre>:null}</details>;
}
function Parameters({document,copy}:{document:unknown;copy:Copy}){
 if(!object(document)||!object(document.properties))return null;
 const required=Array.isArray(document.required)?document.required:[];
 return <dl className="capability-parameters">{Object.entries(document.properties).map(([name,value])=>{
  const spec=object(value)?value:{},type=typeof spec.type==='string'?spec.type:null;
  return <div key={name}><dt>{name}</dt><dd>{type?type+' · ':''}{required.includes(name)?copy.requiredParameter:null}
   {typeof spec.minimum==='number'||typeof spec.maximum==='number'?<span> · {copy.parameterRange} {typeof spec.minimum==='number'?spec.minimum:'−∞'} … {typeof spec.maximum==='number'?spec.maximum:'+∞'}</span>:null}</dd></div>;
 })}</dl>;
}
export function CapabilityPane({manager,state,copy,language}:{manager:SessionManager;state:Snapshot;copy:Copy;language:Language}){
 const catalog=state.capabilities,device=catalog?.devices.find(value=>value.device_id===state.selected);
 return <section className="capability-pane" aria-label={copy.capabilities}><div className="heading"><h2>{copy.capabilities}</h2>
  <button className="primary" disabled={state.busy||!state.selected||!state.session?.permissions.includes('device.read')} onClick={()=>void manager.readCapabilities()}>{copy.readCapabilities}</button></div>
  <p className="muted">{copy.capabilitiesHint}</p>
  {catalog&&device?<>
   <p className="identifier">{copy.capabilityModule}：{catalog.module_id} · {catalog.module_version} · {copy.catalog} {catalog.catalog_revision}</p>
   {state.capabilitiesReadAt?<p className="muted">{copy.lastRead}：{new Date(state.capabilitiesReadAt).toLocaleString(language==='zh'?'zh-CN':'en-US',{timeZoneName:'short'})}</p>:null}
   <h3>{copy.capabilityActions} ({device.actions.length})</h3>
   {device.actions.length===0?<p className="muted">{copy.noActions}</p>:device.actions.map(action=><details className="capability-action" key={action.action_id}>
    <summary>{action.action_id}</summary><p>{copy.capabilityVersion}：{action.capability_version}</p>
    <p>{copy.capabilityCompletion}：{action.completion.supported.map(level=>commandLabels[language][level]??level).join(' / ')}</p>
    <p className="capability-qualification">{action.footprint.complete?copy.footprintComplete:copy.footprintIncomplete}</p>
    <h4>{copy.parameterSchema}</h4><p className="muted">{copy.parameterPreviewHint}</p><Parameters document={action.parameters_schema.document} copy={copy}/>
    <SchemaDetails label={copy.parameterSchema} document={action.parameters_schema.document} copy={copy}/>
    <SchemaDetails label={copy.resultSchema} document={action.result_schema.document} copy={copy}/>
    <SchemaDetails label={copy.preconditionsSchema} document={action.preconditions_schema.document} copy={copy}/>
   </details>)}
   <h3>{copy.capabilityTriggers} ({device.triggers.length})</h3>
   {device.triggers.length===0?<p className="muted">{copy.noTriggers}</p>:device.triggers.map(trigger=><details className="capability-action" key={trigger.trigger_id}><summary>{trigger.trigger_id}</summary>
    <SchemaDetails label={copy.triggerSchema} document={trigger.payload_schema.document} copy={copy}/></details>)}
   <SchemaDetails label={copy.stateSchema} document={device.state_schema.document} copy={copy}/>
  </>:<p className="muted">{copy.noCapabilities}</p>}
 </section>;
}
