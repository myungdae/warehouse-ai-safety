(function defineMultiHazardFusionEngine(global) {
    'use strict';
    if (!global.RuntimeOperationalContext || !global.MultiHazardFusionConfig) {
        throw new Error('MultiHazardFusionEngine requires models and configuration');
    }
    const { ContextCondition, OperationalContext, CompositeRisk, PriorityDecision } = global.RuntimeOperationalContext;
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const activeStates = new Set(['NEW','ACTIVE','ACKNOWLEDGED']);
    const forbiddenKeys = new Set(['landmarks','rawlandmarks','frame','video','canvas','image','imagedata','base64','blob','faceembedding','biometrictemplate']);
    const iso = value => new Date(value).toISOString();
    const hasAll = (set, required) => required.every(value => set.has(value));
    const safeId = value => String(value).replace(/[^a-zA-Z0-9_|-]/g, '-');

    function privacyViolation(value, seen = new Set()) {
        if (!value || typeof value !== 'object') return null;
        if (seen.has(value)) return 'CIRCULAR_REFERENCE';
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (forbiddenKeys.has(key.toLowerCase())) return key;
            const nested = privacyViolation(child, seen); if (nested) return nested;
        }
        seen.delete(value); return null;
    }

    class FusionLineage {
        constructor() { this.nodes = new Map(); this.edges = new Map(); this.triples = new Map(); }
        node(id, type, metadata) { this.nodes.set(id, { nodeId:id, nodeType:type, metadata:clone(metadata) }); return id; }
        edge(from, relation, to, metadata={}) { const id=`${from}|${relation}|${to}`;this.edges.set(id,{ edgeId:`fusion-edge:${id}`,from,to,relation,metadata:clone(metadata) });this.triple(from, relation, to, 'IRI'); }
        triple(subject, predicate, object, objectType='Literal') { const id=`${subject}|${predicate}|${JSON.stringify(object)}`;this.triples.set(id,{tripleId:`fusion-triple:${this.triples.size+1}`,subject,predicate,object:clone(object),objectType}); }
        record(context, composite, decision, risks, conditions, actions, executions) {
            const contextNode=this.node(`OperationalContext:${context.contextId}`,'OperationalContext',context);
            const vehicleNode=context.vehicleId?this.node(`Vehicle:${context.vehicleId}`,'Vehicle',{vehicleId:context.vehicleId,vehicleType:context.vehicleType}):null;
            const driverNode=context.driverId?this.node(`Driver:${context.driverId}|${context.driverAssignmentId||'UNASSIGNED'}`,'Driver',{driverId:context.driverId,driverAssignmentId:context.driverAssignmentId}):null;
            risks.forEach(risk=>{const riskNode=this.node(`RiskEvent:${risk.eventId}`,'RiskEvent',risk);this.edge(riskNode,'CONTRIBUTED_TO',contextNode);this.triple(riskNode,'contributedToContext',contextNode,'IRI');this.triple(contextNode,'hasContributingRisk',riskNode,'IRI');});
            conditions.forEach(condition=>{const node=this.node(`Condition:${condition.conditionId}`,'Condition',condition);this.edge(node,'APPLIES_TO',contextNode);});
            const compositeNode=this.node(`CompositeRisk:${composite.compositeRiskId}`,'CompositeRisk',composite);
            this.edge(contextNode,'GENERATED',compositeNode);this.triple(contextNode,'generatedCompositeRisk',compositeNode,'IRI');
            risks.forEach(risk=>{const riskNode=`RiskEvent:${risk.eventId}`;this.edge(compositeNode,'DERIVED_FROM',riskNode);this.triple(compositeNode,'derivedFromRiskEvent',riskNode,'IRI');});
            if(vehicleNode){this.edge(compositeNode,'APPLIES_TO',vehicleNode);this.triple(compositeNode,'appliesTo',vehicleNode,'IRI');}
            if(driverNode){this.edge(compositeNode,'CONCERNS',driverNode);this.triple(compositeNode,'concerns',driverNode,'IRI');}
            this.triple(compositeNode,'hasPriorityScore',composite.priorityScore);this.triple(compositeNode,'hasPriorityBand',composite.priorityBand);
            this.triple(compositeNode,'hasDominantRisk',composite.dominantRiskType || 'NONE');
            composite.reasonCodes.forEach(code=>this.triple(compositeNode,'hasReasonCode',code));
            const decisionNode=this.node(`PriorityDecision:${decision.priorityDecisionId}`,'PriorityDecision',decision);
            this.edge(compositeNode,'TRIGGERED',decisionNode);this.triple(compositeNode,'selectedPolicy',decision.selectedPolicy || 'NO_ACTION');
            actions.forEach(action=>{const node=this.node(`ActionRequest:${action.actionId}`,'ActionRequest',action);this.edge(decisionNode,'REQUESTED',node);this.triple(decisionNode,'recommendedAction',action.actionType);});
            executions.forEach(execution=>{const node=this.node(`ActionExecution:${execution.executionId}`,'ActionExecution',execution);this.edge(`ActionRequest:${execution.actionId}`,'DISPATCHED',node);});
        }
        toJSON() { return { nodes:clone([...this.nodes.values()]), edges:clone([...this.edges.values()]), triples:clone([...this.triples.values()]) }; }
    }

    class FusionEngine {
        constructor({ configuration=global.MultiHazardFusionConfig, now=()=>Date.now(), scheduler=global.setTimeout?.bind(global), canceller=global.clearTimeout?.bind(global), actionSink=null }={}) {
            this.configuration=configuration;this.now=now;this.scheduler=scheduler;this.canceller=canceller;this.actionSink=actionSink;
            this.contexts=new Map();this.targetKeys=new Map();this.risks=new Map();this.conditions=new Map();this.composites=new Map();this.decisions=new Map();this.audit=[];this.sequence=0;this.actionSignatures=new Map();this.lineage=new FusionLineage();this.timers=new Map();
        }
        _identity(input) {
            const supplied=input.operationalContext||input.metadata?.operationalContext||{};
            const targetId=supplied.targetId||input.targetId;if(!targetId)throw new TypeError('Canonical targetId is required');
            const pieces=String(targetId).split('|');
            return { targetId:String(targetId),vehicleId:supplied.vehicleId||pieces[0]||null,vehicleType:supplied.vehicleType||null,
                driverId:supplied.driverId||(pieces.length===3?pieces[1]:null),driverAssignmentId:supplied.driverAssignmentId||(pieces.length===3?pieces[2]:null),
                motionState:supplied.motionState||null,operationState:supplied.operationState||null,directionState:supplied.directionState||null,turnState:supplied.turnState||null };
        }
        _key(identity) { return `${identity.targetId}|${identity.driverAssignmentId||'UNASSIGNED'}`; }
        _state(identity, at) {
            const key=this._key(identity);let state=this.contexts.get(key);
            if(!state){this.sequence+=1;state={key,identity:clone(identity),contextId:`operational-context-${safeId(key)}-${this.sequence}`,createdAt:iso(at),updatedAt:iso(at),status:'OPEN',riskKeys:new Set(),conditionIds:new Set(),generation:0,compositeSequence:0};this.contexts.set(key,state);if(!this.targetKeys.has(identity.targetId))this.targetKeys.set(identity.targetId,new Set());this.targetKeys.get(identity.targetId).add(key);this._audit('CONTEXT_CREATED',state,{},[],[]);}
            return state;
        }
        ingestRiskEvent(input) {
            const event=input?.toJSON?input.toJSON():clone(input);if(!event?.eventId||!event.eventType||!event.targetId||!event.state)throw new TypeError('RiskEvent identity, type, target, and state are required');
            const violation=privacyViolation(event);if(violation)throw new Error(`PRIVACY_VIOLATION:${violation}`);
            const identity=this._identity(event),state=this._state(identity,event.updatedTime||event.createdTime||this.now());
            if(state.identity.driverAssignmentId!==identity.driverAssignmentId)throw new RangeError('Assignment context mismatch');
            const source=event.sourceEventId||event.metadata?.sourceEventId||event.eventId;const correlation=`${state.key}|${event.eventType}|${source}`;
            const previous=this.risks.get(correlation);if(previous&&previous.eventId===event.eventId&&previous.state===event.state&&previous.updatedTime===event.updatedTime)return this.reevaluate(identity.targetId,state.key);
            this.risks.set(correlation,Object.freeze({...clone(event),sourceEventId:source,contextKey:state.key}));state.riskKeys.add(correlation);state.updatedAt=iso(event.updatedTime||event.createdTime||this.now());state.status='OPEN';
            this._audit('RISK_ADDED',state,{eventType:event.eventType,state:event.state},[event.eventId],[]);const result=this.reevaluate(identity.targetId,state.key);this._schedule(state);return result;
        }
        ingestCondition(input) {
            const condition=input instanceof ContextCondition?input:new ContextCondition(input);const violation=privacyViolation(condition);if(violation)throw new Error(`PRIVACY_VIOLATION:${violation}`);
            const identity=this._identity(condition),state=this._state(identity,condition.timestamp);if(state.identity.driverAssignmentId!==condition.driverAssignmentId&&condition.driverAssignmentId)throw new RangeError('Assignment context mismatch');
            this.conditions.set(condition.conditionId,condition);state.conditionIds.add(condition.conditionId);state.updatedAt=condition.timestamp;state.status='OPEN';this._audit('CONDITION_ADDED',state,{conditionType:condition.conditionType},[condition.sourceObservationId].filter(Boolean),[]);const result=this.reevaluate(identity.targetId,state.key);this._schedule(state);return result;
        }
        removeCondition(conditionId) { const condition=this.conditions.get(conditionId);if(!condition)return false;this.conditions.delete(conditionId);for(const state of this.contexts.values())state.conditionIds.delete(conditionId);return true; }
        _active(state, now) {
            const risks=[...state.riskKeys].map(key=>this.risks.get(key)).filter(Boolean);
            const active=risks.filter(risk=>activeStates.has(risk.state));
            const retained=risks.filter(risk=>risk.state==='CLEARED'&&now-Date.parse(risk.updatedTime||risk.createdTime)<=this.configuration.clearedRiskRetentionMs);
            const conditions=[...state.conditionIds].map(id=>this.conditions.get(id)).filter(item=>item&&Date.parse(item.validUntil)>now);
            state.conditionIds=new Set(conditions.map(item=>item.conditionId));return {active,retained,conditions};
        }
        _band(score) { return Object.entries(this.configuration.bands).find(([,range])=>score>=range[0]&&score<=range[1])?.[0]||'CRITICAL'; }
        _minimumScore(band) { return this.configuration.bands[band][0]; }
        _actions(band,override) { return [...new Set(override?.actions||this.configuration.actionsByBand[band]||[])]; }
        reevaluate(targetId, explicitKey=null) {
            const keys=explicitKey?[explicitKey]:[...(this.targetKeys.get(targetId)||[])];if(!keys.length)return null;const results=[];
            keys.forEach(key=>{const state=this.contexts.get(key);if(!state)return;const now=this.now(),data=this._active(state,now);const riskTypes=new Set(data.active.map(r=>r.eventType)),conditionTypes=new Set(data.conditions.filter(c=>c.value!==false).map(c=>c.conditionType));
                const baseScores={};data.active.forEach(r=>{const score=this.configuration.baseScores[r.eventType];if(Number.isFinite(score))baseScores[r.eventType]=Math.max(baseScores[r.eventType]||0,score);});
                let score=Math.max(0,...Object.values(baseScores)),contextMultiplier=1;const modifiers={};Object.entries(this.configuration.conditionMultipliers).forEach(([type,multiplier])=>{if(conditionTypes.has(type)){modifiers[type]=multiplier;contextMultiplier*=multiplier;}});contextMultiplier=Math.min(contextMultiplier,1.5);score*=contextMultiplier;
                const synergyRules=[];let synergyBonus=0;this.configuration.synergyRules.forEach(rule=>{if(hasAll(riskTypes,rule.risks)&&hasAll(conditionTypes,rule.conditions)){synergyRules.push(rule.id);synergyBonus+=rule.bonus;score=Math.max(score+rule.bonus,this._minimumScore(rule.minimumBand));}});
                const acknowledged=data.active.some(r=>r.state==='ACKNOWLEDGED')||conditionTypes.has('DRIVER_ACKNOWLEDGED');const recoveryModifier=acknowledged?this.configuration.recoveryModifier.DRIVER_ACKNOWLEDGED:0;score-=recoveryModifier;
                const override=this.configuration.overrideRules.find(rule=>hasAll(riskTypes,rule.risks)&&hasAll(conditionTypes,rule.conditions))||null;if(override)score=Math.max(score,override.score);score=Math.max(0,Math.min(100,Math.round(score)));
                const band=this._band(score),dominant=Object.entries(baseScores).sort((a,b)=>b[1]-a[1])[0]?.[0]||null;const reasonCodes=[...riskTypes].map(type=>`RISK_${type}`);synergyRules.forEach(id=>reasonCodes.push(id));if(override)reasonCodes.push(override.id);Object.keys(modifiers).forEach(type=>reasonCodes.push(`CONTEXT_${type}`));if(acknowledged)reasonCodes.push('ACKNOWLEDGED_RISK_RETAINED');
                const previous=this.composites.get(key),activeCount=data.active.length;let compositeState=activeCount===0?'CLEARED':(previous?(previous.state==='ACKNOWLEDGED'?'ACKNOWLEDGED':'ACTIVE'):'NEW');
                state.compositeSequence+=1;const compositeId=previous?.compositeRiskId||`composite-risk-${safeId(state.contextId)}`;const actions=this._actions(band,override),policy=override?.policy||(actions[0]||'NO_ACTION');
                const composite=new CompositeRisk({compositeRiskId:compositeId,contextId:state.contextId,targetId:state.identity.targetId,createdAt:previous?.createdAt||iso(now),updatedAt:iso(now),contributingRiskEventIds:data.active.map(r=>r.eventId),contributingRiskTypes:[...riskTypes],contributingConditions:data.conditions.map(c=>c.toJSON()),baseScores,modifiers:{...modifiers,contextMultiplier,recoveryModifier},synergyRules,overrideRules:override?[{overrideRuleId:override.id,reasonCode:override.id,sourceRisks:override.risks,sourceConditions:override.conditions,selectedPolicy:override.policy,suppressedLowerPolicies:true}]:[],priorityScore:score,priorityBand:band,severity:band,dominantRiskType:dominant,reasonCodes,recommendedPolicy:policy,recommendedActions:actions,state:compositeState,acknowledged:compositeState==='ACKNOWLEDGED',cleared:compositeState==='CLEARED',configurationVersion:this.configuration.configurationVersion,simulation:data.active.every(r=>r.simulation!==false)&&data.conditions.every(c=>c.simulation),operationalUseAllowed:false});this.composites.set(key,composite);
                const decision=new PriorityDecision({priorityDecisionId:`priority-decision-${safeId(state.contextId)}-${state.compositeSequence}`,compositeRiskId:composite.compositeRiskId,targetId:state.identity.targetId,createdAt:iso(now),priorityScore:score,priorityBand:band,selectedPolicy:policy,recommendedActions:actions,reasonCodes,configurationVersion:this.configuration.configurationVersion,simulation:true});this.decisions.set(key,decision);
                if(activeCount===0&&now-Date.parse(state.updatedAt)>=this.configuration.staleContextMs){state.status='CLOSED';this._audit('CONTEXT_CLOSED',state,{},[],['STALE_CONTEXT']);}
                const context=this._buildContext(state,data,composite);const actionResult=this._requestActions(state,context,composite,decision);this.lineage.record(context.toJSON(),composite.toJSON(),decision.toJSON(),data.active,data.conditions.map(c=>c.toJSON()),actionResult.actions,actionResult.executions);
                this._audit('CONTEXT_REEVALUATED',state,{score,band,compositeState},data.active.map(r=>r.eventId),reasonCodes);if(!previous||previous.priorityScore!==score||previous.state!==compositeState)this._audit('COMPOSITE_RISK_CHANGED',state,{before:previous?.toJSON?.()||null,after:composite.toJSON()},data.active.map(r=>r.eventId),reasonCodes);
                if(!previous||previous.priorityScore!==score||previous.priorityBand!==band)this._audit('PRIORITY_CHANGED',state,{before:previous?{score:previous.priorityScore,band:previous.priorityBand}:null,after:{score,band}},data.active.map(r=>r.eventId),reasonCodes);
                if(override)this._audit('OVERRIDE_SELECTED',state,{overrideRuleId:override.id,selectedPolicy:policy,suppressedLowerPolicies:true},data.active.map(r=>r.eventId),[override.id]);
                this._audit('POLICY_SELECTED',state,{selectedPolicy:policy,recommendedActions:actions},data.active.map(r=>r.eventId),reasonCodes);
                if(compositeState==='CLEARED'&&previous?.state!=='CLEARED')this._audit('CONTEXT_CLEARED',state,{compositeRiskId:composite.compositeRiskId},data.retained.map(r=>r.eventId),['NO_ACTIVE_UNDERLYING_RISK']);
                results.push({context:context.toJSON(),compositeRisk:composite.toJSON(),priorityDecision:decision.toJSON(),actionRequests:actionResult.actions,actionExecutions:actionResult.executions,lineage:this.lineage.toJSON()});});
            return clone(results.length===1?results[0]:results);
        }
        _buildContext(state,data,composite) { const now=this.now(),id=state.identity;return new OperationalContext({contextId:state.contextId,contextVersion:this.configuration.contextVersion,createdAt:state.createdAt,updatedAt:iso(now),windowStart:iso(now-this.configuration.contextWindowMs),windowEnd:iso(now),...id,activeRiskEventIds:data.active.map(r=>r.eventId),activeRiskTypes:[...new Set(data.active.map(r=>r.eventType))],observations:[],conditions:data.conditions.map(c=>c.toJSON()),compositeRiskId:composite.compositeRiskId,priorityScore:composite.priorityScore,priorityBand:composite.priorityBand,status:state.status,source:'runtime-fusion',simulation:composite.simulation,operationalUseAllowed:false}); }
        _requestActions(state,context,composite,decision) { const signature=composite.state==='CLEARED'?'CLEARED':`${decision.selectedPolicy}|${decision.recommendedActions.join(',')}`;if(this.actionSignatures.get(state.key)===signature)return {actions:[],executions:[]};this.actionSignatures.set(state.key,signature);if(composite.state==='CLEARED')return {actions:[],executions:[]};const actions=decision.recommendedActions.map((actionType,index)=>({actionId:`fusion-action-${safeId(state.contextId)}-${state.compositeSequence}-${index+1}`,actionType,policyType:'MULTI_HAZARD_COMPOSITE',targetId:state.identity.targetId,sourceEventId:composite.compositeRiskId,sourceDecisionId:decision.priorityDecisionId,sourceEventType:'MULTI_HAZARD_COMPOSITE',sourceEventState:composite.state,severity:composite.severity,priority:global.DriverPolicyConfig?.actionPriority?.[actionType]||1000+composite.priorityScore,state:'REQUESTED',createdTime:decision.createdAt,updatedTime:decision.createdAt,simulation:true,operationalUseAllowed:false,metadata:{policyReasonCodes:composite.reasonCodes,configurationVersion:this.configuration.configurationVersion}}));const executions=actions.map(action=>{if(this.actionSink){try{return clone(this.actionSink(action,context.toJSON()));}catch(error){this._audit('ACTION_REQUEST_FAILED',state,{error:error.message},[action.actionId],['FUSION_FAILURE_ISOLATED']);}}return {executionId:`fusion-execution-${action.actionId}`,actionId:action.actionId,sourceDecisionId:action.sourceDecisionId,sourceEventId:action.sourceEventId,targetId:action.targetId,actionType:action.actionType,state:'SIMULATED',result:'SIMULATION_ACCEPTED',requestedTime:action.createdTime,completedTime:action.createdTime,simulation:true,actuatorConnected:false,operationalUseAllowed:false};});if(actions.length)this._audit('ACTION_REQUESTED',state,{actions:actions.map(a=>a.actionType)},actions.map(a=>a.actionId),composite.reasonCodes);return {actions,executions}; }
        _schedule(state,delay=this.configuration.fusionReevaluationMs) { if(!this.scheduler)return;const previous=this.timers.get(state.key)||{generation:0,handle:null};if(previous.handle!=null&&this.canceller)this.canceller(previous.handle);const generation=previous.generation+1;const timer={generation,handle:null};timer.handle=this.scheduler(()=>{const current=this.timers.get(state.key);if(!current||current.generation!==generation)return;current.handle=null;this.reevaluate(state.identity.targetId,state.key);this._scheduleBoundary(state);},Math.max(0,delay));this.timers.set(state.key,timer); }
        _scheduleBoundary(state) { if(state.status==='CLOSED')return;const now=this.now(),data=this._active(state,now),deadlines=data.conditions.map(item=>Date.parse(item.validUntil));if(data.active.length===0)deadlines.push(Date.parse(state.updatedAt)+this.configuration.staleContextMs);const next=Math.min(...deadlines.filter(value=>value>now));if(Number.isFinite(next))this._schedule(state,next-now+1); }
        acknowledgeCompositeRisk(id) { const entry=[...this.composites.entries()].find(([,item])=>item.compositeRiskId===id);if(!entry)return null;const [key,item]=entry;if(item.state==='CLEARED')return item.toJSON();const state=this.contexts.get(key);const updated=new CompositeRisk({...item.toJSON(),updatedAt:iso(this.now()),state:'ACKNOWLEDGED',acknowledged:true});this.composites.set(key,updated);this._audit('ACK',state,{compositeRiskId:id},item.contributingRiskEventIds,['ACK_DOES_NOT_CLEAR']);return updated.toJSON(); }
        resetTarget(targetId) { const keys=[...(this.targetKeys.get(targetId)||[])];keys.forEach(key=>{const timer=this.timers.get(key);if(timer){if(timer.handle!=null&&this.canceller)this.canceller(timer.handle);timer.generation+=1;}this.contexts.delete(key);this.composites.delete(key);this.decisions.delete(key);this.actionSignatures.delete(key);});this.targetKeys.delete(targetId);return {targetId,resetContextCount:keys.length}; }
        getOperationalContext(targetId) { const key=[...(this.targetKeys.get(targetId)||[])][0],state=this.contexts.get(key);if(!state)return null;const composite=this.composites.get(key);return composite?this._buildContext(state,this._active(state,this.now()),composite).toJSON():null; }
        getCompositeRisk(targetId) { const key=[...(this.targetKeys.get(targetId)||[])][0];return clone(this.composites.get(key)?.toJSON?.()||null); }
        getActiveContexts() { return [...this.contexts.values()].filter(s=>s.status!=='CLOSED').map(s=>this.getOperationalContext(s.identity.targetId)).filter(Boolean); }
        getAuditHistory(targetId=null) { return clone(this.audit.filter(item=>!targetId||item.targetId===targetId)); }
        getLineage() { return this.lineage.toJSON(); }
        exportLineageTTL() { const iri=value=>`<urn:fusion:${encodeURIComponent(String(value))}>`,literal=value=>`"${(typeof value==='string'?value:JSON.stringify(value)).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')}"`;return this.getLineage().triples.map(item=>`${iri(item.subject)} <urn:fusion-predicate:${encodeURIComponent(item.predicate)}> ${item.objectType==='IRI'?iri(item.object):literal(item.object)} .`).join('\n'); }
        exportContextJSON(targetId) { const context=this.getOperationalContext(targetId);return JSON.stringify({context,compositeRisk:this.getCompositeRisk(targetId),audit:this.getAuditHistory(targetId),lineage:this.getLineage()},null,2); }
        _audit(eventType,state,change,sourceIds,reasonCodes) { this.audit.push({auditId:`fusion-audit-${this.audit.length+1}`,timestamp:iso(this.now()),targetId:state.identity.targetId,contextId:state.contextId,eventType,before:change.before||null,after:change.after||clone(change),reasonCodes:clone(reasonCodes||[]),sourceIds:clone(sourceIds||[]),configurationVersion:this.configuration.configurationVersion}); }
    }

    const engine=new FusionEngine();
    global.MultiHazardFusionEngine=Object.freeze({ FusionEngine, FusionLineage, engine,
        ingestRiskEvent:event=>engine.ingestRiskEvent(event),ingestCondition:condition=>engine.ingestCondition(condition),removeCondition:id=>engine.removeCondition(id),reevaluate:id=>engine.reevaluate(id),getOperationalContext:id=>engine.getOperationalContext(id),getCompositeRisk:id=>engine.getCompositeRisk(id),getActiveContexts:()=>engine.getActiveContexts(),getAuditHistory:id=>engine.getAuditHistory(id),acknowledgeCompositeRisk:id=>engine.acknowledgeCompositeRisk(id),resetTarget:id=>engine.resetTarget(id),exportContextJSON:id=>engine.exportContextJSON(id),exportLineageTTL:()=>engine.exportLineageTTL(),getLineage:()=>engine.getLineage() });
})(window);
