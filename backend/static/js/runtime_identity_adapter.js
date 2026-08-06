(function defineRuntimeIdentityAdapter(global) {
    'use strict';
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const required = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`); return value.trim(); };
    const optional = value => typeof value === 'string' && value.trim() ? value.trim() : null;
    const iso = value => { const time=Date.parse(value);if(!Number.isFinite(time))throw new TypeError('Valid identity timestamp is required');return new Date(time).toISOString(); };
    const SourceType = Object.freeze({ DRIVER_CAMERA:'DRIVER_CAMERA',ALCOHOL_SENSOR:'ALCOHOL_SENSOR',PEDESTRIAN_SENSOR:'PEDESTRIAN_SENSOR',VEHICLE_PROXIMITY:'VEHICLE_PROXIMITY',RUNTIME_FIXTURE:'RUNTIME_FIXTURE',WAREHOUSE_RUNTIME:'WAREHOUSE_RUNTIME',DRIVER_RUNTIME:'DRIVER_RUNTIME',CAN:'CAN',BLE:'BLE',RIGHT_CAMERA:'RIGHT_CAMERA',FORK_SENSOR:'FORK_SENSOR',GPS:'GPS',IMU:'IMU' });
    const ConflictType = Object.freeze({ NO_CONFLICT:'NO_CONFLICT',DUPLICATE_DRIVER:'DUPLICATE_DRIVER',DUPLICATE_ASSIGNMENT:'DUPLICATE_ASSIGNMENT',UNKNOWN_SENSOR:'UNKNOWN_SENSOR',UNKNOWN_DRIVER:'UNKNOWN_DRIVER',UNKNOWN_VEHICLE:'UNKNOWN_VEHICLE',EXPIRED_ASSIGNMENT:'EXPIRED_ASSIGNMENT' });
    const canonicalTarget = ({vehicleId,driverId,driverAssignmentId}) => [required(vehicleId,'vehicleId'),required(driverId,'driverId'),required(driverAssignmentId,'driverAssignmentId')].join('|');

    class CanonicalOperationalIdentity {
        constructor(input) {
            if(!input||typeof input!=='object')throw new TypeError('Canonical identity input is required');
            this.identityId=required(input.identityId,'identityId');this.vehicleId=required(input.vehicleId,'vehicleId');this.vehicleType=optional(input.vehicleType);
            this.driverId=required(input.driverId,'driverId');this.driverAssignmentId=required(input.driverAssignmentId,'driverAssignmentId');
            this.canonicalTargetId=canonicalTarget(this);if(input.canonicalTargetId&&input.canonicalTargetId!==this.canonicalTargetId)throw new RangeError('canonicalTargetId does not match identity fields');
            this.sensorIds=Object.freeze([...new Set(input.sensorIds||[])]);this.cameraIds=Object.freeze([...new Set(input.cameraIds||[])]);this.runtimeSources=Object.freeze([...new Set(input.runtimeSources||[])]);
            this.targetAliases=Object.freeze([...new Set(input.targetAliases||[])]);this.ownershipToken=required(input.ownershipToken,'ownershipToken');this.assignmentVersion=Number.isInteger(input.assignmentVersion)&&input.assignmentVersion>0?input.assignmentVersion:1;
            this.createdAt=iso(input.createdAt);this.updatedAt=iso(input.updatedAt);this.assignmentValidUntil=input.assignmentValidUntil?iso(input.assignmentValidUntil):null;
            this.simulation=input.simulation!==false;this.operationalUseAllowed=false;Object.freeze(this);
        }
        toJSON(){return clone({...this});}
    }

    class RuntimeIdentityAdapter {
        constructor(registry){if(!registry)throw new TypeError('Identity Registry is required');this.registry=registry;}
        adapt(input) {
            if(!input||!Object.values(SourceType).includes(input.runtimeSource))throw new TypeError('Supported runtimeSource is required');
            const full=input.vehicleId&&input.driverId&&input.driverAssignmentId;
            if(full){const canonicalTargetId=canonicalTarget(input);return this.registry.registerIdentity({...input,canonicalTargetId,runtimeSources:[...(input.runtimeSources||[]),input.runtimeSource],targetAliases:[...(input.targetAliases||[]),input.sourceTargetId].filter(Boolean)});}
            if(input.sensorId){const identity=this.registry.lookupBySensor(input.sensorId);if(identity){const updated=this.registry.attachRuntimeSource(identity.identityId,{runtimeSource:input.runtimeSource,sensorId:input.sensorId,targetAlias:input.sourceTargetId},input.ownershipToken);return{identity:updated||identity,conflict:ConflictType.NO_CONFLICT};}}
            if(input.vehicleId){const matches=this.registry.lookupByVehicle(input.vehicleId);if(matches.length===1){const identity=matches[0],updated=this.registry.attachRuntimeSource(identity.identityId,{runtimeSource:input.runtimeSource,sensorId:input.sensorId,cameraId:input.cameraId,targetAlias:input.sourceTargetId},input.ownershipToken);if(!updated)return this.registry.recordConflict(ConflictType.DUPLICATE_ASSIGNMENT,{identityId:identity.identityId,reason:'OWNERSHIP_TOKEN_MISMATCH'});return{identity:updated,conflict:ConflictType.NO_CONFLICT};}if(matches.length>1)return this.registry.recordConflict(ConflictType.DUPLICATE_ASSIGNMENT,{vehicleId:input.vehicleId,sourceTargetId:input.sourceTargetId});}
            return this.registry.recordConflict(input.sensorId?ConflictType.UNKNOWN_SENSOR:ConflictType.UNKNOWN_VEHICLE,{sensorId:input.sensorId||null,vehicleId:input.vehicleId||null,sourceTargetId:input.sourceTargetId||null});
        }
    }
    global.RuntimeIdentityAdapter=Object.freeze({SourceType,ConflictType,CanonicalOperationalIdentity,RuntimeIdentityAdapter,canonicalTarget});
})(window);
