import {contractSelection} from '@leafseamer/sdk';
export type BindingSource=Readonly<{binding_id:string;devices:readonly Readonly<{device_id:string;label:string}>[]}>;
export type SeamerSite = Readonly<{service_id:string;database_instance_id:string;base_url:string;service_label:string;binding_source?:BindingSource|null}>;
export type Site = Readonly<{format:'leafseamer.gui.site/1'|'leafseamer.gui.site/2'|'leafseamer.gui.site/3';site_label:string;service_id:string|null;database_instance_id:string|null;selection:typeof contractSelection;seamer?:SeamerSite|null}>;
const exact=(v:object,names:string)=>Object.keys(v).sort().join(',')===names;
const uuid=(v:unknown)=>typeof v==='string'&&v.length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const label=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=120&&!/[\u0000-\u001f\u007f]/.test(v);
export function validateSite(value:unknown):Site{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('site_configuration');
 const v=value as Site,v3=v.format==='leafseamer.gui.site/3',v2=v3||v.format==='leafseamer.gui.site/2';
 if(!exact(v,v2?'database_instance_id,format,seamer,selection,service_id,site_label':'database_instance_id,format,selection,service_id,site_label')||
  !['leafseamer.gui.site/1','leafseamer.gui.site/2','leafseamer.gui.site/3'].includes(v.format)||!label(v.site_label)||
  !(v.service_id===null&&v.database_instance_id===null||uuid(v.service_id)&&uuid(v.database_instance_id))||
  !v.selection||!exact(v.selection,'contract_digest,contract_id')||v.selection.contract_id!==contractSelection.contract_id||v.selection.contract_digest!==contractSelection.contract_digest)throw new Error('site_configuration');
 if(v2&&v.seamer!==null){
  const s=v.seamer;if(!s||!exact(s,v3?'base_url,binding_source,database_instance_id,service_id,service_label':'base_url,database_instance_id,service_id,service_label')||!v.service_id||!uuid(s.service_id)||!uuid(s.database_instance_id)||s.service_id===v.service_id||!label(s.service_label)||typeof s.base_url!=='string'||s.base_url.length>1024)throw new Error('site_configuration');
  if(v3&&s.binding_source!==null){const b=s.binding_source;if(!b||!exact(b,'binding_id,devices')||!uuid(b.binding_id)||!Array.isArray(b.devices)||b.devices.length<1||b.devices.length>64||b.devices.some(d=>!d||!exact(d,'device_id,label')||!uuid(d.device_id)||!label(d.label))||new Set(b.devices.map(d=>d.device_id)).size!==b.devices.length)throw new Error('site_configuration');}
  const url=new URL(s.base_url),prefix=url.pathname==='/'?'':url.pathname;
  if(!/^https:\/\/(?:\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::[0-9]+)?$/.test(url.origin)||url.username||url.password||url.search||url.hash||
   !(prefix===''||/^\/services\/[A-Za-z0-9_-]+$/.test(prefix))||s.base_url!==url.origin+prefix)throw new Error('site_configuration');
 }
 return Object.freeze({...v,selection:contractSelection,...(v2?{seamer:v.seamer?Object.freeze({...v.seamer,...(v3?{binding_source:v.seamer.binding_source?Object.freeze({...v.seamer.binding_source,devices:Object.freeze(v.seamer.binding_source.devices.map(d=>Object.freeze({...d}))) }):null}:{})}):null}:{})});
}
