(function initializeRuntimeSafetyScenarios(global) {
    'use strict';

    if (!global.SafetyObservation || !global.DriverRiskRuntime ||
        !global.RuntimeEventGraph || !global.RuntimeTripleEngine) {
        throw new Error('RuntimeSafetyScenarios requires the stable Runtime Operational Ontology APIs');
    }

    const clone = value => JSON.parse(JSON.stringify(value));
    const Phase = Object.freeze({ NORMAL: 'NORMAL', ENTRY: 'ENTRY', ACTIVE: 'ACTIVE', ACK: 'ACK', CLEAR: 'CLEAR' });
    const phases = Object.freeze(Object.values(Phase));
    const BASE_TIME = Date.parse('2026-08-02T00:00:00.000Z');
    const phaseOffsets = Object.freeze([0, 1000, 2000, 3000, 4000]);
    const context = Object.freeze({
        vehicleId: 'F-03', driverId: 'DRIVER-VALIDATION-001',
        driverAssignmentId: 'ASSIGNMENT-VALIDATION-001',
        targetId: 'F-03|DRIVER-VALIDATION-001|ASSIGNMENT-VALIDATION-001',
        vehicleType: 'FORKLIFT', simulation: true, operationalUseAllowed: false
    });

    class ScenarioModel {
        constructor(input) {
            const required = ['scenarioId', 'scenarioType', 'eventType', 'sensorId', 'unit', 'values'];
            if (!input || required.some(field => input[field] === undefined)) {
                throw new TypeError('ScenarioModel is missing required fields');
            }
            if (!Array.isArray(input.values) || input.values.length !== phases.length) {
                throw new RangeError('ScenarioModel requires NORMAL, ENTRY, ACTIVE, ACK, CLEAR values');
            }
            Object.assign(this, clone(input));
            this.phases = phases.slice();
            Object.freeze(this.values); Object.freeze(this.phases); Object.freeze(this);
        }
        createObservations(runId, startedAt = BASE_TIME) {
            return this.values.map((value, index) => new global.SafetyObservation.SensorObservation({
                observationId: `${runId}-observation-${index + 1}`,
                observationType: this.scenarioType,
                sensorId: this.sensorId,
                targetId: context.targetId,
                value: clone(value), unit: this.unit, confidence: 1,
                observedAt: new Date(startedAt + phaseOffsets[index]).toISOString(),
                metadata: { ...clone(context), scenarioId: this.scenarioId, runId, phase: phases[index],
                    deterministic: true, sensorConnected: false }
            }));
        }
        toJSON() { return clone({ ...this }); }
    }

    const definitions = [
        ['DROWSINESS', 'DROWSINESS', 'DROWSINESS', 'CAMERA-VALIDATION', 'state', 'NORMAL', 'DROWSY', 'DROWSY', 'DROWSY', 'NORMAL'],
        ['INCAPACITATION', 'INCAPACITATION', 'DRIVER_INCAPACITATION', 'CAMERA-CAN-VALIDATION', 'composite',
            { incapacitated: false }, { incapacitated: true, compositeSignalCount: 3 }, { incapacitated: true, compositeSignalCount: 5 },
            { incapacitated: true, compositeSignalCount: 5 }, { incapacitated: false }],
        ['ALCOHOL_LEVEL', 'ALCOHOL_LEVEL', 'ALCOHOL_POLICY_VIOLATION', 'ALCOHOL-VALIDATION', 'simulation-level', 0, 0.06, 0.08, 0.08, 0.01],
        ['HUMAN_PROXIMITY', 'HUMAN_PROXIMITY', 'HUMAN_PROXIMITY', 'LIDAR-VALIDATION', 'm', 5, 1.5, 0.8, 0.8, 5],
        ['TURN_RATE', 'TURN_RATE', 'SHARP_TURN', 'CAN-VALIDATION', 'deg/s', 5, 30, 45, 45, 5],
        ['HARD_ACCELERATION', 'ACCELERATION', 'HARD_ACCELERATION', 'CAN-VALIDATION', 'm/s2', 0.2, 3.5, 5, 5, 0.2],
        ['HARD_BRAKING', 'BRAKING', 'HARD_BRAKING', 'CAN-VALIDATION', 'm/s2', 0.2, 4, 6, 6, 0.2],
        ['DANGEROUS_TILT', 'TILT', 'DANGEROUS_TILT', 'IMU-VALIDATION', 'deg', 2, 15, 25, 25, 2]
    ];
    const scenarioLibrary = Object.freeze(Object.fromEntries(definitions.map(item => {
        const [id, observationType, eventType, sensorId, unit, ...values] = item;
        return [id, new ScenarioModel({ scenarioId: `SCENARIO-${id}`, scenarioType: observationType,
            eventType, sensorId, unit, values, description: `${id} deterministic operational lifecycle` })];
    })));

    class ScenarioResult {
        constructor(input) { Object.assign(this, clone(input)); Object.freeze(this); }
        toJSON() { return clone({ ...this }); }
    }

    class ScenarioHistory {
        constructor(storageKey = 'runtime-safety-scenario-history-v1') {
            this.storageKey = storageKey; this.entries = [];
            try { this.entries = JSON.parse(global.localStorage.getItem(storageKey) || '[]'); } catch (_) { this.entries = []; }
        }
        add(result) { this.entries.unshift(result.toJSON()); this.entries = this.entries.slice(0, 100); this.save(); return result; }
        clear() { this.entries = []; this.save(); }
        list() { return clone(this.entries); }
        save() { try { global.localStorage.setItem(this.storageKey, JSON.stringify(this.entries)); } catch (_) { /* memory history */ } }
    }

    class ScenarioRunner {
        constructor(history = new ScenarioHistory()) { this.history = history; this.sequence = 0; }
        run(id) {
            const scenario = scenarioLibrary[id];
            if (!scenario) throw new RangeError(`Unknown scenario: ${id}`);
            this.sequence += 1;
            const runId = `${scenario.scenarioId}-RUN-${this.sequence}`;
            const startedAt = BASE_TIME + (this.sequence * 10000);
            const observations = scenario.createObservations(runId, startedAt);
            const stateMachine = new global.DriverRiskRuntime.RiskEventStateMachine();
            const graph = new global.RuntimeEventGraph.RuntimeGraph();
            const store = new global.RuntimeTripleEngine.TripleStore();
            const builder = new global.RuntimeTripleEngine.TripleBuilder(store);
            const checks = []; const lifecycle = [];
            const check = (condition, label) => { checks.push({ label, pass: Boolean(condition) }); };

            check(observations.length === 5 && observations.every((item, i) => item.metadata.phase === phases[i]),
                'deterministic observation sequence');
            lifecycle.push({ phase: Phase.NORMAL, riskState: null, observationId: observations[0].observationId });
            const entry = stateMachine.observe({ eventType: scenario.eventType, targetId: context.targetId, severity: 'HIGH' }, observations[1].observedAt);
            entry.metadata = { sourceObservationId: observations[1].observationId };
            lifecycle.push({ phase: Phase.ENTRY, riskState: entry.state, observationId: observations[1].observationId });
            const active = stateMachine.observe({ eventType: scenario.eventType, targetId: context.targetId, severity: 'HIGH' }, observations[2].observedAt);
            lifecycle.push({ phase: Phase.ACTIVE, riskState: active.state, observationId: observations[2].observationId });
            const acknowledged = stateMachine.acknowledge(active.eventId, observations[3].observedAt);
            lifecycle.push({ phase: Phase.ACK, riskState: acknowledged.state, observationId: observations[3].observationId });

            const decision = { decisionId: `${runId}-policy`, policyType: scenario.eventType,
                sourceEventId: active.eventId, targetId: context.targetId, priority: 'HIGH',
                decision: 'DETERMINISTIC_VALIDATION_ACTION', createdTime: observations[2].observedAt,
                metadata: { simulation: true, operationalUseAllowed: false, scenarioRunId: runId } };
            const action = { actionId: `${runId}-action`, actionType: 'VALIDATION_ACTION_REQUEST',
                sourceDecisionId: decision.decisionId, sourceEventId: active.eventId, targetId: context.targetId,
                priority: 'HIGH', state: 'COMPLETED', createdTime: observations[2].observedAt,
                metadata: { simulation: true, operationalUseAllowed: false } };
            const execution = { executionId: `${runId}-execution`, actionId: action.actionId,
                sourceDecisionId: decision.decisionId, sourceEventId: active.eventId, targetId: context.targetId,
                state: 'COMPLETED', requestedTime: observations[2].observedAt, completedTime: observations[3].observedAt,
                simulation: true, actuatorConnected: false, operationalUseAllowed: false,
                metadata: { selectedAdapterType: 'DeterministicScenarioAdapter', relationships: {
                    actionExecutionAppliesToVehicleContext: clone(context) } } };
            graph.ingestRuntimeChain({ observation: observations[2].toJSON(), riskEvent: active.toJSON(),
                policyDecision: decision, actionRequest: action, actionExecution: execution });
            builder.buildFromGraph(graph.getRuntimeGraph());
            const lineage = global.RuntimeTripleEngine.buildLineage(graph.getRuntimeGraph());
            const triples = store.getRuntimeTriples();
            const predicates = new Set(triples.map(item => item.predicate));
            ['generatedRisk', 'triggeredPolicy', 'requestedAction', 'dispatchedAction'].forEach(predicate =>
                check(predicates.has(predicate), `operational triple ${predicate}`));
            check(lineage.observationId && lineage.riskId && lineage.policyId &&
                lineage.actionId && lineage.executionId, 'complete runtime lineage');

            const cleared = stateMachine.clear(scenario.eventType, context.targetId, observations[4].observedAt);
            lifecycle.push({ phase: Phase.CLEAR, riskState: cleared.state, observationId: observations[4].observationId });
            check(JSON.stringify(lifecycle.map(item => item.phase)) === JSON.stringify(phases), 'phase order');
            check(JSON.stringify(lifecycle.map(item => item.riskState)) === JSON.stringify([null, 'NEW', 'ACTIVE', 'ACKNOWLEDGED', 'CLEARED']),
                'risk lifecycle state order');
            check(observations.every(item => item.metadata.deterministic && item.metadata.sensorConnected === false),
                'no physical sensor dependency');
            check(execution.simulation && !execution.actuatorConnected && !execution.operationalUseAllowed,
                'non-operational execution guard');
            const passed = checks.every(item => item.pass);
            return this.history.add(new ScenarioResult({ runId, scenarioId: scenario.scenarioId,
                scenarioType: id, status: passed ? 'PASS' : 'FAIL', startedAt: new Date(startedAt).toISOString(),
                completedAt: observations[4].observedAt, lifecycle, checks, observations: observations.map(item => item.toJSON()),
                artifacts: { riskEvent: cleared.toJSON(), policyDecision: decision, actionRequest: action,
                    actionExecution: execution, runtimeGraph: graph.getRuntimeGraph(), runtimeTriples: triples, lineage } }));
        }
        runAll() { return Object.keys(scenarioLibrary).map(id => this.run(id)); }
    }

    function initializeScenarioViewer() {
        const root = global.document && global.document.getElementById('scenarioViewer');
        if (!root) return null;
        const history = new ScenarioHistory(); const runner = new ScenarioRunner(history);
        const select = root.querySelector('#scenarioSelect'); const report = root.querySelector('#scenarioReport');
        const historyOutput = root.querySelector('#scenarioHistory');
        Object.keys(scenarioLibrary).forEach(id => { const option = global.document.createElement('option'); option.value = id; option.textContent = id; select.appendChild(option); });
        const renderHistory = () => { historyOutput.textContent = JSON.stringify(history.list(), null, 2); };
        const render = results => { const list = Array.isArray(results) ? results : [results];
            const pass = list.filter(item => item.status === 'PASS').length;
            report.textContent = `${pass === list.length ? 'PASS' : 'FAIL'} (${pass}/${list.length})\n\n${JSON.stringify(list.map(item => item.toJSON()), null, 2)}`;
            renderHistory(); };
        root.querySelector('#runScenario').addEventListener('click', () => render(runner.run(select.value)));
        root.querySelector('#runAllScenarios').addEventListener('click', () => render(runner.runAll()));
        root.querySelector('#clearScenarioHistory').addEventListener('click', () => { history.clear(); renderHistory(); });
        renderHistory(); return Object.freeze({ runner, history, render });
    }

    global.RuntimeSafetyScenarios = Object.freeze({ Phase, ScenarioModel, ScenarioResult, ScenarioHistory,
        ScenarioRunner, scenarioLibrary, initializeScenarioViewer });
}(window));
