(function initializeDriverActionDispatcher(global) {
    'use strict';
    if (!global.DriverActionConfig) throw new Error('DriverActionDispatcher requires DriverActionConfig');

    const ExecutionState = Object.freeze({
        QUEUED: 'QUEUED', DISPATCHING: 'DISPATCHING', SIMULATED: 'SIMULATED',
        ACKNOWLEDGED: 'ACKNOWLEDGED', COMPLETED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED'
    });
    const ExecutionResult = Object.freeze({
        SIMULATION_ACCEPTED: 'SIMULATION_ACCEPTED', SIMULATION_COMPLETED: 'SIMULATION_COMPLETED',
        ADAPTER_UNAVAILABLE: 'ADAPTER_UNAVAILABLE', UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
        CANCELLED_BY_POLICY: 'CANCELLED_BY_POLICY', ACKNOWLEDGED_BY_OPERATOR: 'ACKNOWLEDGED_BY_OPERATOR',
        NO_OPERATIONAL_EXECUTION: 'NO_OPERATIONAL_EXECUTION'
    });
    const terminalExecutionStates = [ExecutionState.COMPLETED, ExecutionState.FAILED, ExecutionState.CANCELLED];
    const clone = value => JSON.parse(JSON.stringify(value));
    const iso = value => new Date(value).toISOString();

    class ActionExecution {
        constructor(input) { Object.assign(this, clone(input)); }
        transition(state, result, reasonCode, at = new Date()) {
            if (!Object.values(ExecutionState).includes(state)) throw new RangeError(`Unsupported execution state: ${state}`);
            const timestamp = iso(at);
            this.state = state; this.result = result; this.reasonCode = reasonCode;
            if (state === ExecutionState.DISPATCHING && !this.startedTime) this.startedTime = timestamp;
            if (state === ExecutionState.COMPLETED) this.completedTime = timestamp;
            if (state === ExecutionState.FAILED) this.failedTime = timestamp;
            if (state === ExecutionState.CANCELLED) this.cancelledTime = timestamp;
            this.metadata.relationships.actionExecutionHasState = state;
            this.metadata.relationships.actionExecutionReportsExecutionFeedback = { result, reasonCode };
            return this;
        }
        toJSON() { return clone({ ...this }); }
    }

    class DriverActionAdapter {
        constructor(adapterType, supportedActions = []) {
            this.adapterType = adapterType; this.supportedActions = supportedActions; this.connected = false;
        }
        supports(actionRequest) { return this.supportedActions.includes(actionRequest.actionType); }
        async connect() { this.connected = false; return false; }
        async disconnect() { this.connected = false; return true; }
        isConnected() { return this.connected; }
        dispatch() { return { state: ExecutionState.FAILED, result: ExecutionResult.ADAPTER_UNAVAILABLE,
            reasonCode: 'PHYSICAL_ADAPTER_NOT_CONNECTED' }; }
        acknowledge() { return false; }
        complete() { return false; }
        cancel() { return false; }
    }

    class VoiceWarningAdapter extends DriverActionAdapter { constructor() { super('VoiceWarningAdapter', ['VOICE_WARNING']); } }
    class VisualWarningAdapter extends DriverActionAdapter { constructor() { super('VisualWarningAdapter', ['VISUAL_WARNING']); } }
    class SeatVibrationAdapter extends DriverActionAdapter { constructor() { super('SeatVibrationAdapter', ['SEAT_VIBRATION_REQUEST']); } }
    class BeaconAdapter extends DriverActionAdapter { constructor() { super('BeaconAdapter', ['BEACON_REQUEST']); } }
    class SupervisorNotificationAdapter extends DriverActionAdapter { constructor() { super('SupervisorNotificationAdapter', ['SUPERVISOR_NOTIFICATION_REQUEST']); } }
    class RetestAdapter extends DriverActionAdapter { constructor() { super('RetestAdapter', ['RETEST_REQUEST']); } }
    class VehicleControlRequestAdapter extends DriverActionAdapter { constructor() { super('VehicleControlRequestAdapter', ['BLOCK_START_REQUEST', 'SAFE_STOP_REQUEST']); } }
    class EmergencyResponseRequestAdapter extends DriverActionAdapter { constructor() { super('EmergencyResponseRequestAdapter', ['EMERGENCY_RESPONSE_REQUEST']); } }

    class DeterministicActionTestAdapter extends DriverActionAdapter {
        constructor() { super('DeterministicActionTestAdapter', Object.keys(global.DriverActionConfig.adapterRouting)); }
        dispatch(actionRequest) {
            if (!this.supports(actionRequest)) return { state: ExecutionState.FAILED,
                result: ExecutionResult.UNSUPPORTED_ACTION, reasonCode: 'UNSUPPORTED_ACTION_TYPE' };
            return { state: ExecutionState.SIMULATED, result: ExecutionResult.SIMULATION_ACCEPTED,
                reasonCode: 'DETERMINISTIC_SIMULATION_ONLY' };
        }
        acknowledge() { return true; }
        complete() { return true; }
        cancel() { return true; }
    }

    class DriverActionDispatcher {
        constructor(configuration = global.DriverActionConfig) {
            this.configuration = configuration;
            this.executions = [];
            this.executionByActionId = new Map();
            this.actionById = new Map();
            this.contextByActionId = new Map();
            this.auditTrail = [];
            this.sequence = 0;
            this.runStates = new Map();
            this.listeners = new Set();
            this.adapters = {
                VoiceWarningAdapter: new VoiceWarningAdapter(), VisualWarningAdapter: new VisualWarningAdapter(),
                SeatVibrationAdapter: new SeatVibrationAdapter(), BeaconAdapter: new BeaconAdapter(),
                SupervisorNotificationAdapter: new SupervisorNotificationAdapter(), RetestAdapter: new RetestAdapter(),
                VehicleControlRequestAdapter: new VehicleControlRequestAdapter(),
                EmergencyResponseRequestAdapter: new EmergencyResponseRequestAdapter()
            };
            this.deterministicAdapter = new DeterministicActionTestAdapter();
        }

        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
        notify(execution) { this.listeners.forEach(listener => listener(execution ? execution.toJSON() : null)); }
        getPriority(action) { const configured = Number(action.priority);
            return Number.isFinite(configured) ? configured : 1000 - this.configuration.priorityOrder.indexOf(action.actionType); }
        selectAdapter(action) { const adapterType = this.configuration.adapterRouting[action.actionType];
            return { adapterType: adapterType || null, adapter: adapterType ? this.adapters[adapterType] : null }; }

        enqueue(actionInput, contextInput, now = new Date()) {
            const action = actionInput && typeof actionInput.toJSON === 'function' ? actionInput.toJSON() : clone(actionInput);
            const context = contextInput && typeof contextInput.toJSON === 'function' ? contextInput.toJSON() : clone(contextInput);
            if (!action || !action.actionId || !action.targetId) throw new TypeError('ActionRequest requires actionId and targetId');
            if (!context || context.targetId !== action.targetId) throw new RangeError('ActionRequest targetId must match VehicleContext targetId');
            if (this.executionByActionId.has(action.actionId)) return this.executionByActionId.get(action.actionId);
            const timestamp = iso(now); const route = this.selectAdapter(action);
            this.sequence += 1;
            const terminalAction = ['COMPLETED', 'CANCELLED'].includes(action.state);
            const execution = new ActionExecution({
                executionId: `driver-execution-${this.sequence}-${Date.parse(timestamp)}`, actionId: action.actionId,
                sourceDecisionId: action.sourceDecisionId, sourceEventId: action.sourceEventId,
                targetId: action.targetId, actionType: action.actionType,
                adapterType: route.adapterType || 'UnsupportedActionAdapter', requestedTime: timestamp,
                startedTime: null, completedTime: null, failedTime: null,
                cancelledTime: terminalAction ? timestamp : null,
                state: terminalAction ? ExecutionState.CANCELLED : ExecutionState.QUEUED,
                result: terminalAction ? ExecutionResult.CANCELLED_BY_POLICY : ExecutionResult.NO_OPERATIONAL_EXECUTION,
                reasonCode: terminalAction ? 'ACTION_REQUEST_ALREADY_TERMINAL' : 'WAITING_FOR_EXPLICIT_SIMULATION_DISPATCH',
                attemptNumber: 0, simulation: true, actuatorConnected: false, operationalUseAllowed: false,
                metadata: {
                    configurationVersion: this.configuration.configurationVersion,
                    dispatcherVersion: this.configuration.dispatcherVersion,
                    selectedAdapterType: route.adapterType,
                    policyReasonCodes: clone(action.metadata && action.metadata.policyReasonCodes || []),
                    relationships: {
                        policyDecisionRequestedActionRequest: action.sourceDecisionId,
                        actionRequestDispatchedBy: this.configuration.dispatcherVersion,
                        driverActionDispatcherSelectedActionAdapter: route.adapterType,
                        actionAdapterProducedActionExecution: null,
                        actionExecutionAppliesToVehicleContext: context,
                        actionExecutionConcernsDriver: context.driverId,
                        actionExecutionHasState: terminalAction ? ExecutionState.CANCELLED : ExecutionState.QUEUED,
                        actionExecutionReportsExecutionFeedback: null,
                        actionExecutionDerivedFromSourceEventId: action.sourceEventId,
                        actionExecutionDerivedFromSourceDecisionId: action.sourceDecisionId
                    }
                }
            });
            execution.metadata.relationships.actionAdapterProducedActionExecution = execution.executionId;
            this.executions.push(execution); this.executionByActionId.set(action.actionId, execution);
            this.actionById.set(action.actionId, action); this.contextByActionId.set(action.actionId, context);
            this.audit('EXECUTION_QUEUED', execution, timestamp); this.notify(execution); return execution;
        }

        sortQueue(items) { return items.sort((a, b) => {
            const actionA = this.actionById.get(a.actionId), actionB = this.actionById.get(b.actionId);
            const priorityDelta = this.getPriority(actionB) - this.getPriority(actionA);
            return priorityDelta || Date.parse(actionA.createdTime) - Date.parse(actionB.createdTime);
        }); }

        dispatchPending(targetId = null) {
            const targets = targetId ? [targetId] : [...new Set(this.executions
                .filter(item => item.state === ExecutionState.QUEUED).map(item => item.targetId))];
            targets.forEach(target => this.startTargetQueue(target));
            return this.getPendingDispatchActions();
        }

        startTargetQueue(targetId) {
            const previous = this.runStates.get(targetId) || { generation: 0, timerHandle: null };
            if (previous.timerHandle !== null) global.clearTimeout(previous.timerHandle);
            const state = { generation: previous.generation + 1, timerHandle: null };
            this.runStates.set(targetId, state);
            const generation = state.generation;
            const next = () => {
                if (this.runStates.get(targetId).generation !== generation) return;
                const execution = this.sortQueue(this.executions.filter(item =>
                    item.targetId === targetId && item.state === ExecutionState.QUEUED))[0];
                if (!execution) { state.timerHandle = null; return; }
                state.timerHandle = global.setTimeout(() => {
                    if (this.runStates.get(targetId).generation !== generation) return;
                    execution.attemptNumber += 1;
                    execution.transition(ExecutionState.DISPATCHING, ExecutionResult.NO_OPERATIONAL_EXECUTION,
                        'DETERMINISTIC_DISPATCH_STARTED', new Date());
                    this.audit('EXECUTION_DISPATCHING', execution, new Date()); this.notify(execution);
                    state.timerHandle = global.setTimeout(() => {
                        if (this.runStates.get(targetId).generation !== generation) return;
                        if (execution.state !== ExecutionState.DISPATCHING) { next(); return; }
                        const action = this.actionById.get(execution.actionId);
                        const route = this.selectAdapter(action);
                        const feedback = route.adapter
                            ? this.deterministicAdapter.dispatch(action, this.contextByActionId.get(action.actionId))
                            : { state: ExecutionState.FAILED, result: ExecutionResult.UNSUPPORTED_ACTION,
                                reasonCode: 'UNSUPPORTED_ACTION_TYPE' };
                        execution.transition(feedback.state, feedback.result, feedback.reasonCode, new Date());
                        this.audit('EXECUTION_FEEDBACK', execution, new Date()); this.notify(execution); next();
                    }, this.configuration.simulationDurationMs);
                }, this.configuration.dispatchDelayMs);
            };
            next();
        }

        acknowledge(executionId, now = new Date()) { const item = this.executions.find(e => e.executionId === executionId);
            if (!item || terminalExecutionStates.includes(item.state)) return item || null;
            item.transition(ExecutionState.ACKNOWLEDGED, ExecutionResult.ACKNOWLEDGED_BY_OPERATOR,
                'OPERATOR_ACKNOWLEDGED_SIMULATION', now); this.audit('EXECUTION_ACKNOWLEDGED', item, now); this.notify(item); return item; }
        complete(executionId, now = new Date()) { const item = this.executions.find(e => e.executionId === executionId);
            if (!item || terminalExecutionStates.includes(item.state)) return item || null;
            item.transition(ExecutionState.COMPLETED, ExecutionResult.SIMULATION_COMPLETED,
                'SIMULATION_MARKED_COMPLETED', now); this.audit('EXECUTION_COMPLETED', item, now); this.notify(item); return item; }
        fail(executionId, reasonCode = 'DETERMINISTIC_TEST_FAILURE', now = new Date()) { const item = this.executions.find(e => e.executionId === executionId);
            if (!item || terminalExecutionStates.includes(item.state)) return item || null;
            item.transition(ExecutionState.FAILED, ExecutionResult.ADAPTER_UNAVAILABLE, reasonCode, now);
            this.audit('EXECUTION_FAILED', item, now); this.notify(item); return item; }
        cancel(executionId, reasonCode = 'CANCELLED_BY_OPERATOR', now = new Date()) { const item = this.executions.find(e => e.executionId === executionId);
            if (!item || terminalExecutionStates.includes(item.state)) return item || null;
            item.transition(ExecutionState.CANCELLED, ExecutionResult.CANCELLED_BY_POLICY, reasonCode, now);
            this.audit('EXECUTION_CANCELLED', item, now); this.notify(item); return item; }
        cancelBySourceEvent(sourceEventId, reasonOrNow = 'SOURCE_POLICY_CLOSED', now = new Date()) {
            const legacyDate = reasonOrNow instanceof Date;
            const reason = legacyDate ? 'SOURCE_POLICY_CLOSED' : reasonOrNow;
            const timestamp = legacyDate ? reasonOrNow : now;
            return this.executions.filter(item =>
            item.sourceEventId === sourceEventId && !terminalExecutionStates.includes(item.state))
            .map(item => this.cancel(item.executionId, reason, timestamp)); }
        resetTarget(targetId, now = new Date()) { const state = this.runStates.get(targetId);
            if (state) { if (state.timerHandle !== null) global.clearTimeout(state.timerHandle); state.generation += 1; state.timerHandle = null; }
            return this.executions.filter(item => item.targetId === targetId && !terminalExecutionStates.includes(item.state))
                .map(item => this.cancel(item.executionId, 'TARGET_SIMULATION_RESET', now)); }
        audit(type, execution, at) { this.auditTrail.push({ type, timestamp: iso(at), execution: execution.toJSON() }); }
        getDriverActionExecutions() { return this.executions.map(item => item.toJSON()); }
        getPendingDispatchActions() { return this.sortQueue(this.executions.filter(item => item.state === ExecutionState.QUEUED)).map(item => item.toJSON()); }
        getActiveActionExecutions() { return this.executions.filter(item => !terminalExecutionStates.includes(item.state)).map(item => item.toJSON()); }
        getCompletedActionExecutions() { return this.executions.filter(item => item.state === ExecutionState.COMPLETED).map(item => item.toJSON()); }
        getFailedActionExecutions() { return this.executions.filter(item => item.state === ExecutionState.FAILED).map(item => item.toJSON()); }
        getDriverActionAuditTrail() { return clone(this.auditTrail); }
        getRunState(targetId) { const state = this.runStates.get(targetId); return state ? { ...state } : null; }
    }

    function initializeDriverActionPage() {
        const panel = document.getElementById('driverActionSimulation');
        if (!panel || !global.DriverPolicyPage || !global.DriverState) return null;
        const dispatcher = new DriverActionDispatcher(); let currentExecutionId = null;
        const output = id => document.getElementById(id);
        const context = () => new global.DriverState.VehicleContext({ vehicleType: output('driverVehicleType').value,
            vehicleId: output('driverVehicleId').value, driverId: output('driverId').value,
            driverAssignmentId: output('driverAssignmentId').value });
        function render() {
            const all = dispatcher.getDriverActionExecutions();
            const current = all.find(item => item.executionId === currentExecutionId) || all[all.length - 1] || null;
            output('driverDispatchQueue').textContent = JSON.stringify(dispatcher.getPendingDispatchActions(), null, 2);
            output('driverSelectedAdapter').textContent = current ? current.metadata.selectedAdapterType || 'UNSUPPORTED' : '-';
            output('driverCurrentExecutionId').textContent = current ? current.executionId : '-';
            output('driverCurrentDispatchActionId').textContent = current ? current.actionId : '-';
            output('driverExecutionState').textContent = current ? current.state : 'NONE';
            output('driverExecutionResult').textContent = current ? current.result : 'NONE';
            output('driverExecutionPriority').textContent = current
                ? String(dispatcher.getPriority(dispatcher.actionById.get(current.actionId))) : '-';
            output('driverExecutionAttempt').textContent = current ? String(current.attemptNumber) : '-';
            output('driverActiveExecutions').textContent = JSON.stringify(dispatcher.getActiveActionExecutions(), null, 2);
            output('driverCompletedExecutions').textContent = JSON.stringify(dispatcher.getCompletedActionExecutions(), null, 2);
            output('driverFailedExecutions').textContent = JSON.stringify(dispatcher.getFailedActionExecutions(), null, 2);
            output('driverActionAuditHistory').textContent = JSON.stringify(dispatcher.getDriverActionAuditTrail(), null, 2);
            output('driverDispatcherPendingPolicyActions').textContent = JSON.stringify(
                global.DriverPolicyPage.engine.getPendingDriverActions(), null, 2);
        }
        dispatcher.subscribe(execution => { if (execution) currentExecutionId = execution.executionId; render(); });
        output('generateDriverPolicyActions').addEventListener('click', () => {
            global.DriverPolicyPage.start('DRIVER_INCAPACITATION'); render();
        });
        output('dispatchPendingDriverActions').addEventListener('click', () => {
            const ctx = context();
            global.DriverPolicyPage.engine.getPendingDriverActions().forEach(action => dispatcher.enqueue(action, ctx));
            dispatcher.dispatchPending(ctx.targetId); render();
        });
        output('acknowledgeCurrentExecution').addEventListener('click', () => {
            if (currentExecutionId) dispatcher.acknowledge(currentExecutionId); render();
        });
        output('completeCurrentExecution').addEventListener('click', () => {
            if (currentExecutionId) dispatcher.complete(currentExecutionId); render();
        });
        output('failCurrentExecution').addEventListener('click', () => {
            if (currentExecutionId) dispatcher.fail(currentExecutionId); render();
        });
        output('cancelCurrentExecution').addEventListener('click', () => {
            if (currentExecutionId) dispatcher.cancel(currentExecutionId); render();
        });
        output('resetDriverActionSimulation').addEventListener('click', () => { dispatcher.resetTarget(context().targetId); render(); });
        render(); return Object.freeze({ dispatcher, render, getCurrentExecutionId: () => currentExecutionId });
    }

    global.DriverActions = Object.freeze({ ExecutionState, ExecutionResult, ActionExecution, DriverActionAdapter,
        VoiceWarningAdapter, VisualWarningAdapter, SeatVibrationAdapter, BeaconAdapter,
        SupervisorNotificationAdapter, RetestAdapter, VehicleControlRequestAdapter,
        EmergencyResponseRequestAdapter, DeterministicActionTestAdapter, DriverActionDispatcher,
        initializeDriverActionPage });
}(window));
