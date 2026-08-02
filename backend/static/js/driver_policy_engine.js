(function initializeDriverPolicyEngine(global) {
    'use strict';

    if (!global.DriverPolicyConfig) throw new Error('DriverPolicyEngine requires DriverPolicyConfig');

    const Decision = Object.freeze({
        NO_ACTION: 'NO_ACTION', MONITOR: 'MONITOR', WARN_DRIVER: 'WARN_DRIVER',
        ESCALATE_WARNING: 'ESCALATE_WARNING', NOTIFY_SUPERVISOR: 'NOTIFY_SUPERVISOR',
        REQUEST_RETEST: 'REQUEST_RETEST', BLOCK_START_REQUEST: 'BLOCK_START_REQUEST',
        SAFE_STOP_REQUEST: 'SAFE_STOP_REQUEST', EMERGENCY_RESPONSE_REQUEST: 'EMERGENCY_RESPONSE_REQUEST',
        CLOSE_POLICY: 'CLOSE_POLICY'
    });
    const ActionState = Object.freeze({
        REQUESTED: 'REQUESTED', DISPATCHED: 'DISPATCHED', ACKNOWLEDGED: 'ACKNOWLEDGED',
        COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED'
    });
    const ActionType = Object.freeze({
        VOICE_WARNING: 'VOICE_WARNING', VISUAL_WARNING: 'VISUAL_WARNING',
        SEAT_VIBRATION_REQUEST: 'SEAT_VIBRATION_REQUEST', BEACON_REQUEST: 'BEACON_REQUEST',
        SUPERVISOR_NOTIFICATION_REQUEST: 'SUPERVISOR_NOTIFICATION_REQUEST', RETEST_REQUEST: 'RETEST_REQUEST',
        BLOCK_START_REQUEST: 'BLOCK_START_REQUEST', SAFE_STOP_REQUEST: 'SAFE_STOP_REQUEST',
        EMERGENCY_RESPONSE_REQUEST: 'EMERGENCY_RESPONSE_REQUEST'
    });
    const clone = value => JSON.parse(JSON.stringify(value));
    const iso = value => new Date(value).toISOString();

    class DriverPolicyDecision {
        constructor(input) { Object.assign(this, clone(input)); }
        toJSON() { return clone({ ...this }); }
    }

    class ActionRequest {
        constructor(input) { Object.assign(this, clone(input)); }
        transition(state, at) {
            if (!Object.values(ActionState).includes(state)) throw new RangeError(`Unsupported action state: ${state}`);
            const timestamp = iso(at);
            this.state = state; this.updatedTime = timestamp;
            if (state === ActionState.ACKNOWLEDGED) this.acknowledgedTime = timestamp;
            if (state === ActionState.COMPLETED) this.completedTime = timestamp;
            if (state === ActionState.CANCELLED) this.cancelledTime = timestamp;
            return this;
        }
        toJSON() { return clone({ ...this }); }
    }

    class DriverPolicyEngine {
        constructor(configuration = global.DriverPolicyConfig) {
            this.configuration = configuration;
            this.policyStates = new Map();
            this.decisions = [];
            this.actions = [];
            this.auditTrail = [];
            this.decisionSequence = 0;
            this.actionSequence = 0;
        }

        normalizeEvent(input) {
            const event = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            const required = ['eventId', 'eventType', 'targetId', 'state', 'severity', 'createdTime'];
            if (!event || required.some(field => !event[field])) throw new TypeError('RiskEvent is missing required policy fields');
            return event;
        }

        getPolicyKey(event) { return `${event.eventType}::${event.targetId}::${event.eventId}`; }

        evaluate(eventInput, vehicleContext, now = new Date(), supplemental = {}) {
            const event = this.normalizeEvent(eventInput);
            const context = vehicleContext && typeof vehicleContext.toJSON === 'function'
                ? vehicleContext.toJSON() : clone(vehicleContext);
            const timestamp = iso(now);
            const key = this.getPolicyKey(event);
            let state = this.policyStates.get(key);
            if (!state) {
                state = {
                    key, sourceEventId: event.eventId, eventType: event.eventType, targetId: event.targetId,
                    createdTime: timestamp, updatedTime: timestamp, stage: 'INITIAL', closed: false,
                    decisionIds: [], actionIds: [], issuedStages: []
                };
                this.policyStates.set(key, state);
            }
            state.updatedTime = timestamp;

            if (event.state === 'CLEARED') return this.closePolicy(event, context, state, timestamp);
            const specification = this.getSpecification(event, state, now, supplemental);
            const reasonCodes = [...specification.reasonCodes];
            const stageAlreadyIssued = state.issuedStages.includes(specification.stage);
            const decision = this.createDecision(event, state, timestamp, specification, context, reasonCodes);
            const actions = [];
            if (!stageAlreadyIssued && !(event.state === 'ACKNOWLEDGED' && specification.suppressOnAck)) {
                specification.actions.forEach(actionType => {
                    const action = this.createAction(actionType, event, decision, context, timestamp, reasonCodes);
                    if (action) actions.push(action);
                });
                state.issuedStages.push(specification.stage);
            } else if (stageAlreadyIssued) {
                reasonCodes.push('SAME_STAGE_ACTION_ALREADY_REQUESTED');
            }
            decision.reasonCodes = [...reasonCodes];
            state.stage = specification.stage;
            state.decisionIds.push(decision.decisionId);
            actions.forEach(action => state.actionIds.push(action.actionId));
            this.recordAudit('POLICY_EVALUATED', timestamp, { event, decision: decision.toJSON(), actions: actions.map(a => a.toJSON()) });
            return { decision, actions };
        }

        getSpecification(event, state, now, supplemental) {
            const elapsed = new Date(now).getTime() - Date.parse(event.createdTime);
            if (event.eventType === 'DROWSINESS') {
                if (event.state === 'NEW') return { stage: 'DROWSINESS_STAGE_0', decision: Decision.MONITOR,
                    actions: [ActionType.VISUAL_WARNING], reasonCodes: ['DROWSINESS_NEW'], suppressOnAck: true };
                if (event.state === 'ACKNOWLEDGED') return { stage: state.stage, decision: Decision.MONITOR,
                    actions: [], reasonCodes: ['DROWSINESS_ACKNOWLEDGED_RISK_PRESERVED'], suppressOnAck: true };
                if (elapsed >= this.configuration.drowsiness.stage3Ms) return { stage: 'DROWSINESS_STAGE_3', decision: Decision.SAFE_STOP_REQUEST,
                    actions: [ActionType.SAFE_STOP_REQUEST], reasonCodes: ['DROWSINESS_LONG_DURATION_NO_CLEAR'], suppressOnAck: true };
                if (elapsed >= this.configuration.drowsiness.stage2Ms) return { stage: 'DROWSINESS_STAGE_2', decision: Decision.ESCALATE_WARNING,
                    actions: [ActionType.BEACON_REQUEST, ActionType.SUPERVISOR_NOTIFICATION_REQUEST], reasonCodes: ['DROWSINESS_ESCALATION_DURATION'], suppressOnAck: true };
                return { stage: 'DROWSINESS_STAGE_1', decision: Decision.WARN_DRIVER,
                    actions: [ActionType.VOICE_WARNING, ActionType.SEAT_VIBRATION_REQUEST], reasonCodes: ['DROWSINESS_ACTIVE_DURATION'], suppressOnAck: true };
            }
            if (event.eventType === 'DRIVER_INCAPACITATION') {
                if (event.state === 'NEW') return { stage: 'INCAPACITATION_STAGE_0', decision: Decision.ESCALATE_WARNING,
                    actions: [ActionType.VOICE_WARNING, ActionType.VISUAL_WARNING, ActionType.SUPERVISOR_NOTIFICATION_REQUEST],
                    reasonCodes: ['INCAPACITATION_NEW_HIGH_PRIORITY'], suppressOnAck: false };
                if (elapsed >= this.configuration.incapacitation.emergencyEscalationMs) return {
                    stage: 'INCAPACITATION_STAGE_2', decision: Decision.EMERGENCY_RESPONSE_REQUEST,
                    actions: [ActionType.EMERGENCY_RESPONSE_REQUEST], reasonCodes: ['INCAPACITATION_PERSISTED_NO_CLEAR'], suppressOnAck: false
                };
                return { stage: 'INCAPACITATION_STAGE_1', decision: Decision.SAFE_STOP_REQUEST,
                    actions: [ActionType.SAFE_STOP_REQUEST, ActionType.BEACON_REQUEST],
                    reasonCodes: [event.state === 'ACKNOWLEDGED' ? 'INCAPACITATION_ACKNOWLEDGED_RISK_PRESERVED' : 'INCAPACITATION_ACTIVE'], suppressOnAck: false };
            }
            if (event.eventType === 'ALCOHOL_POLICY_VIOLATION') {
                const observedDecision = supplemental.policyDecision || 'NO_DECISION';
                const mapping = {
                    ALLOW: { decision: Decision.NO_ACTION, actions: [], reason: 'ALCOHOL_VALID_ALLOW' },
                    RETEST: { decision: Decision.REQUEST_RETEST, actions: [ActionType.RETEST_REQUEST], reason: 'ALCOHOL_MEASUREMENT_RETEST' },
                    BLOCK_START: { decision: Decision.BLOCK_START_REQUEST, actions: [ActionType.BLOCK_START_REQUEST], reason: 'ALCOHOL_PRE_START_POLICY_VIOLATION' },
                    SAFE_STOP_REQUEST: { decision: Decision.SAFE_STOP_REQUEST, actions: [ActionType.SAFE_STOP_REQUEST], reason: 'ALCOHOL_IN_OPERATION_POLICY_VIOLATION' },
                    NO_DECISION: { decision: Decision.MONITOR, actions: [], reason: supplemental.measurementStatus === 'FAILED'
                        ? 'ALCOHOL_MEASUREMENT_FAILED_NO_POLICY_VIOLATION_DECISION' : 'ALCOHOL_NO_DECISION' }
                };
                const selected = mapping[observedDecision] || mapping.NO_DECISION;
                return { stage: `ALCOHOL_${observedDecision}`, decision: selected.decision, actions: selected.actions,
                    reasonCodes: [selected.reason, 'OBSERVATION_POLICY_DECISION_REUSED'], suppressOnAck: true };
            }
            return { stage: 'UNSUPPORTED', decision: Decision.NO_ACTION, actions: [], reasonCodes: ['UNSUPPORTED_DRIVER_EVENT'], suppressOnAck: true };
        }

        createDecision(event, state, timestamp, specification, context, reasonCodes) {
            this.decisionSequence += 1;
            const decision = new DriverPolicyDecision({
                decisionId: `driver-policy-${this.decisionSequence}-${Date.parse(timestamp)}`,
                policyType: event.eventType, targetId: event.targetId, sourceEventId: event.eventId,
                sourceEventType: event.eventType, sourceEventState: event.state, severity: event.severity,
                createdTime: timestamp, updatedTime: timestamp, policyVersion: this.configuration.policyVersion,
                configurationVersion: this.configuration.configurationVersion, decision: specification.decision,
                reasonCodes: [...reasonCodes], recommendedActions: [...specification.actions],
                metadata: this.metadata(context, {
                    policyStage: specification.stage,
                    relationships: { observationGeneratedRiskEvent:
                            (event.metadata && event.metadata.sourceObservationId) || null,
                        riskEventTriggeredPolicyDecision: event.eventId,
                        derivedFromConfigurationVersion: this.configuration.configurationVersion }
                })
            });
            this.decisions.push(decision);
            return decision;
        }

        createAction(actionType, event, decision, context, timestamp, reasonCodes) {
            const duplicate = this.actions.find(action => action.targetId === event.targetId &&
                action.actionType === actionType && ![ActionState.COMPLETED, ActionState.CANCELLED].includes(action.state));
            if (duplicate) { reasonCodes.push(`ACTION_DEDUPLICATED_${actionType}`); return null; }
            this.actionSequence += 1;
            const action = new ActionRequest({
                actionId: `driver-action-${this.actionSequence}-${Date.parse(timestamp)}`, actionType,
                targetId: event.targetId, sourceEventId: event.eventId, sourceDecisionId: decision.decisionId,
                createdTime: timestamp, updatedTime: timestamp, state: ActionState.REQUESTED,
                priority: this.configuration.actionPriority[actionType] || 100, channel: 'SIMULATION_REQUEST_ONLY',
                message: `${actionType} requested by deterministic driver policy simulation`,
                requiresAcknowledgement: true, acknowledgedTime: null, completedTime: null, cancelledTime: null,
                metadata: this.metadata(context, { actuatorExecuted: false, externalNotificationSent: false,
                    policyReasonCodes: [...decision.reasonCodes],
                    relationships: { policyDecisionRequestedActionRequest: decision.decisionId,
                        appliesToVehicleContext: context, concernsDriver: context && context.driverId,
                        actionRequestHasState: ActionState.REQUESTED } })
            });
            this.actions.push(action);
            return action;
        }

        closePolicy(event, context, state, timestamp) {
            this.actions.filter(action => state.actionIds.includes(action.actionId) &&
                ![ActionState.COMPLETED, ActionState.CANCELLED].includes(action.state)).forEach(action => {
                action.transition(action.state === ActionState.REQUESTED ? ActionState.CANCELLED : ActionState.COMPLETED, timestamp);
            });
            state.closed = true; state.stage = 'CLOSED'; state.updatedTime = timestamp;
            const specification = { stage: 'CLOSED', decision: Decision.CLOSE_POLICY, actions: [],
                reasonCodes: ['SOURCE_RISK_EVENT_CLEARED'], suppressOnAck: true };
            const decision = this.createDecision(event, state, timestamp, specification, context, specification.reasonCodes);
            state.decisionIds.push(decision.decisionId);
            this.recordAudit('POLICY_CLOSED', timestamp, { event, decision: decision.toJSON() });
            return { decision, actions: [] };
        }

        metadata(context, extra = {}) { return { simulation: true, operationalUseAllowed: false,
            actuatorConnected: false, externalNotificationConnected: false, ...clone(extra) }; }
        recordAudit(type, timestamp, payload) { this.auditTrail.push({ type, timestamp, ...clone(payload) }); }
        dispatchAction(id, now = new Date()) { const action = this.actions.find(a => a.actionId === id); return action ? action.transition(ActionState.DISPATCHED, now) : null; }
        acknowledgeAction(id, now = new Date()) { const action = this.actions.find(a => a.actionId === id); if (!action) return null;
            if (action.state === ActionState.REQUESTED) action.transition(ActionState.DISPATCHED, now); return action.transition(ActionState.ACKNOWLEDGED, now); }
        completeAction(id, now = new Date()) { const action = this.actions.find(a => a.actionId === id); if (!action) return null;
            if (action.state === ActionState.REQUESTED) action.transition(ActionState.DISPATCHED, now); return action.transition(ActionState.COMPLETED, now); }
        resetTarget(targetId, now = new Date()) { Array.from(this.policyStates.values()).filter(s => s.targetId === targetId && !s.closed)
            .forEach(state => this.closePolicy({ eventId: state.sourceEventId, eventType: state.eventType, targetId,
                state: 'CLEARED', severity: 'SIMULATION_RESET', createdTime: state.createdTime }, null, state, iso(now))); }
        getDriverPolicyDecisions() { return this.decisions.map(item => item.toJSON()); }
        getDriverActionRequests() { return this.actions.map(item => item.toJSON()); }
        getActiveDriverPolicies() { return Array.from(this.policyStates.values()).filter(s => !s.closed).map(clone); }
        getPendingDriverActions() { return this.actions.filter(a => ![ActionState.COMPLETED, ActionState.CANCELLED].includes(a.state)).map(a => a.toJSON()); }
        getDriverRuntimeAuditTrail() { return clone(this.auditTrail); }
        getHighestPriorityRisk(targetId = null) { const active = this.getActiveDriverPolicies().filter(s => !targetId || s.targetId === targetId)
            .sort((a, b) => (this.configuration.eventPriority[b.eventType] || 0) - (this.configuration.eventPriority[a.eventType] || 0)); return active[0] || null; }
    }

    function initializeDriverPolicyPage() {
        const panel = document.getElementById('driverPolicySimulation');
        if (!panel || !global.DriverState) return null;
        const engine = new DriverPolicyEngine();
        const run = { timerHandle: null, generation: 0, sourceEventId: null, eventType: null,
            targetId: null, decisionIds: new Set(), actionIds: new Set() };
        const output = id => document.getElementById(id);
        const readContext = () => new global.DriverState.VehicleContext({
            vehicleType: output('driverVehicleType').value, vehicleId: output('driverVehicleId').value,
            driverId: output('driverId').value, driverAssignmentId: output('driverAssignmentId').value
        });
        const eventSequences = {
            DROWSINESS: [{ state: 'NEW', at: 0 }, { state: 'ACTIVE', at: 250 }, { state: 'ACTIVE', at: 500 },
                { state: 'ACTIVE', at: 750 }, { state: 'ACKNOWLEDGED', at: 1000 }, { state: 'CLEARED', at: 1250 }],
            DRIVER_INCAPACITATION: [{ state: 'NEW', at: 0 }, { state: 'ACTIVE', at: 250 },
                { state: 'ACTIVE', at: 500 }, { state: 'ACKNOWLEDGED', at: 750 }, { state: 'CLEARED', at: 1000 }],
            ALCOHOL_POLICY_VIOLATION: [{ state: 'NEW', at: 0, policyDecision: 'BLOCK_START' },
                { state: 'ACTIVE', at: 250, policyDecision: 'BLOCK_START' },
                { state: 'ACKNOWLEDGED', at: 500, policyDecision: 'BLOCK_START' },
                { state: 'CLEARED', at: 750, policyDecision: 'ALLOW' }]
        };

        function render(result, event) {
            if (result) {
                run.decisionIds.add(result.decision.decisionId);
                result.actions.forEach(action => run.actionIds.add(action.actionId));
                output('driverPolicyCurrentDecision').textContent = JSON.stringify(result.decision.toJSON(), null, 2);
                output('driverPolicyStage').textContent = result.decision.metadata.policyStage;
                output('driverPolicyRecommendedActions').textContent = result.decision.recommendedActions.join('\n') || 'NONE';
                output('driverPolicySourceEventId').textContent = event.eventId;
                output('driverPolicyDecisionId').textContent = result.decision.decisionId;
            }
            const runActions = engine.getDriverActionRequests().filter(action => run.actionIds.has(action.actionId));
            output('driverPolicyPendingActions').textContent = JSON.stringify(
                runActions.filter(action => !['COMPLETED', 'CANCELLED'].includes(action.state)), null, 2
            );
            const currentAction = runActions.find(action => !['COMPLETED', 'CANCELLED'].includes(action.state));
            output('driverPolicyActionState').textContent = currentAction ? currentAction.state : 'NONE';
            output('driverPolicyActionId').textContent = currentAction ? currentAction.actionId : '-';
            output('driverPolicyActiveEvents').textContent = JSON.stringify(engine.getActiveDriverPolicies(), null, 2);
            output('driverPolicyHighestRisk').textContent = JSON.stringify(engine.getHighestPriorityRisk(), null, 2);
            output('driverPolicyAuditHistory').textContent = JSON.stringify(
                engine.getDriverRuntimeAuditTrail().filter(item => item.decision && run.decisionIds.has(item.decision.decisionId)), null, 2
            );
        }

        function closePreviousRun() {
            if (!run.sourceEventId || !run.targetId || !run.eventType) return;
            const previous = engine.getActiveDriverPolicies().find(item => item.sourceEventId === run.sourceEventId);
            if (!previous) return;
            const event = { eventId: run.sourceEventId, eventType: run.eventType, targetId: run.targetId,
                state: 'CLEARED', severity: 'SIMULATION_RESTART', createdTime: previous.createdTime };
            engine.evaluate(event, null, new Date());
        }

        function start(eventType) {
            if (run.timerHandle !== null) global.clearTimeout(run.timerHandle);
            run.generation += 1;
            closePreviousRun();
            const context = readContext();
            const generation = run.generation;
            const startedAt = Date.now();
            run.sourceEventId = `policy-test-${eventType}-${context.targetId}-${startedAt}-${generation}`;
            run.eventType = eventType; run.targetId = context.targetId;
            run.decisionIds = new Set(); run.actionIds = new Set();
            ['driverPolicyCurrentDecision', 'driverPolicyPendingActions', 'driverPolicyAuditHistory'].forEach(id => {
                output(id).textContent = id === 'driverPolicyPendingActions' ? '[]' : '{}';
            });
            const sequence = eventSequences[eventType];
            const step = index => {
                if (generation !== run.generation) return;
                const item = sequence[index];
                const event = { eventId: run.sourceEventId, eventType, targetId: context.targetId,
                    state: item.state, severity: eventType === 'DROWSINESS' ? 'HIGH' : 'CRITICAL',
                    createdTime: iso(startedAt), updatedTime: iso(startedAt + item.at) };
                const result = engine.evaluate(event, context, new Date(startedAt + item.at), {
                    policyDecision: item.policyDecision, measurementMode: 'PRE_START', measurementStatus: 'VALID'
                });
                render(result, event);
                if (index === sequence.length - 1) { run.timerHandle = null; return; }
                run.timerHandle = global.setTimeout(() => step(index + 1), 250);
            };
            step(0);
        }

        output('runDrowsinessPolicyTest').addEventListener('click', () => start('DROWSINESS'));
        output('runIncapacitationPolicyTest').addEventListener('click', () => start('DRIVER_INCAPACITATION'));
        output('runAlcoholPolicyTest').addEventListener('click', () => start('ALCOHOL_POLICY_VIOLATION'));
        output('acknowledgeCurrentDriverAction').addEventListener('click', () => {
            const action = engine.getPendingDriverActions().sort((a, b) => b.priority - a.priority)[0];
            if (action) engine.acknowledgeAction(action.actionId, new Date());
            render(null, { eventId: run.sourceEventId });
        });
        output('completeCurrentDriverAction').addEventListener('click', () => {
            const action = engine.getPendingDriverActions().sort((a, b) => b.priority - a.priority)[0];
            if (action) engine.completeAction(action.actionId, new Date());
            render(null, { eventId: run.sourceEventId });
        });
        output('resetDriverPolicySimulation').addEventListener('click', () => {
            if (run.timerHandle !== null) global.clearTimeout(run.timerHandle);
            run.generation += 1;
            const context = readContext();
            engine.resetTarget(context.targetId, new Date());
            render(null, { eventId: run.sourceEventId });
        });
        return Object.freeze({ engine, start, render, getRunState: () => ({ generation: run.generation,
            timerHandle: run.timerHandle, sourceEventId: run.sourceEventId, targetId: run.targetId }) });
    }

    global.DriverPolicy = Object.freeze({ Decision, ActionState, ActionType, DriverPolicyDecision,
        ActionRequest, DriverPolicyEngine, initializeDriverPolicyPage });
}(window));
