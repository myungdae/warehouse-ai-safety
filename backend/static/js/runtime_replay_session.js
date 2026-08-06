(function defineRuntimeReplaySession(global){
    'use strict';
    const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
    const freeze=value=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.values(value).forEach(freeze);return Object.freeze(value)};
    const required=(value,name)=>{if(typeof value!=='string'||!value)throw new TypeError(`${name} is required`);return value};
    const iso=value=>{const time=Date.parse(value);if(!Number.isFinite(time))throw new TypeError(`${value} is not a valid timestamp`);return new Date(time).toISOString()};
    const forbidden=new Set(['image','imagedata','frame','video','base64','blob','landmarks','rawlandmarks','facecrop','faceembedding','biometrictemplate','mp4','avi']);
    const privacy=(value,path='payload')=>{if(typeof value==='number'&&!Number.isFinite(value))throw new TypeError(`NON_FINITE_NUMBER:${path}`);if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(forbidden.has(key.toLowerCase()))throw new Error(`PRIVACY_VIOLATION:${path}.${key}`);privacy(child,`${path}.${key}`)}};
    const EventType=freeze(['Observation','RiskCreated','RiskActivated','RiskAcknowledged','RiskCleared','OperationalContextChanged','CompositeRiskChanged','PriorityChanged','ConfidenceChanged','RecommendationChanged','IdentityChanged','ReplayMarker']);
    const SessionStatus=freeze(['CREATED','READY','PLAYING','PAUSED','FINISHED','ENDED']);
    class ReplayEvent{
        constructor(input){if(!input||typeof input!=='object')throw new TypeError('ReplayEvent input is required');privacy(input.payload);this.timestamp=iso(input.timestamp);this.sequence=Number.isInteger(input.sequence)&&input.sequence>=0?input.sequence:(()=>{throw new TypeError('sequence must be a non-negative integer')})();this.eventType=EventType.includes(input.eventType)?input.eventType:(()=>{throw new RangeError(`Unsupported eventType: ${input.eventType}`)})();this.source=required(input.source,'source');this.payload=freeze(clone(input.payload||{}));this.simulation=input.simulation!==false;this.operationalUseAllowed=false;freeze(this)}
        toJSON(){return clone({...this})}
    }
    class ReplaySession{
        constructor(input){if(!input||typeof input!=='object')throw new TypeError('ReplaySession input is required');this.sessionId=required(input.sessionId,'sessionId');this.schemaVersion=input.schemaVersion||'1.0.0';this.startedAt=iso(input.startedAt);this.endedAt=input.endedAt?iso(input.endedAt):null;this.canonicalTarget=required(input.canonicalTarget,'canonicalTarget');this.assignment=required(input.assignment,'assignment');this.runtimeVersion=required(input.runtimeVersion||'warehouse-runtime-replay-v1','runtimeVersion');this.eventCount=Number.isInteger(input.eventCount)&&input.eventCount>=0?input.eventCount:0;this.status=SessionStatus.includes(input.status)?input.status:'CREATED';this.simulation=input.simulation!==false;this.operationalUseAllowed=false;freeze(this)}
        toJSON(){return clone({...this})}
    }
    global.RuntimeReplaySession=Object.freeze({EventType,SessionStatus,ReplayEvent,ReplaySession,privacyGuard:privacy});
})(window);
