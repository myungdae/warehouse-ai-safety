(function (global) {
    'use strict';
    const Status = Object.freeze(['OPEN', 'MITIGATED', 'VERIFIED', 'FIELD_VALIDATION_REQUIRED', 'NOT_APPLICABLE']);
    const OverallStatus = Object.freeze(['NO_GO', 'CONTROLLED_VALIDATION_GO', 'LIMITED_PILOT_CANDIDATE', 'COMMERCIAL_GO_CANDIDATE']);
    const hazards = Object.freeze(['DROWSINESS', 'LONG_EYE_CLOSURE', 'INCAPACITATION', 'DRIVER_DISTRACTION', 'ALCOHOL', 'PEDESTRIAN_PROXIMITY', 'VEHICLE_PROXIMITY', 'RIGHT_TURN_CONTEXT', 'LOW_TTC', 'HARD_BRAKING', 'COLLISION_RISK']);
    const retention = Object.freeze({
        RISK_HISTORY: { maximumEntries: 512, maximumAgeMs: 86400000 },
        CONFIDENCE_AUDIT: { maximumEntries: 512, maximumAgeMs: 86400000 },
        IDENTITY_AUDIT: { maximumEntries: 512, maximumAgeMs: 86400000 },
        VOICE_HISTORY: { maximumEntries: 256, maximumAgeMs: 21600000 },
        PLAYBACK_HISTORY: { maximumEntries: 256, maximumAgeMs: 21600000 },
        SCENARIO_HISTORY: { maximumEntries: 256, maximumAgeMs: 21600000 },
        MEMORY_AUDIT: { maximumEntries: 1024, maximumAgeMs: 86400000 },
        COMPANION_HISTORY: { maximumEntries: 512, maximumAgeMs: 86400000 },
        REPLAY_ARTIFACTS: { maximumEntries: 2048, maximumAgeMs: 86400000 },
        EDGE_HARDWARE_HISTORY: { maximumEntries: 1024, maximumAgeMs: 86400000 }
    });
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    class ProductizationGateResult {
        constructor(input) { Object.assign(this, clone(input)); this.schemaVersion = '1.0.0'; this.simulation = true; this.operationalUseAllowed = false; Object.freeze(this); }
        toJSON() { return clone({ ...this }); }
    }
    class StabilizationRuntime {
        constructor({ now = () => Date.now() } = {}) { this.now = now; this.sequence = 0; this.lineage = []; this.lastResult = null; }
        createLineage(input = {}) {
            const target = input.canonicalTargetId || 'stabilization-target', assignment = input.assignmentId || 'stabilization-assignment', at = new Date(this.now()).toISOString();
            const stages = [
                ['SensorEvidence', input.sensorEvidenceId || 'C922-evidence', 'GENERATED'], ['Observation', input.observationId || 'attention-observation', 'DERIVED_FROM'],
                ['RiskEvent', input.riskEventId || 'driver-distraction-risk', 'ACTIVATED'], ['OperationalContext', input.contextId || 'right-turn-pedestrian-context', 'CONTRIBUTED_TO'],
                ['CompositeRisk', input.compositeRiskId || 'urgent-composite-risk', 'EVALUATED_BY'], ['DriverCompanionDecision', input.decisionId || 'urgent-companion-decision', 'PRODUCED'],
                ['DriverRecommendation', input.recommendation || 'STOP_TURN_AND_CHECK', 'SELECTED'], ['VoiceInteractionDecision', input.voiceDecisionId || 'right-turn-pedestrian-warning', 'DELIVERED_BY'],
                ['PlaybackResult', input.playbackId || 'local-wav-playback', 'ACKNOWLEDGED_BY'], ['DriverAcknowledgement', input.acknowledgementId || 'physical-ack', null]
            ];
            const nodes = stages.map(([nodeType, nodeId]) => ({ nodeId, nodeType, canonicalTargetId: target, assignmentId: assignment, timestamp: at, operationalUseAllowed: false }));
            const edges = stages.slice(0, -1).map((stage, index) => ({ from: stage[1], relation: stage[2], to: stages[index + 1][1] }));
            this.lineage = [{ lineageId: `stabilization-lineage-${++this.sequence}`, nodes, edges, resetBy: null, simulation: true, operationalUseAllowed: false }]; return clone(this.lineage[0]);
        }
        markReset(resetId) { if (this.lineage[0]) this.lineage[0].resetBy = resetId; return clone(this.lineage[0] || null); }
        evaluate(evidence = {}) {
            const values = { hazardActivationConsistency: evidence.hazardActivationConsistency || 'MITIGATED', ackExpiryLifecycle: evidence.ackExpiryLifecycle || 'MITIGATED',
                voicePreemptionSafety: evidence.voicePreemptionSafety || 'MITIGATED', policyVocabularyConsistency: evidence.policyVocabularyConsistency || 'MITIGATED',
                runtimeStateBoundedness: evidence.runtimeStateBoundedness || 'MITIGATED', resetIsolation: evidence.resetIsolation || 'MITIGATED',
                operationalChainCoverage: evidence.operationalChainCoverage || 'MITIGATED' };
            Object.values(values).forEach(value => { if (!Status.includes(value)) throw new RangeError(`Invalid gate status: ${value}`); });
            const blockers = Object.entries(values).filter(([, value]) => value === 'OPEN').map(([key]) => key), field = Object.entries(values).filter(([, value]) => value === 'FIELD_VALIDATION_REQUIRED').map(([key]) => key);
            const allVerified = Object.values(values).every(value => value === 'VERIFIED' || value === 'NOT_APPLICABLE');
            const overallStatus = blockers.length ? 'NO_GO' : allVerified ? 'LIMITED_PILOT_CANDIDATE' : 'CONTROLLED_VALIDATION_GO';
            this.lastResult = new ProductizationGateResult({ gateId: `productization-gate-${++this.sequence}`, evaluatedAt: new Date(this.now()).toISOString(), ...values, overallStatus, blockers,
                mitigations: evidence.mitigations || [], verifiedEvidence: evidence.verifiedEvidence || [], fieldValidationRequired: [...new Set([...field, ...(evidence.fieldValidationRequired || ['CAMERA_HARDWARE', 'EDGE_AUDIO_HARDWARE', 'ALCOHOL_SENSOR', 'RADAR_LIDAR'])])],
                reviewDocumentVersion: 'DRIVER_COMPANION_V1_PRODUCTIZATION_REVIEW-v1', productMaturity: 68 });
            return this.lastResult.toJSON();
        }
        exportJSON() { return JSON.stringify({ gate: this.lastResult?.toJSON() || null, lineage: clone(this.lineage), simulation: true, operationalUseAllowed: false }, null, 2); }
    }
    global.DriverStabilizationConfig = Object.freeze({
        schemaVersion: '1.0.0', policyVersion: 'DEVELOPMENT_CANDIDATE_STABILIZATION-v1', reviewDocumentVersion: 'DRIVER_COMPANION_V1_PRODUCTIZATION_REVIEW-v1',
        Status, OverallStatus, hazards, retention, ProductizationGateResult, StabilizationRuntime, productMaturity: 68, simulation: true, operationalUseAllowed: false
    });
}(window));
