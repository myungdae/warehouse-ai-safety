(function(g){'use strict';
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v)),states=Object.freeze(['NORMAL','NEAR_LIMIT','COMPACTING','DEGRADED','ERROR']),admissionOutcomes=Object.freeze(['ADMITTED','ADMITTED_AFTER_COMPACTION','REJECTED_CAPACITY','REJECTED_PINNED_CAPACITY','DEGRADED_ADMISSION','ERROR']),pinnedCategories=Object.freeze(['ACTIVE_RISK','CURRENT_VOICE_DECISION','ACTIVE_PLAYBACK','ACTIVE_SCENARIO','ACTIVE_COMPANION_DECISION','CURRENT_ASSIGNMENT','ACTIVE_HARDWARE_OWNERSHIP','RESET_IN_PROGRESS','CRITICAL_INCIDENT']);
const terminalRank=x=>x.state==='EXPIRED'?0:x.state==='CANCELLED'?1:x.state==='SUPERSEDED'?2:x.state==='ACKNOWLEDGED'?3:4;
class RuntimeBoundedStore{
constructor({storeCode,maximumEntries,maximumAgeMs=Infinity,criticalReserveEntries=0,now=()=>Date.now(),idOf=x=>x.id||x.auditId||x.artifactId||x.eventId||x.decisionId||x.requestId,isActive=x=>x.active===true||['ACTIVE','PLAYING','QUEUED','NEW','CREATED'].includes(x.state||x.deliveryState||x.lifecycle),isCritical=x=>x.criticalReserveEligible===true,auditMaximumEntries=500,auditMaximumAgeMs=28800000}={}){
if(!storeCode||!Number.isInteger(maximumEntries)||maximumEntries<1||!Number.isInteger(criticalReserveEntries)||criticalReserveEntries<0)throw TypeError('Valid bounded store configuration required');
this.storeCode=storeCode;this.maximumEntries=maximumEntries;this.maximumAgeMs=maximumAgeMs;this.criticalReserveEntries=criticalReserveEntries;this.now=now;this.idOf=idOf;this.isActive=isActive;this.isCritical=isCritical;this.items=[];this.droppedCount=0;this.rejectedAdmissionCount=0;this.lastCompactedAt=null;this.lastAdmission=null;this.state='NORMAL';this.audit=[];this.auditSequence=0;this.auditMaximumEntries=auditMaximumEntries;this.auditMaximumAgeMs=auditMaximumAgeMs;this.auditDroppedCount=0;this.lastAuditCompactedAt=null;this.version='DEVELOPMENT_CANDIDATE_RETENTION_POLICY-v1';
}
_time(x){const t=Date.parse(x?.timestamp||x?.createdAt||x?.updatedAt||x?.startedAt||x?.requestedAt||x?.completedAt||x?.pinnedAt);return Number.isFinite(t)?t:-Infinity}
_out(x){return clone(x)}
_isPinned(x){return this.isActive(x)||Boolean(x?.pinReason)}
_releaseInvalidPins(){this.items=this.items.map(x=>{const terminal=['EXPIRED','CANCELLED','SUPERSEDED','RELEASED','CLOSED_BY_RESET'].includes(x?.state||x?.runtimeState||x?.resultState),stale=x?.pinGeneration!=null&&x?.generation!=null&&x.pinGeneration!==x.generation;if(!x?.pinReason||(!terminal&&!stale))return x;return{...x,pinReason:null,pinnedAt:null,criticalReserveEligible:false}})}
_audit(eventType,details={},at=this.now()){
const entry={auditId:`${this.storeCode.toLowerCase()}-audit-${++this.auditSequence}`,eventType,storeCode:this.storeCode,...clone(details),timestamp:new Date(at).toISOString()};this.audit.push(entry);
const expired=this.audit.filter(x=>at-Date.parse(x.timestamp)>this.auditMaximumAgeMs).length;if(expired){this.audit.splice(0,expired);this.auditDroppedCount+=expired}
if(this.audit.length>this.auditMaximumEntries){const drop=this.audit.length-this.auditMaximumEntries;this.audit.splice(0,drop);this.auditDroppedCount+=drop}
if(expired||this.audit.length===this.auditMaximumEntries)this.lastAuditCompactedAt=new Date(at).toISOString();return entry;
}
_setAdmission(outcome,reasonCode,id,at=this.now()){this.lastAdmission={outcome,reasonCode,id:id??null,timestamp:new Date(at).toISOString()};return this.lastAdmission}
_drop(items,at,reason='RETENTION_COMPACTED'){
if(!items.length)return 0;const drop=new Set(items);this.items=this.items.filter(x=>!drop.has(x));this.droppedCount+=drop.size;this._audit(reason,{dropped:drop.size,droppedCount:this.droppedCount},at);return drop.size;
}
_ordinaryCandidates(){return this.items.filter(x=>!this._isPinned(x)).sort((a,b)=>terminalRank(a)-terminalRank(b)||this._time(a)-this._time(b))}
add(x){
const at=this.now(),id=this.idOf(x);if(id!=null&&this.items.some(v=>this.idOf(v)===id))return this.update(id,()=>x);
this.compact(at);let outcome='ADMITTED';
if(this.items.length>=this.maximumEntries){const candidate=this._ordinaryCandidates()[0];if(candidate){this._drop([candidate],at,'RETENTION_COMPACTED');outcome='ADMITTED_AFTER_COMPACTION'}else if(this.isCritical(x)&&this.items.length<this.maximumEntries+this.criticalReserveEntries){outcome='DEGRADED_ADMISSION'}else{const pinned=this.items.every(v=>this._isPinned(v)),reason=pinned?'PINNED_CAPACITY':'CAPACITY';this.rejectedAdmissionCount++;this.droppedCount++;this.state='DEGRADED';this._setAdmission(pinned?'REJECTED_PINNED_CAPACITY':'REJECTED_CAPACITY',reason,id,at);this._audit('ADMISSION_REJECTED',{reasonCode:reason,id:id??null,rejectedAdmissionCount:this.rejectedAdmissionCount},at);return null}}
this.items.push(this._out(x));this._releaseInvalidPins();this._setAdmission(outcome,outcome,id,at);this._refreshState();return this._out(this.items.find(v=>this.idOf(v)===id)||x);
}
update(id,fn){const i=this.items.findIndex(x=>this.idOf(x)===id);if(i<0)return null;try{const next=fn(this._out(this.items[i]));this.items[i]=this._out(next);this.compact(this.now());this._setAdmission('ADMITTED','DUPLICATE_UPDATE',id);return this._out(next)}catch(error){this.state='ERROR';this._setAdmission('ERROR',error?.message||'UPDATE_ERROR',id);throw error}}
get(id){return this._out(this.items.find(x=>this.idOf(x)===id)||null)}
list(filter=()=>true){return this.items.filter(filter).map(x=>this._out(x))}
remove(id){const i=this.items.findIndex(x=>this.idOf(x)===id);if(i<0)return false;this.items.splice(i,1);this._refreshState();return true}
compact(at=this.now()){
this.state='COMPACTING';this._releaseInvalidPins();const candidates=this._ordinaryCandidates(),expired=candidates.filter(x=>at-this._time(x)>this.maximumAgeMs);this._drop(expired,at);
const over=Math.max(0,this.items.length-(this.maximumEntries+this.criticalReserveEntries));if(over)this._drop(this._ordinaryCandidates().slice(0,over),at);
this.lastCompactedAt=new Date(at).toISOString();this._refreshState();return this.getMetrics();
}
_refreshState(){const hard=this.maximumEntries+this.criticalReserveEntries,pinned=this.items.filter(x=>this._isPinned(x)).length;this.state=this.items.length>=hard&&pinned===this.items.length?'DEGRADED':this.items.length>=this.maximumEntries*.8?'NEAR_LIMIT':'NORMAL'}
reset(){this.items=[];this.state='NORMAL';this.lastCompactedAt=new Date(this.now()).toISOString();this.lastAdmission=null}
getLastAdmission(){return clone(this.lastAdmission)}
getPinState(){const entries=this.items.filter(x=>this._isPinned(x)).map(x=>({id:this.idOf(x),pinReason:x.pinReason||'ACTIVE_STATE',pinnedAt:x.pinnedAt||x.timestamp||null,pinGeneration:x.pinGeneration??x.generation??0,criticalReserveEligible:this.isCritical(x)}));return{count:entries.length,leakedCount:entries.filter(x=>['EXPIRED','CANCELLED','SUPERSEDED','RELEASED'].includes(this.items.find(v=>this.idOf(v)===x.id)?.state)).length,entries:clone(entries)}}
getMetrics(){const pins=this.getPinState();return{storeCode:this.storeCode,maximumEntries:this.maximumEntries,maximumAgeMs:this.maximumAgeMs,criticalReserveEntries:this.criticalReserveEntries,hardCapacity:this.maximumEntries+this.criticalReserveEntries,activeEntryPolicy:'PIN_ACTIVE_WITH_HARD_ADMISSION_LIMIT',evictionOrder:'TERMINAL_PRIORITY_THEN_OLDEST',compactionMode:'BEFORE_ADMISSION_AND_ON_WRITE',currentEntries:this.items.length,droppedCount:this.droppedCount,rejectedAdmissionCount:this.rejectedAdmissionCount,lastAdmission:clone(this.lastAdmission),pinCount:pins.count,pinLeakCount:pins.leakedCount,lastCompactedAt:this.lastCompactedAt,state:this.state,version:this.version,auditCount:this.audit.length,auditLimit:this.auditMaximumEntries,auditMaximumAgeMs:this.auditMaximumAgeMs,auditDroppedCount:this.auditDroppedCount,lastAuditCompactedAt:this.lastAuditCompactedAt}}
exportSummary(){return clone({...this.getMetrics(),audit:this.audit})}
}
const limits=Object.freeze({RISK_HISTORY:[1000,28800000],CONFIDENCE_AUDIT:[1000,28800000],IDENTITY_AUDIT:[500,28800000],VOICE_HISTORY:[256,7200000],PLAYBACK_HISTORY:[500,7200000],SCENARIO_HISTORY:[500,7200000],MEMORY_HISTORY:[2000,28800000],COMPANION_HISTORY:[1000,28800000],REPLAY_HISTORY:[5000,86400000],EDGE_HARDWARE_HISTORY:[1000,28800000]});
function createArray(storeCode,options={}){const [maximumEntries,maximumAgeMs]=limits[storeCode]||[500,28800000],store=new RuntimeBoundedStore({storeCode,maximumEntries,maximumAgeMs,...options}),array=[];Object.defineProperties(array,{_boundedStore:{value:store},push:{value:function(...xs){xs.forEach(x=>store.add(x));const values=store.list();Array.prototype.splice.call(this,0,this.length,...values);return this.length}},retentionMetrics:{value:()=>store.getMetrics()}});return array}
g.RuntimeBoundedStore=Object.freeze({states,admissionOutcomes,pinnedCategories,limits,RuntimeBoundedStore,createArray});
})(window);
