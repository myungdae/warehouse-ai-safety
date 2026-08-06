(function initializeRuntimeTripleEngine(global) {
    'use strict';

    const RuntimeVocabulary = Object.freeze({
        generatedRisk: 'generatedRisk', triggeredPolicy: 'triggeredPolicy',
        requestedAction: 'requestedAction', dispatchedAction: 'dispatchedAction',
        executedAction: 'executedAction', appliesTo: 'appliesTo',
        concernsDriver: 'concernsDriver', derivedFromObservation: 'derivedFromObservation',
        derivedFromRisk: 'derivedFromRisk', derivedFromPolicy: 'derivedFromPolicy',
        generatedExecution: 'generatedExecution', usesAdapter: 'usesAdapter',
        acknowledgedBy: 'acknowledgedBy', completedBy: 'completedBy',
        hasState: 'hasState', hasSeverity: 'hasSeverity', hasPriority: 'hasPriority',
        hasPolicyDecision: 'hasPolicyDecision', hasVehicle: 'hasVehicle',
        hasDriver: 'hasDriver', hasAssignment: 'hasAssignment', hasExecution: 'hasExecution'
    });
    const vocabularyValues = new Set(Object.values(RuntimeVocabulary));
    const clone = value => JSON.parse(JSON.stringify(value));
    const isoTime = value => new Date(value || Date.now()).toISOString();
    const tripleKey = ({ subject, predicate, object }) => `${subject}|${predicate}|${object}`;

    class RuntimeTriple {
        constructor(input) {
            if (!input || !input.tripleId || !input.subject || !vocabularyValues.has(input.predicate) ||
                input.object === undefined || input.object === null || !input.subjectType || !input.objectType) {
                throw new TypeError('RuntimeTriple requires valid identifiers, types, and vocabulary predicate');
            }
            this.tripleId = String(input.tripleId);
            this.subject = String(input.subject);
            this.predicate = input.predicate;
            this.object = String(input.object);
            this.subjectType = input.subjectType;
            this.objectType = input.objectType;
            this.createdTime = isoTime(input.createdTime);
            this.updatedTime = isoTime(input.updatedTime || input.createdTime);
            this.confidence = input.confidence === undefined ? 1 : Number(input.confidence);
            if (!Number.isFinite(this.confidence) || this.confidence < 0 || this.confidence > 1) {
                throw new RangeError('RuntimeTriple.confidence must be between 0 and 1');
            }
            this.source = input.source || 'RuntimeOperationalGraph';
            this.simulation = input.simulation !== false;
            this.metadata = clone(input.metadata || {});
        }
        toJSON() { return clone({ ...this }); }
    }

    class TripleStore {
        constructor() { this.triples = new Map(); }
        add(input) {
            const triple = input instanceof RuntimeTriple ? input : new RuntimeTriple(input);
            const key = tripleKey(triple);
            const existing = this.triples.get(key);
            if (existing) {
                existing.updatedTime = triple.updatedTime;
                existing.confidence = triple.confidence;
                existing.metadata = { ...existing.metadata, ...clone(triple.metadata) };
                return existing;
            }
            this.triples.set(key, triple);
            return triple;
        }
        getRuntimeTriples() { return Array.from(this.triples.values()).map(item => item.toJSON()); }
        findTriples(query = {}) {
            return this.getRuntimeTriples().filter(item => Object.entries(query).every(([key, value]) => item[key] === value));
        }
        findSubject(subject) { return this.findTriples({ subject }); }
        findObject(object) { return this.findTriples({ object }); }
        findPredicate(predicate) { return this.findTriples({ predicate }); }
        exportTriplesJSON(space = 2) { return JSON.stringify(this.getRuntimeTriples(), null, space); }
        exportTriplesTTL() {
            const resource = value => `<urn:runtime:${encodeURIComponent(value)}>`;
            const literal = value => JSON.stringify(String(value));
            return this.getRuntimeTriples().map(item => {
                const object = item.objectType === 'Literal' ? literal(item.object) : resource(item.object);
                return `${resource(item.subject)} <urn:runtime:vocabulary:${item.predicate}> ${object} .`;
            }).join('\n');
        }
        clear() { this.triples.clear(); }
        toJSON() { return this.getRuntimeTriples(); }
    }

    class TripleBuilder {
        constructor(store = new TripleStore()) { this.store = store; }
        add(subject, predicate, object, subjectType, objectType, options = {}) {
            if (!subject || object === undefined || object === null || object === '') return null;
            const key = `${subject}|${predicate}|${object}`;
            return this.store.add({ tripleId: `triple:${key}`, subject, predicate, object,
                subjectType, objectType, createdTime: options.createdTime, updatedTime: options.updatedTime,
                confidence: options.confidence, source: options.source, simulation: true,
                metadata: options.metadata || {} });
        }
        buildFromGraph(graphInput) {
            const graph = graphInput || { nodes: [], edges: [] };
            const nodes = new Map((graph.nodes || []).map(node => [node.nodeId, node]));
            const edgePredicates = {
                GENERATED: RuntimeVocabulary.generatedRisk,
                TRIGGERED: RuntimeVocabulary.triggeredPolicy,
                REQUESTED: RuntimeVocabulary.requestedAction,
                DISPATCHED: RuntimeVocabulary.dispatchedAction,
                APPLIES_TO: RuntimeVocabulary.appliesTo,
                CONCERNS: RuntimeVocabulary.concernsDriver,
                ACKNOWLEDGED_BY: RuntimeVocabulary.acknowledgedBy,
                COMPLETED_BY: RuntimeVocabulary.completedBy
            };
            (graph.edges || []).forEach(edge => {
                const from = nodes.get(edge.from); const to = nodes.get(edge.to);
                if (!from || !to) return;
                let predicate = edgePredicates[edge.relation];
                if (edge.relation === 'DERIVED_FROM') {
                    predicate = to.nodeType === 'Observation' ? RuntimeVocabulary.derivedFromObservation :
                        to.nodeType === 'RiskEvent' ? RuntimeVocabulary.derivedFromRisk : RuntimeVocabulary.derivedFromPolicy;
                } else if (edge.relation === 'EXECUTED') {
                    this.add(edge.to, RuntimeVocabulary.usesAdapter, edge.from, to.nodeType, from.nodeType,
                        { createdTime: edge.createdTime, source: edge.edgeId, metadata: edge.metadata });
                    return;
                } else if (edge.relation === 'PRODUCED_BY') {
                    predicate = RuntimeVocabulary.generatedExecution;
                }
                if (predicate) this.add(edge.from, predicate, edge.to, from.nodeType, to.nodeType,
                    { createdTime: edge.createdTime, source: edge.edgeId, metadata: edge.metadata });
                if (edge.relation === 'DISPATCHED') this.add(edge.from, RuntimeVocabulary.executedAction,
                    edge.to, from.nodeType, to.nodeType,
                    { createdTime: edge.createdTime, source: edge.edgeId, metadata: edge.metadata });
            });
            (graph.nodes || []).forEach(node => this.addNodeProperties(node, nodes));
            return this.store.getRuntimeTriples();
        }
        addNodeProperties(node, nodes = new Map()) {
            const data = node.metadata || {};
            const options = { createdTime: node.createdTime, updatedTime: node.updatedTime, source: node.nodeId };
            const properties = [
                [RuntimeVocabulary.hasState, data.state], [RuntimeVocabulary.hasSeverity, data.severity],
                [RuntimeVocabulary.hasPriority, data.priority], [RuntimeVocabulary.hasPolicyDecision, data.decisionId],
                [RuntimeVocabulary.hasExecution, data.executionId], [RuntimeVocabulary.hasVehicle, data.vehicleId],
                [RuntimeVocabulary.hasDriver, data.driverId], [RuntimeVocabulary.hasAssignment, data.driverAssignmentId]
            ];
            properties.forEach(([predicate, value]) => this.add(node.nodeId, predicate, value, node.nodeType, 'Literal', options));
            if (node.nodeType === 'ActionExecution') {
                if (data.sourceDecisionId) this.add(node.nodeId, RuntimeVocabulary.derivedFromPolicy,
                    `PolicyDecision:${data.sourceDecisionId}`, node.nodeType, 'PolicyDecision', options);
                if (data.sourceEventId) this.add(node.nodeId, RuntimeVocabulary.derivedFromRisk,
                    `RiskEvent:${data.sourceEventId}`, node.nodeType, 'RiskEvent', options);
                const observation = Array.from(nodes.values()).reverse().find(candidate =>
                    candidate.nodeType === 'Observation' && candidate.metadata && candidate.metadata.targetId === data.targetId);
                if (observation) this.add(node.nodeId, RuntimeVocabulary.derivedFromObservation,
                    observation.nodeId, node.nodeType, observation.nodeType, options);
                if (data.state === 'COMPLETED') this.add(node.nodeId, RuntimeVocabulary.completedBy,
                    `ExecutionFeedback:${data.executionId}:COMPLETED`, node.nodeType, 'ExecutionFeedback', options);
            }
        }
    }

    const tripleStore = new TripleStore();
    const tripleBuilder = new TripleBuilder(tripleStore);
    const syncFromRuntimeGraph = graph => tripleBuilder.buildFromGraph(graph ||
        (global.RuntimeEventGraph ? global.RuntimeEventGraph.getRuntimeGraph() : { nodes: [], edges: [] }));
    const getRuntimeTriples = () => tripleStore.getRuntimeTriples();
    const findTriples = query => tripleStore.findTriples(query);
    const walk = (start, direction) => {
        const queue = [start]; const visited = new Set([start]); const result = [];
        while (queue.length) {
            const current = queue.shift();
            tripleStore.getRuntimeTriples().forEach(triple => {
                const matches = direction === 'out' ? triple.subject === current : triple.object === current;
                const next = direction === 'out' ? triple.object : triple.subject;
                if (matches && triple.objectType !== 'Literal' && !visited.has(next)) {
                    visited.add(next); queue.push(next); result.push(triple);
                }
            });
        }
        return result;
    };
    const getObservationLineage = id => walk(id, 'out');
    const getRiskLineage = id => [...walk(id, 'in'), ...walk(id, 'out')];
    const getPolicyLineage = id => [...walk(id, 'in'), ...walk(id, 'out')];
    const getActionLineage = id => [...walk(id, 'in'), ...walk(id, 'out')];
    const getExecutionLineage = id => walk(id, 'in');
    function traceRuntimePath(start, end) {
        const allowed = new Set([RuntimeVocabulary.generatedRisk, RuntimeVocabulary.triggeredPolicy,
            RuntimeVocabulary.requestedAction, RuntimeVocabulary.dispatchedAction]);
        const queue = [[start]]; const visited = new Set([start]);
        while (queue.length) {
            const path = queue.shift(); const current = path[path.length - 1];
            if (current === end) return path;
            tripleStore.getRuntimeTriples().filter(item => item.subject === current && allowed.has(item.predicate))
                .forEach(item => { if (!visited.has(item.object)) { visited.add(item.object); queue.push([...path, item.object]); } });
        }
        return [];
    }
    function buildLineage(graph) {
        const nodes = graph.nodes || [];
        const latest = type => [...nodes].reverse().find(node => node.nodeType === type);
        const execution = latest('ActionExecution'); const executionData = execution && execution.metadata || {};
        const targetId = executionData.targetId;
        const risk = nodes.find(node => node.nodeId === `RiskEvent:${executionData.sourceEventId}`) || latest('RiskEvent');
        const policy = nodes.find(node => node.nodeId === `PolicyDecision:${executionData.sourceDecisionId}`) || latest('PolicyDecision');
        const action = nodes.find(node => node.nodeId === `ActionRequest:${executionData.actionId}`) || latest('ActionRequest');
        const observation = [...nodes].reverse().find(node => node.nodeType === 'Observation' &&
            (!targetId || node.metadata && node.metadata.targetId === targetId)) || latest('Observation');
        const metadata = (execution || observation || { metadata: {} }).metadata || {};
        const context = metadata.relationships && metadata.relationships.actionExecutionAppliesToVehicleContext || metadata;
        return { lineageId: execution ? `lineage:${execution.nodeId}` : null,
            observationId: observation && observation.nodeId, riskId: risk && risk.nodeId,
            policyId: policy && policy.nodeId, actionId: action && action.nodeId,
            executionId: execution && execution.nodeId, currentState: execution && execution.metadata.state,
            currentSeverity: risk && risk.metadata.severity, currentPriority: action && action.metadata.priority,
            assignment: context.driverAssignmentId || null, vehicle: context.vehicleId || null,
            driver: context.driverId || null };
    }

    function initializeRuntimeTripleViewer() {
        const panel = document.getElementById('runtimeTripleViewer');
        const graphOutput = document.getElementById('runtimeGraphJSON');
        if (!panel || !graphOutput) return null;
        let currentGraph = { nodes: [], edges: [] };
        const parseGraph = () => { try { return JSON.parse(graphOutput.textContent); } catch (_) { return currentGraph; } };
        const renderStore = () => {
            const triples = getRuntimeTriples(); const lineage = buildLineage(currentGraph);
            document.getElementById('runtimeTripleCount').textContent = String(triples.length);
            document.getElementById('runtimeCurrentTriples').textContent = JSON.stringify(triples, null, 2);
            document.getElementById('runtimeCurrentLineage').textContent = JSON.stringify(lineage, null, 2);
            document.getElementById('runtimeTripleTTL').textContent = tripleStore.exportTriplesTTL();
            document.getElementById('runtimeTripleJSON').textContent = tripleStore.exportTriplesJSON();
        };
        const render = () => { currentGraph = parseGraph(); syncFromRuntimeGraph(currentGraph); renderStore(); };
        const download = (name, type, content) => {
            const anchor = document.createElement('a'); anchor.download = name;
            anchor.href = URL.createObjectURL(new Blob([content], { type })); anchor.click();
            setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
        };
        document.getElementById('exportRuntimeTriplesJSON').addEventListener('click', () =>
            download('runtime-triples.json', 'application/json', tripleStore.exportTriplesJSON()));
        document.getElementById('exportRuntimeTriplesTTL').addEventListener('click', () =>
            download('runtime-triples.ttl', 'text/turtle', tripleStore.exportTriplesTTL()));
        document.getElementById('traceCurrentExecution').addEventListener('click', () => {
            const lineage = buildLineage(currentGraph); const path = lineage.observationId && lineage.executionId ?
                traceRuntimePath(lineage.observationId, lineage.executionId) : [];
            document.getElementById('runtimeCurrentLineage').textContent = JSON.stringify({ ...lineage, path }, null, 2);
        });
        document.getElementById('resetRuntimeTripleStore').addEventListener('click', () => { tripleStore.clear(); renderStore(); });
        const observer = new MutationObserver(render);
        observer.observe(graphOutput, { childList: true, characterData: true, subtree: true }); render();
        return Object.freeze({ store: tripleStore, builder: tripleBuilder, render, disconnect: () => observer.disconnect() });
    }

    global.RuntimeTripleEngine = Object.freeze({ RuntimeVocabulary, RuntimeTriple, TripleStore, TripleBuilder,
        tripleStore, tripleBuilder, syncFromRuntimeGraph, getRuntimeTriples, findTriples,
        findSubject: value => tripleStore.findSubject(value), findObject: value => tripleStore.findObject(value),
        findPredicate: value => tripleStore.findPredicate(value),
        exportTriplesJSON: space => tripleStore.exportTriplesJSON(space),
        exportTriplesTTL: () => tripleStore.exportTriplesTTL(), getObservationLineage, getRiskLineage,
        getPolicyLineage, getActionLineage, getExecutionLineage, traceRuntimePath,
        buildLineage, initializeRuntimeTripleViewer });
}(window));
