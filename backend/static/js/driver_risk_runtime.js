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

    function observationToRiskSignal(observation) {
        if (!(observation instanceof SensorObservation)) return noRisk(null, 'INVALID_OBSERVATION');
        if (observation.observationType === ObservationType.DROWSINESS) {
            return drowsinessObservationToRiskSignal(observation);
        }
        return noRisk(observation, 'NO_RISK_RULE_CONFIGURED');
    }

    function resetDrowsinessRiskState(targetId) {
        if (targetId) drowsinessRiskStates.delete(targetId);
        else drowsinessRiskStates.clear();
    }

    global.DriverRiskRuntime = Object.freeze({
        EventState,
        RiskEvent,
        RiskEventStateMachine,
        observationToRiskSignal,
        resetDrowsinessRiskState
    });
}(window));
