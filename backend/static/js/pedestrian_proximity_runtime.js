(function definePedestrianProximity(global) {
    'use strict';
    if (!global.SafetyObservation || !global.DriverState) throw new Error('PedestrianProximity requires SafetyObservation and DriverState');
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const directions = Object.freeze(['FRONT','FRONT_LEFT','LEFT','REAR_LEFT','REAR','REAR_RIGHT','RIGHT','FRONT_RIGHT','UNKNOWN']);
    const motions = Object.freeze(['STATIC','MOVING_TOWARD','MOVING_AWAY','UNKNOWN']);
    const required = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`); return value.trim(); };
    const finite = (value, name, { nullable=false, minimum=-Infinity }={}) => {
        if (nullable && value === null) return null;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new RangeError(`${name} must be ${nullable?'null or ':''}a finite number >= ${minimum}`);
        return value;
    };
    class PedestrianObservation {
        constructor(input) {
            if (!input || typeof input !== 'object') throw new TypeError('PedestrianObservation input is required');
            this.observationType='PEDESTRIAN_PROXIMITY'; this.targetId=required(input.targetId,'targetId'); this.pedestrianId=required(input.pedestrianId,'pedestrianId');
            this.timestamp=new Date(input.timestamp).toISOString(); this.distanceMeters=finite(input.distanceMeters,'distanceMeters',{nullable:true,minimum:0});
            this.direction=directions.includes(input.direction)?input.direction:'UNKNOWN'; this.motion=motions.includes(input.motion)?input.motion:'UNKNOWN';
            this.closingSpeed=finite(input.closingSpeed,'closingSpeed',{nullable:true}); this.detectionConfidence=input.detectionConfidence===null?null:finite(input.detectionConfidence,'detectionConfidence',{minimum:0});
            if(this.detectionConfidence!==null&&this.detectionConfidence>1)throw new RangeError('detectionConfidence must be <= 1');
            this.sensorId=required(input.sensorId,'sensorId'); this.simulation=input.simulation!==false; this.operationalUseAllowed=false; Object.freeze(this);
        }
        toJSON(){return clone({...this});}
    }
    class DetectorInterface { async start(){throw new Error('DetectorInterface.start must be implemented');} async stop(){throw new Error('DetectorInterface.stop must be implemented');} subscribe(){throw new Error('DetectorInterface.subscribe must be implemented');} }
    class PedestrianDetectionAdapter {
        constructor({detector,onObservation=()=>{}}={}){if(!detector||typeof detector.start!=='function'||typeof detector.stop!=='function'||typeof detector.subscribe!=='function')throw new TypeError('Detector interface requires start, stop, and subscribe');this.detector=detector;this.onObservation=onObservation;this.running=false;this.generation=0;this.unsubscribe=null;}
        async start(context){if(this.running)return false;const generation=++this.generation;this.unsubscribe=this.detector.subscribe(value=>{if(this.running&&generation===this.generation)this.onObservation(new PedestrianObservation({...value,...context}));});await this.detector.start();if(generation!==this.generation)return false;this.running=true;return true;}
        async stop(){this.running=false;this.generation++;if(typeof this.unsubscribe==='function')this.unsubscribe();this.unsubscribe=null;await this.detector.stop();return true;}
    }
    class Runtime {
        constructor({identityRegistry=global.RuntimeIdentityRegistry?.registry,runtimePage=global.DriverRuntimePage,confidenceEngine=global.RuntimeConfidencePage?.engine||new global.RuntimeConfidenceEngine.Engine(),now=()=>Date.now()}={}) {
            if(!identityRegistry||!runtimePage?.ingestObservation)throw new TypeError('Identity registry and Runtime facade are required');
            this.identityRegistry=identityRegistry;this.runtimePage=runtimePage;this.confidenceEngine=confidenceEngine;this.now=now;this.sequence=0;this.lastByTarget=new Map();
        }
        processDetection(input) {
            const pedestrian=input instanceof PedestrianObservation?input:new PedestrianObservation(input),identity=this.identityRegistry.lookupCanonicalTarget(pedestrian.targetId);
            if(!identity)throw new Error('CANONICAL_IDENTITY_REQUIRED');
            const runtimeTarget=new global.DriverState.VehicleContext(identity).targetId,available=pedestrian.distanceMeters!==null&&pedestrian.detectionConfidence!==null;
            this.sequence++;
            const observation=new global.SafetyObservation.SensorObservation({
                observationId:`pedestrian-proximity-${this.sequence}-${Date.parse(pedestrian.timestamp)}`,observationType:'PEDESTRIAN_PROXIMITY',sensorId:pedestrian.sensorId,targetId:runtimeTarget,
                value:{pedestrianId:pedestrian.pedestrianId,distanceMeters:pedestrian.distanceMeters,direction:pedestrian.direction,motion:pedestrian.motion,closingSpeed:pedestrian.closingSpeed},unit:'meters',confidence:pedestrian.detectionConfidence,observedAt:pedestrian.timestamp,
                metadata:{vehicleId:identity.vehicleId,vehicleType:identity.vehicleType,driverId:identity.driverId,driverAssignmentId:identity.driverAssignmentId,canonicalTargetId:identity.canonicalTargetId,identityId:identity.identityId,source:'pedestrian-detector-interface',sensorConnected:true,simulation:pedestrian.simulation,operationalUseAllowed:false,quality:{confidenceAvailable:pedestrian.detectionConfidence!==null,measurementAvailable:available,distanceAvailable:pedestrian.distanceMeters!==null},privacy:{imageStored:false,frameStored:false,boundingBoxStored:false,networkTransmission:false}}
            });
            const runtimeResult=this.runtimePage.ingestObservation(observation),risk=runtimeResult.riskEvent||{compositeRiskId:`pedestrian-confidence-${observation.observationId}`,priorityScore:runtimeResult.riskSignal.shouldCreateRisk?75:20,priorityBand:runtimeResult.riskSignal.shouldCreateRisk?'HIGH':'CAUTION',recommendedActions:[]};
            const confidence=this.confidenceEngine.evaluate({operationalContext:{contextId:`pedestrian-context-${observation.observationId}`,canonicalTargetId:identity.canonicalTargetId,targetId:runtimeTarget,driverAssignmentId:identity.driverAssignmentId,updatedAt:observation.observedAt},compositeRisk:{...risk,compositeRiskId:risk.compositeRiskId||risk.eventId,recommendedActions:risk.recommendedActions||[]},canonicalIdentity:identity,identityConflicts:this.identityRegistry.getConflicts(),observations:[observation.toJSON()],sensorStates:[{status:available?'ONLINE':'DEGRADED',sensorConnected:true}],evidence:{measurement:available?{distanceValid:true,trackingStable:pedestrian.motion!=='UNKNOWN'}:{measurementUnavailable:true},sampleAgeMs:Math.max(0,this.now()-Date.parse(observation.observedAt)),context:{requiredEvidence:['PEDESTRIAN_DETECTION','DISTANCE','CANONICAL_IDENTITY'],availableEvidence:['PEDESTRIAN_DETECTION',...(pedestrian.distanceMeters!==null?['DISTANCE']:[]),'CANONICAL_IDENTITY']},agreement:{agreementStatus:'SINGLE_SOURCE'}}});
            const result={pedestrianObservation:pedestrian.toJSON(),sensorObservation:observation.toJSON(),runtimeResult,confidence};this.lastByTarget.set(identity.canonicalTargetId,clone(result));return clone(result);
        }
        getLast(targetId){return clone(this.lastByTarget.get(targetId)||null);}
        reset(targetId){this.lastByTarget.delete(targetId);global.DriverRiskRuntime.resetPedestrianProximityRiskState(new global.DriverState.VehicleContext(this.identityRegistry.lookupCanonicalTarget(targetId)).targetId);}
    }
    global.PedestrianProximity=Object.freeze({Direction:directions,Motion:motions,PedestrianObservation,DetectorInterface,PedestrianDetectionAdapter,Runtime});
})(window);
