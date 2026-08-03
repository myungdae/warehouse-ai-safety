(function(g){'use strict';
const result=(state,action,voice,urgency,ack=false,level=0,reasons=[],suppressed=[])=>({companionState:state,recommendedActionCode:action,selectedVoiceScenarioCode:voice,urgency,requiresAcknowledgement:ack,escalationLevel:level,decisionReasonCodes:reasons,suppressedRecommendationCodes:suppressed});
function map(i={}){const h=i.immediateHazardState||{},fat=i.fatigueTrend||'UNKNOWN',risk=i.riskTrend||'UNKNOWN',conf=i.confidenceBand||'UNKNOWN',types=new Set(i.activeRiskTypes||[]),reason=[];
if(h.type==='COLLISION_CRITICAL')return result('URGENT_WARNING','STOP_WHEN_SAFE','COLLISION_CRITICAL','CRITICAL',true,4,['IMMEDIATE_COLLISION_DOMINANT']);
if(['PEDESTRIAN_IMMEDIATE','RIGHT_TURN_PEDESTRIAN_CRITICAL'].includes(h.type))return result('URGENT_WARNING','STOP_TURN_AND_CHECK','RIGHT_TURN_PEDESTRIAN_WARNING','CRITICAL',true,4,['IMMEDIATE_PEDESTRIAN_DOMINANT']);
if(h.type==='VEHICLE_LOW_TTC')return result('URGENT_WARNING','REDUCE_SPEED','VEHICLE_LOW_TTC_WARNING','CRITICAL',true,4,['LOW_TTC_DOMINANT']);
if(h.type==='INCAPACITATION_NO_RESPONSE'||i.ackType==='NO_RESPONSE')return result('EMERGENCY_ASSISTANCE_CANDIDATE','REQUEST_HELP_CANDIDATE','DRIVER_ACK_REQUEST','CRITICAL',true,4,['NO_RESPONSE_ESCALATION']);
if(h.type==='ALCOHOL_IN_OPERATION')return result('URGENT_WARNING','STOP_WHEN_SAFE','ALCOHOL_DETECTED_IN_OPERATION','CRITICAL',true,4,['ALCOHOL_IN_OPERATION']);
if(types.has('ALCOHOL_POLICY_VIOLATION'))return result('WARNING','DO_NOT_DRIVE','ALCOHOL_DETECTED_PRESTART','HIGH',true,3,['ALCOHOL_PRESTART']);
if(types.has('DRIVER_INCAPACITATION'))return result('STATUS_CHECK','RESPOND_IF_OK','DRIVER_ACK_REQUEST','HIGH',true,2,['INCAPACITATION_STATUS_CHECK']);
if(types.has('LONG_EYE_CLOSURE'))return result(fat==='RAPID_INCREASE'?'SAFE_STOP_RECOMMENDED':'WARNING',fat==='RAPID_INCREASE'?'STOP_WHEN_SAFE':'LOOK_FORWARD',fat==='RAPID_INCREASE'?'SAFE_STOP_RECOMMENDED':'LONG_EYE_CLOSURE_WARNING','HIGH',true,3,['LONG_EYE_CLOSURE',fat]);
if(types.has('PHONE_DISTRACTION'))return result('WARNING','LOOK_FORWARD','PHONE_DISTRACTION_WARNING','HIGH',false,2,['PHONE_EVIDENCE_PRIORITY']);
if(types.has('DROWSINESS')&&['INCREASING','RAPID_INCREASE','CRITICAL'].includes(fat))return result(fat==='INCREASING'?'REST_RECOMMENDED':'SAFE_STOP_RECOMMENDED',fat==='INCREASING'?'REST_WHEN_SAFE':'STOP_WHEN_SAFE',fat==='INCREASING'?'FATIGUE_TREND_INCREASING':'SAFE_STOP_RECOMMENDED',fat==='INCREASING'?'MEDIUM':'HIGH',false,fat==='INCREASING'?2:3,['PERSISTENT_DROWSINESS',fat]);
if(types.has('ATTENTION_LOSS')||i.contextTrend==='REPEATED_ATTENTION_LOSS')return result('WARNING','LOOK_FORWARD','REPEATED_ATTENTION_LOSS_TREND','MEDIUM',false,2,['REPEATED_ATTENTION_LOSS']);
if(['LOW','UNRELIABLE'].includes(conf)||['CONFIDENCE_DEGRADING','CONFIDENCE_UNRELIABLE'].includes(i.confidenceTrend))return result('SYSTEM_DEGRADED','VERIFY_SENSOR','CONFIDENCE_DEGRADING_NOTICE','LOW',false,1,['CONFIDENCE_GATING_APPLIED']);
if(fat==='IMPROVING'||risk==='RISK_DECREASING')return result('RECOVERY_MONITORING','CONTINUE_MONITORING',null,'LOW',false,0,['IMPROVING_TREND','REASSURANCE_SUPPRESSED'],['FATIGUE_TREND_IMPROVING']);
if(i.evidenceCount==null||i.evidenceCount<1)return result('INSUFFICIENT_EVIDENCE','NO_ACTION',null,'NONE',false,0,['INSUFFICIENT_EVIDENCE']);
return result(fat==='MILD_INCREASE'?'CAUTIONING':'OBSERVING',fat==='MILD_INCREASE'?'PREPARE_TO_REST':'CONTINUE_MONITORING',fat==='MILD_INCREASE'?'FATIGUE_TREND_INCREASING':null,fat==='MILD_INCREASE'?'LOW':'NONE',false,fat==='MILD_INCREASE'?1:0,['DEVELOPMENT_MATRIX',fat,risk]);}
g.DriverCompanionRecommendationMapper=Object.freeze({map});})(window);
