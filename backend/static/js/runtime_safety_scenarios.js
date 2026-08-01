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
        add(result) {
            const value = result.toJSON();
            this.entries = [value, ...this.entries.filter(item => item.runId !== value.runId)].slice(0, 100);
            this.save(); return result;
        }
        clear() { this.entries = []; this.save(); }
        list() { return clone(this.entries); }
        save() { try { global.localStorage.setItem(this.storageKey, JSON.stringify(this.entries)); } catch (_) { /* memory history */ } }
    }

    class ScenarioRunner {
        constructor(history = new ScenarioHistory()) {
            this.history = history;
            this.sequence = history.list().reduce((maximum, item) => {
                const match = String(item.runId || '').match(/-RUN-(\d+)$/);
                return match ? Math.max(maximum, Number(match[1])) : maximum;
            }, 0);
        }
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
        const select = root.querySelector('#scenarioSelect');
        const ui = id => root.querySelector(`#${id}`);
        const descriptions = Object.freeze({
            DROWSINESS: '운전자 졸음 상태 전이 검증',
            INCAPACITATION: '복합 신호 기반 운전 불능 가능성 검증',
            ALCOHOL_LEVEL: '음주 측정 상태 및 운행 정책 검증',
            HUMAN_PROXIMITY: '차량과 작업자 접근 위험 검증',
            TURN_RATE: '급회전 위험 검증',
            HARD_ACCELERATION: '급가속 위험 검증',
            HARD_BRAKING: '급제동 위험 검증',
            DANGEROUS_TILT: '차량 기울기 위험 검증'
        });
        const lifecycleLabels = Object.freeze({ NORMAL: 'NORMAL', ENTRY: 'ENTRY', ACTIVE: 'ACTIVE',
            ACK: 'ACKNOWLEDGED', CLEAR: 'CLEARED' });
        const escapeHtml = value => String(value === undefined || value === null ? 'not generated' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const formatTime = value => value ? new Date(value).toLocaleString('ko-KR', { hour12: false }) : '—';
        const duration = result => result ? Math.max(0, Date.parse(result.completedAt) - Date.parse(result.startedAt)) : 0;
        const asJson = value => value && typeof value.toJSON === 'function' ? value.toJSON() : clone(value);
        const buttons = [ui('runScenario'), ui('runAllScenarios'), ui('clearScenarioHistory')];

        Object.keys(scenarioLibrary).forEach(id => {
            const option = global.document.createElement('option'); option.value = id; option.textContent = id;
            select.appendChild(option);
        });

        function latestByScenario() {
            const latest = new Map();
            history.list().forEach(item => { if (!latest.has(item.scenarioType)) latest.set(item.scenarioType, item); });
            return latest;
        }

        function renderMetrics(selectedResult = null) {
            const latest = latestByScenario(); const values = Array.from(latest.values());
            ui('metricTotal').textContent = String(Object.keys(scenarioLibrary).length);
            ui('metricPass').textContent = String(values.filter(item => item.status === 'PASS').length);
            ui('metricFail').textContent = String(values.filter(item => item.status === 'FAIL').length);
            ui('metricSelected').textContent = select.value;
            ui('metricLastRun').textContent = selectedResult ? `마지막 실행 ${formatTime(selectedResult.completedAt)}` : '아직 실행되지 않음';
            ui('metricTriples').textContent = selectedResult ? String(selectedResult.artifacts.runtimeTriples.length) : '—';
        }

        function renderTimeline(result) {
            ui('timelineRunId').textContent = result ? result.runId : 'No run selected';
            if (!result) { ui('lifecycleTimeline').className = 'timeline empty-state';
                ui('lifecycleTimeline').textContent = 'Scenario를 실행하면 실제 단계별 결과가 표시됩니다.'; return; }
            ui('lifecycleTimeline').className = 'timeline';
            ui('lifecycleTimeline').innerHTML = result.lifecycle.map((item, index) => `
                <article class="timeline-step complete">
                  <span class="timeline-index">${index + 1}</span><h3>${escapeHtml(lifecycleLabels[item.phase] || item.phase)}</h3>
                  <p>phase · ${escapeHtml(item.phase)}</p><p>riskState · ${escapeHtml(item.riskState || 'NORMAL')}</p>
                  <p>${escapeHtml(item.observationId)}</p><p>+${index * 1000} ms</p><span class="check">✓ PASS</span>
                </article>`).join('');
        }

        function pathData(result) {
            if (!result) return [];
            const artifact = result.artifacts; const graph = artifact.runtimeGraph;
            return [
                ['Scenario', [['scenarioType', result.scenarioType], ['runId', result.runId]]],
                ['SensorObservation', [['observationId', result.observations[2] && result.observations[2].observationId], ['observationType', result.observations[2] && result.observations[2].observationType]]],
                ['RiskEvent', [['eventId', artifact.riskEvent && artifact.riskEvent.eventId], ['eventType', artifact.riskEvent && artifact.riskEvent.eventType], ['state', artifact.riskEvent && artifact.riskEvent.state]]],
                ['PolicyDecision', [['decisionId', artifact.policyDecision && artifact.policyDecision.decisionId], ['decision', artifact.policyDecision && artifact.policyDecision.decision]]],
                ['ActionRequest', [['actionId', artifact.actionRequest && artifact.actionRequest.actionId], ['actionType', artifact.actionRequest && artifact.actionRequest.actionType]]],
                ['ActionExecution', [['executionId', artifact.actionExecution && artifact.actionExecution.executionId], ['state', artifact.actionExecution && artifact.actionExecution.state]]],
                ['Runtime Graph', [['nodes', graph.nodes.length], ['edges', graph.edges.length]]],
                ['Runtime Triple', [['triple count', artifact.runtimeTriples.length]]]
            ];
        }

        function renderPath(result) {
            const path = pathData(result);
            if (!path.length) { ui('runtimePath').className = 'runtime-path empty-state'; ui('runtimePath').textContent = '아직 생성된 Runtime Path가 없습니다.'; return; }
            ui('runtimePath').className = 'runtime-path';
            ui('runtimePath').innerHTML = path.map(([title, fields]) => `<article class="path-node generated"><h3>✓ ${escapeHtml(title)}</h3><dl>${fields.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl></article>`).join('');
        }

        function renderReport(result) {
            const badge = ui('reportBadge');
            if (!result) { badge.className = 'status-badge status-pending'; badge.textContent = 'PENDING';
                ui('reportSummary').className = 'empty-state'; ui('reportSummary').textContent = 'Scenario를 선택하고 실행하세요.'; return; }
            const passedChecks = result.checks.filter(item => item.pass).length;
            const failedChecks = result.checks.length - passedChecks;
            badge.className = `status-badge ${result.status === 'PASS' ? 'status-pass' : 'status-fail'}`; badge.textContent = result.status;
            ui('reportSummary').className = 'report-grid';
            ui('reportSummary').innerHTML = [
                ['Scenario', result.scenarioType], ['Expected lifecycle', 'NORMAL → ENTRY → ACTIVE → ACKNOWLEDGED → CLEARED'],
                ['Actual lifecycle', result.lifecycle.map(item => lifecycleLabels[item.phase] || item.phase).join(' → ')],
                ['Triple count', result.artifacts.runtimeTriples.length], ['Duration', `${duration(result)} ms`],
                ['Run ID', result.runId], ['Completed time', formatTime(result.completedAt)]
            ].map(([label, value]) => `<div class="report-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('') +
                `<div class="check-summary"><strong class="ok">✓ ${passedChecks} checks completed</strong><strong class="bad">${failedChecks ? `✕ ${failedChecks} failed` : '0 failed'}</strong></div>`;
        }

        function renderTriples(result) {
            const triples = result ? result.artifacts.runtimeTriples : [];
            ui('tripleCount').textContent = String(triples.length);
            if (!triples.length) { ui('tripleSummary').className = 'triple-list empty-state'; ui('tripleSummary').textContent = '생성된 Triple이 없습니다.'; return; }
            const preferred = ['generatedRisk', 'triggeredPolicy', 'requestedAction', 'dispatchedAction', 'executedAction'];
            const selected = preferred.map(predicate => triples.find(item => item.predicate === predicate)).filter(Boolean);
            ui('tripleSummary').className = 'triple-list';
            ui('tripleSummary').innerHTML = selected.map(item => `<div class="triple-row"><span>${escapeHtml(item.subject)}</span><b>${escapeHtml(item.predicate)}</b><span>${escapeHtml(item.object)}</span></div>`).join('');
        }

        function renderMatrix() {
            const latest = latestByScenario(); const values = Array.from(latest.values());
            const pass = values.filter(item => item.status === 'PASS').length;
            ui('matrixHeadline').className = values.length === 8 && pass === 8 ? 'matrix-good' : (values.some(item => item.status === 'FAIL') ? 'matrix-bad' : '');
            ui('matrixHeadline').textContent = values.length === 8 ? (pass === 8 ? '8 / 8 PASS · All deterministic validation scenarios passed' : `${pass} / 8 PASS · ${8 - pass} scenario requires review`) : `${values.length} / 8 실행`;
            ui('scenarioMatrix').innerHTML = Object.keys(scenarioLibrary).map(id => { const item = latest.get(id); const completed = item ? item.lifecycle.length : 0;
                return `<article class="scenario-card ${item ? item.status.toLowerCase() : ''}"><h3>${escapeHtml(id)}</h3><p>${escapeHtml(descriptions[id])}</p><footer><span>${item ? item.status : 'NOT RUN'}</span><span>${completed}/5 · ${item ? item.artifacts.runtimeTriples.length : 0} triples</span></footer><footer><span>${item ? formatTime(item.completedAt) : '—'}</span></footer></article>`; }).join('');
        }

        function renderHistory() {
            const entries = history.list(); ui('emptyHistory').hidden = entries.length > 0;
            ui('scenarioHistory').innerHTML = entries.map(item => `<tr><td>${escapeHtml(formatTime(item.completedAt))}</td><td>${escapeHtml(item.scenarioType)}</td><td><span class="status-badge ${item.status === 'PASS' ? 'status-pass' : 'status-fail'}">${escapeHtml(item.status)}</span></td><td>${duration(item)} ms</td><td>${item.lifecycle.length}/5</td><td>${item.artifacts.runtimeTriples.length}</td><td class="mono" title="${escapeHtml(item.runId)}">${escapeHtml(item.runId)}</td><td><button class="details-button" type="button" data-run-id="${escapeHtml(item.runId)}">DETAILS</button></td></tr>`).join('');
        }

        function render(result) {
            const value = result ? asJson(result) : null;
            renderMetrics(value); renderTimeline(value); renderPath(value); renderReport(value); renderTriples(value);
            renderMatrix(); renderHistory(); ui('scenarioRawJson').textContent = JSON.stringify(value || {}, null, 2);
        }

        function setBusy(busy, message) {
            buttons.forEach(button => { button.disabled = busy; }); select.disabled = busy;
            ui('runStatus').className = `run-status ${busy ? 'running' : ''}`; ui('runStatus').textContent = message;
        }

        function execute(runAll) {
            setBusy(true, runAll ? '8개 Scenario 실행 중…' : `${select.value} 실행 중…`);
            global.setTimeout(() => {
                try {
                    const results = runAll ? runner.runAll() : [runner.run(select.value)];
                    const selected = asJson(results[results.length - 1]); select.value = selected.scenarioType;
                    render(selected); const pass = results.filter(item => item.status === 'PASS').length;
                    setBusy(false, `${pass === results.length ? '✓ PASS' : '✕ FAIL'} · ${pass}/${results.length} 완료`);
                } catch (error) {
                    setBusy(false, `✕ FAIL · ${error.message}`); ui('reportBadge').className = 'status-badge status-fail';
                    ui('reportBadge').textContent = 'FAIL'; ui('reportSummary').className = 'empty-state';
                    ui('reportSummary').textContent = `실행 오류: ${error.message}`;
                }
            }, 0);
        }

        select.addEventListener('change', () => { ui('scenarioDescription').textContent = descriptions[select.value];
            const latest = latestByScenario().get(select.value); render(latest || null); });
        ui('runScenario').addEventListener('click', () => execute(false));
        ui('runAllScenarios').addEventListener('click', () => execute(true));
        ui('clearScenarioHistory').addEventListener('click', () => { history.clear(); render(null); setBusy(false, 'History가 삭제되었습니다.'); });
        ui('scenarioHistory').addEventListener('click', event => { const button = event.target.closest('[data-run-id]');
            if (!button) return; const item = history.list().find(entry => entry.runId === button.dataset.runId);
            if (item) { select.value = item.scenarioType; ui('scenarioDescription').textContent = descriptions[item.scenarioType]; render(item); } });

        ui('scenarioDescription').textContent = descriptions[select.value];
        const restored = history.list()[0] || null;
        if (restored) select.value = restored.scenarioType;
        ui('scenarioDescription').textContent = descriptions[select.value]; render(restored);
        return Object.freeze({ runner, history, render });
    }

    global.RuntimeSafetyScenarios = Object.freeze({ Phase, ScenarioModel, ScenarioResult, ScenarioHistory,
        ScenarioRunner, scenarioLibrary, initializeScenarioViewer });
}(window));
