(function(g){'use strict';
const states=['OBSERVING','INFORMING','CAUTIONING','WARNING','URGENT_WARNING','STATUS_CHECK','REST_RECOMMENDED','SAFE_STOP_RECOMMENDED','EMERGENCY_ASSISTANCE_CANDIDATE','RECOVERY_MONITORING','INSUFFICIENT_EVIDENCE','SYSTEM_DEGRADED','UNKNOWN'];
const actions=['CONTINUE_MONITORING','LOOK_FORWARD','CHECK_RIGHT_SIDE','REDUCE_SPEED','STOP_TURN_AND_CHECK','PREPARE_TO_REST','REST_WHEN_SAFE','STOP_WHEN_SAFE','RESPOND_IF_OK','REQUEST_HELP_CANDIDATE','DO_NOT_DRIVE','VERIFY_SENSOR','RECALIBRATE_SYSTEM','RESTORE_CAMERA','NO_ACTION','UNKNOWN'];
const lifecycle=['CREATED','ACTIVE','ACKNOWLEDGED','SUPERSEDED','EXPIRED','CANCELLED'];
const acknowledgements=['PHYSICAL_BUTTON','I_AM_OK','I_WILL_STOP','HELP','TIMEOUT','NO_RESPONSE','UI_FIXTURE'];
g.DriverCompanionConfig=Object.freeze({schemaVersion:'1.0.0',policyVersion:'DEVELOPMENT_UNVALIDATED_COMPANION_POLICY-v1',states:Object.freeze(states),actions:Object.freeze(actions),lifecycle:Object.freeze(lifecycle),acknowledgements:Object.freeze(acknowledgements),defaultExpiryMs:30000,operationalUseAllowed:false,actuatorConnected:false});
})(window);
