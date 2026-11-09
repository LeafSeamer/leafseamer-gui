// 合成命令视图，只用于消费者与界面验证，不证明设备执行。
const digest='sha256:'+'a'.repeat(64),ref=id=>({id,revision:'1',digest});
export function commandRecord(scope){
 const state={command_id:'command_test',scope,revision:'1',phase:'queued',outcome:'pending',effect_status:'not_sent',resource_status:'clear',
  automation_continuation:'eligible',reason_code:null,terminal_revision:null,resolution_ref:null,completion_evidence_refs:[],resource_evidence_refs:[],attempt_ids:[]};
 return {command_id:state.command_id,scope,revision:'1',initial_command_ref:{kind:'command',scope,object_id:state.command_id,revision:'1',digest},
  request_identity:{key:{target_scope:scope,issuer_id:'issuer_test',issuer_epoch:'1',principal_id:'person_test',request_epoch:'1',operation_id:'createCommand',idempotency_key:'request_test'},request_digest:digest},
  target:{device_id:'device_test',action_id:'value.set',capability_version:'1.0.0'},
  actor:{principal_id:'person_test',session_id:'session_test',authorization_revision:'1',issuer_id:'issuer_test',issuer_epoch:'1',local_subject_id:'person_test'},
  origin:'manual',run_binding:null,automation_binding:null,accepted_at:null,dispatch:{mode:'immediate',max_queue_ms:1000},control_binding:{epoch:'epoch_test',version:'1'},
  policy:{command_id:state.command_id,scope,device_id:'device_test',admission_ref:ref('admission'),required_completion:'sent',completion_policy_ref:ref('completion'),
   release_policy_ref:ref('release'),retry_policy_ref:null,max_attempts:1,original_deadline_ref:ref('deadline'),conflict_scope:'whole_device'},
  state_ref:ref('state'),state,completion:{required:'sent',achieved:null,policy_ref:ref('completion'),evidence_refs:[]},attempts:[],cancellation:null,
  evidence_index:{snapshot_ref:ref('snapshot'),state_ref:ref('state'),total:'0'},record_digest:digest};
}
