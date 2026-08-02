(function defineDriverRuntimePage(global) {
    'use strict';

    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    class DriverRuntimePageFacade {
        constructor({ driverStatePage = null, policyPage = null, actionPage = null, inputModeController = null } = {}) {
            this.driverStatePage = driverStatePage;
            this.policyPage = policyPage;
            this.actionPage = actionPage;
            this.inputModeController = inputModeController || new global.DriverInputModeController.DriverInputModeController({
                cancelDeterministicRun: options => this.driverStatePage?.cancelDeterministicRun(options) || { cancelled: false }
            });
            this.contextByTarget = new Map();
            this.ingestedRiskStates = new Map();
            this.lastResultByTarget = new Map();
        }

        attach({ driverStatePage, policyPage, actionPage }) {
            if (driverStatePage) this.driverStatePage = driverStatePage;
            if (policyPage) this.policyPage = policyPage;
            if (actionPage) this.actionPage = actionPage;
            return this;
        }

        getRiskRuntime() { return this.driverStatePage?.getRiskEventStateMachine?.() || null; }
        getPolicyEngine() { return this.policyPage?.engine || null; }
        getActionDispatcher() { return this.actionPage?.dispatcher || null; }
        getInputModeController() { return this.inputModeController; }

        _contextFromObservation(observation) {
            const metadata = observation.metadata || {};
            const context = new global.DriverState.VehicleContext({
                vehicleType: metadata.vehicleType,
                vehicleId: metadata.vehicleId,
                driverId: metadata.driverId,
                driverAssignmentId: metadata.driverAssignmentId,
                capabilities: {}, sensorBindings: {}
            });
            if (context.targetId !== observation.targetId) throw new RangeError('Observation targetId does not match assignment context');
            this.contextByTarget.set(context.targetId, context);
            return context;
        }

        ingestObservation(observation) {
            if (!(observation instanceof global.SafetyObservation.SensorObservation)) {
                throw new TypeError('ingestObservation requires SensorObservation');
            }
            const riskRuntime = this.getRiskRuntime();
            if (!riskRuntime) throw new Error('RiskEventStateMachine is not attached');
            const context = this._contextFromObservation(observation);
            const signal = global.DriverRiskRuntime.observationToRiskSignal(observation);
            let riskEvent = null;
            if (signal.shouldCreateRisk) riskEvent = riskRuntime.observe(signal.eventInput, observation.observedAt);
            else if (signal.shouldClearRisk) {
                const eventType = signal.clearEventType || (observation.observationType === 'DROWSINESS' ? 'DROWSINESS'
                    : (observation.observationType === 'INCAPACITATION' ? 'DRIVER_INCAPACITATION' : 'ALCOHOL_POLICY_VIOLATION'));
                riskEvent = riskRuntime.clear(eventType, observation.targetId, observation.observedAt);
            }
            const result = { observation: observation.toJSON(), riskSignal: clone(signal), riskEvent: riskEvent?.toJSON?.() || null,
                policyDecision: null, actionRequests: [], actionExecutions: [] };
            if (riskEvent) {
                const policy = this.ingestRiskEvent({ ...riskEvent.toJSON(), metadata: { sourceObservationId: observation.observationId } }, context);
                result.policyDecision = policy?.decision || null;
                result.actionRequests = policy?.actions || [];
                result.actionExecutions = policy?.executions || [];
            }
            const observationOutput = global.document?.getElementById?.('lastDriverObservation');
            const riskOutput = global.document?.getElementById?.('driverRiskEventHistory');
            const signalOutput = global.document?.getElementById?.('lastDriverRiskSignal');
            if (observationOutput) observationOutput.textContent = JSON.stringify(result.observation, null, 2);
            if (riskOutput) riskOutput.textContent = JSON.stringify(riskRuntime.toJSON(), null, 2);
            if (signalOutput) signalOutput.textContent = JSON.stringify(result.riskSignal, null, 2);
            this.lastResultByTarget.set(observation.targetId, result);
            return clone(result);
        }

        ingestRiskEvent(riskEvent, contextInput = null) {
            const event = riskEvent?.toJSON ? riskEvent.toJSON() : clone(riskEvent);
            if (!event?.eventId || !event.targetId || !event.state) throw new TypeError('RiskEvent identity, target, and state are required');
            const context = contextInput || this.contextByTarget.get(event.targetId);
            if (!context || context.targetId !== event.targetId) throw new RangeError('RiskEvent target context is unavailable or mismatched');
            this.contextByTarget.set(event.targetId, context);
            const key = `${event.eventId}|${event.state}`;
            if (this.ingestedRiskStates.has(key)) return clone(this.ingestedRiskStates.get(key));
            const engine = this.getPolicyEngine();
            if (!engine) throw new Error('Policy Engine is not attached');
            const evaluated = engine.evaluate(event, context, new Date(event.updatedTime || event.createdTime));
            const actions = evaluated.actions.map(action => action.toJSON());
            const executions = actions.map(action => this.ingestActionRequest(action, context));
            const result = { decision: evaluated.decision.toJSON(), actions, executions };
            this.ingestedRiskStates.set(key, clone(result));
            this.policyPage?.render?.(evaluated, event);
            return clone(result);
        }

        ingestActionRequest(actionRequest, contextInput = null) {
            const action = actionRequest?.toJSON ? actionRequest.toJSON() : clone(actionRequest);
            const context = contextInput || this.contextByTarget.get(action?.targetId);
            if (!action?.actionId || !context || context.targetId !== action.targetId) {
                throw new RangeError('ActionRequest target context is unavailable or mismatched');
            }
            const dispatcher = this.getActionDispatcher();
            if (!dispatcher) throw new Error('Action Dispatcher is not attached');
            const execution = dispatcher.enqueue(action, context);
            this.actionPage?.render?.();
            return execution.toJSON();
        }

        acknowledgeRisk(eventId, now = new Date()) {
            const machine = this.getRiskRuntime();
            const event = machine?.acknowledge(eventId, now);
            if (!event) return null;
            const context = this.contextByTarget.get(event.targetId);
            return this.ingestRiskEvent(event, context);
        }

        getPolicyState(targetId) { return this.getPolicyEngine()?.getActiveDriverPolicies().filter(item => item.targetId === targetId) || []; }
        getPendingActionRequests(targetId) { return this.getPolicyEngine()?.getPendingDriverActions().filter(item => item.targetId === targetId) || []; }
        getExecutionState(targetId) { return this.getActionDispatcher()?.getDriverActionExecutions().filter(item => item.targetId === targetId) || []; }
        cancelPendingExecutionsForSource(sourceEventId, reason = 'SOURCE_POLICY_CLOSED') {
            return this.getActionDispatcher()?.cancelBySourceEvent(sourceEventId, reason, new Date()).map(item => item.toJSON()) || [];
        }
        resetTarget(targetId, options = {}) {
            const released = this.inputModeController.resetTarget(targetId);
            const cancelledRun = this.driverStatePage?.cancelDeterministicRun({ targetId,
                observationType: options.observationType || 'DROWSINESS', reason: options.reason || 'TARGET_RESET', preserveAuditHistory: true });
            this.getPolicyEngine()?.resetTarget(targetId, new Date());
            const cancelledExecutions = this.getActionDispatcher()?.resetTarget(targetId, new Date()) || [];
            return { targetId, released, cancelledRun, cancelledExecutionIds: cancelledExecutions.map(item => item.executionId) };
        }
        getRuntimeSnapshot(targetId) {
            return clone({
                targetId,
                inputMode: this.inputModeController.getMode('DROWSINESS', targetId),
                deterministicRun: this.driverStatePage?.getDeterministicRunState(targetId) || null,
                riskEvents: this.getRiskRuntime()?.toJSON().filter(item => item.targetId === targetId) || [],
                policyState: this.getPolicyState(targetId),
                pendingActionRequests: this.getPendingActionRequests(targetId),
                executions: this.getExecutionState(targetId),
                lastResult: this.lastResultByTarget.get(targetId) || null
            });
        }
    }

    const facade = new DriverRuntimePageFacade();
    global.DriverRuntimePage = Object.freeze({
        DriverRuntimePageFacade,
        attach: pages => facade.attach(pages),
        getRiskRuntime: () => facade.getRiskRuntime(),
        getPolicyEngine: () => facade.getPolicyEngine(),
        getActionDispatcher: () => facade.getActionDispatcher(),
        getInputModeController: () => facade.getInputModeController(),
        ingestObservation: observation => facade.ingestObservation(observation),
        ingestRiskEvent: (event, context) => facade.ingestRiskEvent(event, context),
        ingestActionRequest: (action, context) => facade.ingestActionRequest(action, context),
        acknowledgeRisk: (id, now) => facade.acknowledgeRisk(id, now),
        resetTarget: (id, options) => facade.resetTarget(id, options),
        getPolicyState: id => facade.getPolicyState(id),
        getPendingActionRequests: id => facade.getPendingActionRequests(id),
        getExecutionState: id => facade.getExecutionState(id),
        cancelPendingExecutionsForSource: (id, reason) => facade.cancelPendingExecutionsForSource(id, reason),
        getRuntimeSnapshot: id => facade.getRuntimeSnapshot(id)
    });
})(window);
