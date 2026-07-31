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
    const incapacitationRiskStates = new Map();
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

    function observationToRiskSignal(observation) {
        if (!(observation instanceof SensorObservation)) return noRisk(null, 'INVALID_OBSERVATION');
        if (observation.observationType === ObservationType.DROWSINESS) {
            return drowsinessObservationToRiskSignal(observation);
        }
        if (observation.observationType === ObservationType.INCAPACITATION) {
            return incapacitationObservationToRiskSignal(observation);
        }
        return noRisk(observation, 'NO_RISK_RULE_CONFIGURED');
    }

    function resetDrowsinessRiskState(targetId) {
        if (targetId) drowsinessRiskStates.delete(targetId);
        else drowsinessRiskStates.clear();
    }

    function resetIncapacitationRiskState(targetId) {
        if (targetId) incapacitationRiskStates.delete(targetId);
        else incapacitationRiskStates.clear();
    }

    global.DriverRiskRuntime = Object.freeze({
        EventState,
        RiskEvent,
        RiskEventStateMachine,
        observationToRiskSignal,
        resetDrowsinessRiskState,
        resetIncapacitationRiskState
    });
}(window));
