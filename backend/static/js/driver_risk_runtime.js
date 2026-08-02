(function initializeDriverRiskRuntime(global) {
    'use strict';

    if (!global.SafetyObservation || !global.DriverStateConfig) {
        throw new Error('DriverRiskRuntime requires SafetyObservation and DriverStateConfig');
    }

    const { ObservationType, SensorObservation } = global.SafetyObservation;
    const EventState = Object.freeze({
        NEW: 'NEW',
        ACTIVE: 'ACTIVE',
        ACKNOWLEDGED: 'ACKNOWLEDGED',
        CLEARED: 'CLEARED'
    });
    const drowsinessRiskStates = new Map();
    const liveDrowsinessRiskStates = new Map();
    const incapacitationRiskStates = new Map();
    const alcoholRiskStates = new Map();
    const INCAPACITATION_COMPOSITE_SIGNALS = Object.freeze([
        'prolongedEyeClosure',
        'headDrop',
        'upperBodyCollapse',
        'noResponse',
        'noVehicleControlInput'
    ]);

    class RiskEvent {
        constructor({ eventId, eventType, targetId, severity, timestamp }) {
            this.eventId = eventId;
            this.eventType = eventType;
            this.targetId = targetId;
            this.createdTime = timestamp;
            this.updatedTime = timestamp;
            this.state = EventState.NEW;
            this.severity = severity;
            this.acknowledgedTime = null;
            this.clearedTime = null;
        }

        toJSON() {
            return {
                eventId: this.eventId,
                eventType: this.eventType,
                targetId: this.targetId,
                createdTime: this.createdTime,
                updatedTime: this.updatedTime,
                state: this.state,
                severity: this.severity,
                acknowledgedTime: this.acknowledgedTime,
                clearedTime: this.clearedTime
            };
        }
    }

    class RiskEventStateMachine {
        constructor() {
            this.activeEvents = new Map();
            this.eventHistory = [];
            this.sequence = 0;
        }

        getEventKey(eventType, targetId) {
            return `${eventType}::${targetId}`;
        }

        observe({ eventType, targetId, severity }, observedAt) {
            const timestamp = new Date(observedAt).toISOString();
            const key = this.getEventKey(eventType, targetId);
            let event = this.activeEvents.get(key);
            if (!event) {
                this.sequence += 1;
                event = new RiskEvent({
                    eventId: `${eventType}-${targetId.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.parse(timestamp)}-${this.sequence}`,
                    eventType,
                    targetId,
                    severity,
                    timestamp
                });
                this.activeEvents.set(key, event);
                this.eventHistory.push(event);
                return event;
            }
            event.updatedTime = timestamp;
            event.severity = severity;
            if (event.state === EventState.NEW) event.state = EventState.ACTIVE;
            return event;
        }

        acknowledge(eventId, observedAt = new Date()) {
            const event = this.eventHistory.find(item => item.eventId === eventId);
            if (!event || event.state === EventState.CLEARED) return null;
            const timestamp = new Date(observedAt).toISOString();
            event.state = EventState.ACKNOWLEDGED;
            event.updatedTime = timestamp;
            event.acknowledgedTime = timestamp;
            return event;
        }

        clear(eventType, targetId, observedAt = new Date()) {
            const key = this.getEventKey(eventType, targetId);
            const event = this.activeEvents.get(key);
            if (!event) return null;
            const timestamp = new Date(observedAt).toISOString();
            event.state = EventState.CLEARED;
            event.updatedTime = timestamp;
            event.clearedTime = timestamp;
            this.activeEvents.delete(key);
            return event;
        }

        toJSON() {
            return this.eventHistory.map(event => event.toJSON());
        }
    }

    function noRisk(observation, reason) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation instanceof SensorObservation ? observation.toJSON() : null,
            reason
        };
    }

    function createDrowsinessRiskSignal(observation, reason) {
        return {
            shouldCreateRisk: true,
            shouldClearRisk: false,
            eventInput: {
                eventType: 'DROWSINESS',
                targetId: observation.targetId,
                severity: 'HIGH'
            },
            observation: observation.toJSON(),
            reason
        };
    }

    function drowsinessObservationToRiskSignal(observation) {
        if (observation.metadata?.source === 'live-webcam') {
            return liveDrowsinessObservationToRiskSignal(observation);
        }
        const rule = global.DriverStateConfig.drowsiness;
        const observedAtMs = Date.parse(observation.observedAt);
        const state = drowsinessRiskStates.get(observation.targetId) || {
            enterStartedAt: null,
            clearStartedAt: null,
            riskActive: false
        };

        if (observation.value !== rule.enterState && observation.value !== rule.clearState) {
            return noRisk(observation, 'INVALID_DROWSINESS_STATE');
        }

        if (!state.riskActive) {
            if (observation.value === rule.clearState) {
                drowsinessRiskStates.delete(observation.targetId);
                return noRisk(observation, 'DROWSINESS_NORMAL');
            }
            if (state.enterStartedAt === null || observedAtMs < state.enterStartedAt) {
                state.enterStartedAt = observedAtMs;
            }
            if (observedAtMs - state.enterStartedAt < rule.sustainMs) {
                drowsinessRiskStates.set(observation.targetId, state);
                return noRisk(observation, 'DROWSINESS_ENTRY_PENDING');
            }
            state.riskActive = true;
            state.clearStartedAt = null;
            drowsinessRiskStates.set(observation.targetId, state);
            return createDrowsinessRiskSignal(observation, 'DROWSINESS_RISK_CONFIRMED');
        }

        if (observation.value === rule.enterState) {
            state.clearStartedAt = null;
            drowsinessRiskStates.set(observation.targetId, state);
            return createDrowsinessRiskSignal(observation, 'DROWSINESS_RISK_MAINTAINED');
        }
        if (state.clearStartedAt === null || observedAtMs < state.clearStartedAt) {
            state.clearStartedAt = observedAtMs;
        }
        if (observedAtMs - state.clearStartedAt < rule.clearSustainMs) {
            drowsinessRiskStates.set(observation.targetId, state);
            return noRisk(observation, 'DROWSINESS_CLEAR_PENDING');
        }
        drowsinessRiskStates.delete(observation.targetId);
        return {
            ...noRisk(observation, 'DROWSINESS_CLEARED'),
            shouldClearRisk: true
        };
    }

    function liveDrowsinessObservationToRiskSignal(observation) {
        const config = global.DriverPerception?.Config?.liveDrowsinessConfig;
        const metadata = observation.metadata || {};
        const metrics = metadata.metrics || {};
        const quality = metadata.quality || {};
        const observedAtMs = Date.parse(observation.observedAt);
        const state = liveDrowsinessRiskStates.get(observation.targetId) || {
            enterStartedAt: null, clearStartedAt: null, riskActive: false
        };
        const evidence = [];
        if (quality.marValid !== true) evidence.push('MAR_UNAVAILABLE');
        else if (quality.mouthCalibrationAvailable !== true) evidence.push('MOUTH_CALIBRATION_UNAVAILABLE');
        else if (metrics.yawnConfirmed === true) evidence.push(metrics.yawnCount >= 2
            ? 'REPEATED_YAWN_SUPPORTING_SIGNAL' : 'YAWN_CONFIRMED_SUPPORTING_SIGNAL');
        else if (metrics.yawnCandidate === true) evidence.push('YAWN_CANDIDATE_OBSERVED');
        const withEvidence = signal => ({ ...signal, supportingEvidence: evidence });
        const qualityValid = metadata.simulation === false && metadata.sensorConnected === true &&
            quality.faceDetected === true && quality.landmarkAvailable === true &&
            quality.calibrated === true && quality.calibrationState === 'READY' &&
            quality.earValid === true && Number.isFinite(metrics.ear) &&
            Number.isFinite(metrics.earThreshold) && Number.isFinite(quality.sampleAgeMs) &&
            quality.sampleAgeMs <= config.maximumSampleAgeMs;
        if (!qualityValid) {
            liveDrowsinessRiskStates.set(observation.targetId, state);
            return withEvidence(noRisk(observation, state.riskActive
                ? 'LIVE_DROWSINESS_QUALITY_LOSS_RISK_PRESERVED'
                : 'LIVE_DROWSINESS_QUALITY_INSUFFICIENT'));
        }
        const primary = metrics.eyeClosed === true && metrics.ear < metrics.earThreshold;
        const accumulated = quality.perclosValid === true && Number.isFinite(metrics.perclos) &&
            metrics.perclos >= config.perclosEntryPercent;
        const entry = primary && (metrics.eyeClosureDurationMs >= config.prolongedEyeClosureMs || accumulated);
        if (!state.riskActive) {
            if (!entry) {
                liveDrowsinessRiskStates.delete(observation.targetId);
                return withEvidence(noRisk(observation, 'LIVE_DROWSINESS_NORMAL'));
            }
            if (state.enterStartedAt === null || observedAtMs < state.enterStartedAt) state.enterStartedAt = observedAtMs;
            if (observedAtMs - state.enterStartedAt < config.entrySustainMs) {
                liveDrowsinessRiskStates.set(observation.targetId, state);
                return withEvidence(noRisk(observation, 'LIVE_DROWSINESS_ENTRY_PENDING'));
            }
            state.riskActive = true;
            state.clearStartedAt = null;
            liveDrowsinessRiskStates.set(observation.targetId, state);
            return withEvidence(createDrowsinessRiskSignal(observation, 'LIVE_DROWSINESS_RISK_CONFIRMED'));
        }
        if (entry) {
            state.clearStartedAt = null;
            liveDrowsinessRiskStates.set(observation.targetId, state);
            return withEvidence(createDrowsinessRiskSignal(observation, 'LIVE_DROWSINESS_RISK_MAINTAINED'));
        }
        if (state.clearStartedAt === null || observedAtMs < state.clearStartedAt) state.clearStartedAt = observedAtMs;
        if (observedAtMs - state.clearStartedAt < config.clearSustainMs) {
            liveDrowsinessRiskStates.set(observation.targetId, state);
            return withEvidence(noRisk(observation, 'LIVE_DROWSINESS_CLEAR_PENDING'));
        }
        liveDrowsinessRiskStates.delete(observation.targetId);
        return withEvidence({ ...noRisk(observation, 'LIVE_DROWSINESS_CLEARED'), shouldClearRisk: true });
    }

    function createIncapacitationRiskSignal(observation, reason, compositeSignalCount) {
        return {
            shouldCreateRisk: true,
            shouldClearRisk: false,
            eventInput: {
                eventType: 'DRIVER_INCAPACITATION',
                targetId: observation.targetId,
                severity: 'CRITICAL',
                policyHint: 'COEXIST_WITH_DROWSINESS_PENDING_POLICY_ENGINE'
            },
            observation: observation.toJSON(),
            compositeSignalCount,
            reason
        };
    }

    function incapacitationObservationToRiskSignal(observation) {
        const rule = global.DriverStateConfig.incapacitation;
        const value = observation.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return noRisk(observation, 'INVALID_INCAPACITATION_COMPOSITE');
        }
        const requiredFields = [...INCAPACITATION_COMPOSITE_SIGNALS, 'vehicleMoving', 'qualityValid'];
        if (requiredFields.some(field => typeof value[field] !== 'boolean')) {
            return noRisk(observation, 'INVALID_INCAPACITATION_COMPOSITE');
        }

        const observedAtMs = Date.parse(observation.observedAt);
        const compositeSignalCount = INCAPACITATION_COMPOSITE_SIGNALS
            .filter(field => value[field]).length;
        const state = incapacitationRiskStates.get(observation.targetId) || {
            enterStartedAt: null,
            clearStartedAt: null,
            riskActive: false
        };

        if (rule.requireQualityValid && !value.qualityValid) {
            incapacitationRiskStates.set(observation.targetId, state);
            return {
                ...noRisk(observation, state.riskActive
                    ? 'INCAPACITATION_SENSOR_UNAVAILABLE_RISK_PRESERVED'
                    : 'INCAPACITATION_NO_DECISION_QUALITY_INVALID'),
                compositeSignalCount
            };
        }

        if (!state.riskActive) {
            const entryCondition = (
                (!rule.requireVehicleMoving || value.vehicleMoving) &&
                compositeSignalCount >= rule.minimumCompositeSignalCount
            );
            if (!entryCondition) {
                incapacitationRiskStates.delete(observation.targetId);
                return {
                    ...noRisk(observation, value.vehicleMoving
                        ? 'INCAPACITATION_COMPOSITE_BELOW_ENTRY'
                        : 'INCAPACITATION_VEHICLE_NOT_MOVING'),
                    compositeSignalCount
                };
            }
            if (state.enterStartedAt === null || observedAtMs < state.enterStartedAt) {
                state.enterStartedAt = observedAtMs;
            }
            if (observedAtMs - state.enterStartedAt < rule.sustainMs) {
                incapacitationRiskStates.set(observation.targetId, state);
                return {
                    ...noRisk(observation, 'INCAPACITATION_COMPOSITE_PENDING'),
                    compositeSignalCount
                };
            }
            state.riskActive = true;
            state.clearStartedAt = null;
            incapacitationRiskStates.set(observation.targetId, state);
            return createIncapacitationRiskSignal(
                observation,
                'INCAPACITATION_RISK_CONFIRMED',
                compositeSignalCount
            );
        }

        const recoveryCondition = (
            value.noResponse === false &&
            value.upperBodyCollapse === false &&
            value.headDrop === false
        );
        if (!recoveryCondition) {
            state.clearStartedAt = null;
            incapacitationRiskStates.set(observation.targetId, state);
            return createIncapacitationRiskSignal(
                observation,
                'INCAPACITATION_RISK_MAINTAINED',
                compositeSignalCount
            );
        }
        if (state.clearStartedAt === null || observedAtMs < state.clearStartedAt) {
            state.clearStartedAt = observedAtMs;
        }
        if (observedAtMs - state.clearStartedAt < rule.clearSustainMs) {
            incapacitationRiskStates.set(observation.targetId, state);
            return {
                ...noRisk(observation, 'INCAPACITATION_RECOVERY_PENDING'),
                compositeSignalCount
            };
        }
        incapacitationRiskStates.delete(observation.targetId);
        return {
            ...noRisk(observation, 'INCAPACITATION_CLEARED'),
            shouldClearRisk: true,
            compositeSignalCount
        };
    }

    function alcoholPolicySignal(observation, reason, policyDecision, policyStatus, overrides = {}) {
        return {
            ...noRisk(observation, reason),
            policyDecision,
            policyStatus,
            ...overrides
        };
    }

    function createAlcoholRiskSignal(observation, reason, policyDecision) {
        return {
            shouldCreateRisk: true,
            shouldClearRisk: false,
            eventInput: {
                eventType: 'ALCOHOL_POLICY_VIOLATION',
                targetId: observation.targetId,
                severity: 'CRITICAL'
            },
            observation: observation.toJSON(),
            policyDecision,
            policyStatus: 'POLICY_VIOLATION',
            reason
        };
    }

    function alcoholObservationToRiskSignal(observation) {
        const rule = global.DriverStateConfig.alcohol;
        const value = observation.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return alcoholPolicySignal(observation, 'INVALID_ALCOHOL_MEASUREMENT', 'NO_DECISION', 'INVALID_MEASUREMENT');
        }
        const validStatuses = ['READY', 'WARMING_UP', 'MEASURING', 'VALID', 'FAILED'];
        const validModes = ['PRE_START', 'IN_OPERATION'];
        if (!validStatuses.includes(value.measurementStatus) || !validModes.includes(value.measurementMode)) {
            return alcoholPolicySignal(observation, 'INVALID_ALCOHOL_MEASUREMENT', 'NO_DECISION', 'INVALID_MEASUREMENT');
        }

        const observedAtMs = Date.parse(observation.observedAt);
        const state = alcoholRiskStates.get(observation.targetId) || {
            enterStartedAt: null,
            clearStartedAt: null,
            riskActive: false
        };
        const preserveState = (reason, decision, status) => {
            alcoholRiskStates.set(observation.targetId, state);
            return alcoholPolicySignal(observation, reason, decision, status);
        };

        if (value.measurementStatus === 'FAILED') {
            return preserveState('ALCOHOL_MEASUREMENT_FAILED', 'RETEST', 'ALCOHOL_MEASUREMENT_FAILED');
        }
        if (['READY', 'WARMING_UP', 'MEASURING'].includes(value.measurementStatus)) {
            return preserveState(
                `ALCOHOL_${value.measurementStatus}_NO_DECISION`,
                'NO_DECISION',
                value.measurementStatus
            );
        }
        if (value.bypassSuspected === true) {
            return preserveState('ALCOHOL_TEST_BYPASS_SUSPECTED', 'NO_DECISION', 'ALCOHOL_TEST_BYPASS_SUSPECTED');
        }
        if (rule.requireIdentityVerified && value.identityVerified !== true) {
            return preserveState('DRIVER_IDENTITY_UNVERIFIED', 'NO_DECISION', 'DRIVER_IDENTITY_UNVERIFIED');
        }
        if (rule.requireCalibrationValid && value.calibrationStatus !== 'VALID') {
            return preserveState('ALCOHOL_CALIBRATION_INVALID', 'RETEST', 'CALIBRATION_INVALID');
        }
        if (!Number.isFinite(Number(value.sampleQuality)) || Number(value.sampleQuality) < rule.minimumSampleQuality) {
            return preserveState('ALCOHOL_SAMPLE_QUALITY_INSUFFICIENT', 'RETEST', 'SAMPLE_QUALITY_INSUFFICIENT');
        }
        const rawValue = Number(value.rawValue);
        if (!Number.isFinite(rawValue) || value.unit !== rule.unit) {
            return preserveState('INVALID_ALCOHOL_MEASUREMENT', 'NO_DECISION', 'INVALID_MEASUREMENT');
        }

        const violationDecision = rule.modePolicies[value.measurementMode];
        if (!state.riskActive) {
            if (rawValue < rule.entryThreshold) {
                alcoholRiskStates.delete(observation.targetId);
                return alcoholPolicySignal(observation, 'ALCOHOL_POLICY_ALLOW', 'ALLOW', 'VALID_CLEAR');
            }
            if (state.enterStartedAt === null || observedAtMs < state.enterStartedAt) {
                state.enterStartedAt = observedAtMs;
            }
            if (observedAtMs - state.enterStartedAt < rule.sustainMs) {
                alcoholRiskStates.set(observation.targetId, state);
                return alcoholPolicySignal(
                    observation,
                    'ALCOHOL_POLICY_ENTRY_PENDING',
                    violationDecision,
                    'ENTRY_PENDING'
                );
            }
            state.riskActive = true;
            state.clearStartedAt = null;
            alcoholRiskStates.set(observation.targetId, state);
            return createAlcoholRiskSignal(observation, 'ALCOHOL_POLICY_RISK_CONFIRMED', violationDecision);
        }

        if (rawValue > rule.clearThreshold) {
            state.clearStartedAt = null;
            alcoholRiskStates.set(observation.targetId, state);
            return createAlcoholRiskSignal(observation, 'ALCOHOL_POLICY_RISK_MAINTAINED', violationDecision);
        }
        if (state.clearStartedAt === null || observedAtMs < state.clearStartedAt) {
            state.clearStartedAt = observedAtMs;
        }
        if (observedAtMs - state.clearStartedAt < rule.clearSustainMs) {
            alcoholRiskStates.set(observation.targetId, state);
            return alcoholPolicySignal(observation, 'ALCOHOL_POLICY_CLEAR_PENDING', 'ALLOW', 'CLEAR_PENDING');
        }
        alcoholRiskStates.delete(observation.targetId);
        return alcoholPolicySignal(observation, 'ALCOHOL_POLICY_CLEARED', 'ALLOW', 'CLEARED', {
            shouldClearRisk: true
        });
    }

    function observationToRiskSignal(observation) {
        if (!(observation instanceof SensorObservation)) return noRisk(null, 'INVALID_OBSERVATION');
        if (observation.observationType === ObservationType.DROWSINESS) {
            return drowsinessObservationToRiskSignal(observation);
        }
        if (observation.observationType === ObservationType.INCAPACITATION) {
            return incapacitationObservationToRiskSignal(observation);
        }
        if (observation.observationType === ObservationType.ALCOHOL_LEVEL) {
            return alcoholObservationToRiskSignal(observation);
        }
        return noRisk(observation, 'NO_RISK_RULE_CONFIGURED');
    }

    function resetDrowsinessRiskState(targetId) {
        if (targetId) { drowsinessRiskStates.delete(targetId); liveDrowsinessRiskStates.delete(targetId); }
        else { drowsinessRiskStates.clear(); liveDrowsinessRiskStates.clear(); }
    }

    function resetIncapacitationRiskState(targetId) {
        if (targetId) incapacitationRiskStates.delete(targetId);
        else incapacitationRiskStates.clear();
    }

    function resetAlcoholRiskState(targetId) {
        if (targetId) alcoholRiskStates.delete(targetId);
        else alcoholRiskStates.clear();
    }

    global.DriverRiskRuntime = Object.freeze({
        EventState,
        RiskEvent,
        RiskEventStateMachine,
        observationToRiskSignal,
        resetDrowsinessRiskState,
        resetIncapacitationRiskState,
        resetAlcoholRiskState
    });
}(window));
