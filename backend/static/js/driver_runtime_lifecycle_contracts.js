(function (global) {
    'use strict';
    const HazardLifecycle = Object.freeze(['INACTIVE', 'ENTRY_PENDING', 'NEW', 'ACTIVE', 'ACKNOWLEDGED', 'CLEAR_PENDING', 'CLEARED', 'EXPIRED', 'INVALID', 'UNKNOWN']);
    const AcknowledgementState = Object.freeze(['NOT_ACKNOWLEDGED', 'ACKNOWLEDGED', 'ACK_SUPPRESSED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED']);
    const transitions = Object.freeze({
        INACTIVE: ['ENTRY_PENDING', 'NEW', 'INVALID', 'UNKNOWN'], ENTRY_PENDING: ['NEW', 'INACTIVE', 'INVALID', 'UNKNOWN'], NEW: ['ACTIVE', 'ACKNOWLEDGED', 'CLEAR_PENDING', 'EXPIRED', 'INVALID'],
        ACTIVE: ['ACKNOWLEDGED', 'CLEAR_PENDING', 'EXPIRED', 'INVALID'], ACKNOWLEDGED: ['ACTIVE', 'CLEAR_PENDING', 'EXPIRED', 'INVALID'], CLEAR_PENDING: ['CLEARED', 'ACTIVE', 'ACKNOWLEDGED', 'INVALID'],
        CLEARED: ['ENTRY_PENDING', 'NEW'], EXPIRED: ['ENTRY_PENDING', 'NEW'], INVALID: ['INACTIVE', 'ENTRY_PENDING'], UNKNOWN: ['INACTIVE', 'ENTRY_PENDING', 'INVALID']
    });
    const contracts = Object.freeze({
        DROWSINESS: [1500, 2000], LONG_EYE_CLOSURE: [600, 500], INCAPACITATION: [1500, 1500], DRIVER_DISTRACTION: [1500, 1000], ALCOHOL: [0, 0],
        PEDESTRIAN_PROXIMITY: [150, 500], VEHICLE_PROXIMITY: [150, 500], RIGHT_TURN_CONTEXT: [0, 250], LOW_TTC: [0, 500], HARD_BRAKING: [150, 500], COLLISION_RISK: [0, 500]
    });
    const matrix = Object.freeze(Object.fromEntries(Object.entries(contracts).map(([hazardType, sustain]) => [hazardType, Object.freeze({
        hazardType, entryCondition: 'VALID_QUALIFIED_EVIDENCE', entrySustainMs: sustain[0], activeState: 'ACTIVE', ackBehavior: 'ACKNOWLEDGES_ONLY_DOES_NOT_CLEAR',
        clearCondition: 'VALID_CLEAR_EVIDENCE', clearSustainMs: sustain[1], qualityLossBehavior: 'INVALID_NOT_CLEAR', staleBehavior: 'UNKNOWN_NOT_SAFE',
        duplicateBehavior: 'IDEMPOTENT_BY_OBSERVATION_ID', recurrenceBehavior: 'NEW_EPISODE_ID_AFTER_CLEARED_OR_EXPIRED', contractStatus: hazardType === 'ALCOHOL' ? 'FIELD_VALIDATION_REQUIRED' : 'MITIGATED'
    })])));
    class Acknowledgement {
        constructor(input) {
            if (!input?.ownerArtifactId || !input?.source || !input?.timestamp) throw new TypeError('ACK owner, source, and timestamp are required');
            Object.assign(this, { acknowledgementId: input.acknowledgementId || `ack-${input.ownerArtifactId}-${Date.parse(input.timestamp)}`, ownerArtifactId: input.ownerArtifactId,
                ownerType: input.ownerType || 'UNKNOWN', canonicalTargetId: input.canonicalTargetId || null, assignmentId: input.assignmentId || null, source: input.source,
                timestamp: new Date(input.timestamp).toISOString(), state: 'ACKNOWLEDGED', riskCleared: false, trendCleared: false, confidenceChanged: false,
                behaviorCompleted: false, actualStopConfirmed: false, automaticEmergencyCall: false, simulation: true, operationalUseAllowed: false });
            Object.freeze(this);
        }
        toJSON() { return JSON.parse(JSON.stringify(this)); }
    }
    const canTransition = (from, to) => Boolean(transitions[from]?.includes(to));
    const isActive = value => value === 'NEW' || value === 'ACTIVE' || value === 'ACKNOWLEDGED' || value === 'CLEAR_PENDING';
    global.DriverRuntimeLifecycleContracts = Object.freeze({ HazardLifecycle, AcknowledgementState, transitions, hazardContractMatrix: matrix, Acknowledgement, canTransition, isActive });
}(window));
