(function initializeRuntimeEventGraph(global) {
    'use strict';

    const NodeType = Object.freeze({
        OBSERVATION: 'Observation', RISK_EVENT: 'RiskEvent', POLICY_DECISION: 'PolicyDecision',
        ACTION_REQUEST: 'ActionRequest', ACTION_EXECUTION: 'ActionExecution', VEHICLE: 'Vehicle',
        DRIVER: 'Driver', ADAPTER: 'Adapter'
    });
    const EdgeType = Object.freeze({
        GENERATED: 'GENERATED', TRIGGERED: 'TRIGGERED', REQUESTED: 'REQUESTED',
        DISPATCHED: 'DISPATCHED', EXECUTED: 'EXECUTED', APPLIES_TO: 'APPLIES_TO',
        CONCERNS: 'CONCERNS', PRODUCED_BY: 'PRODUCED_BY', DERIVED_FROM: 'DERIVED_FROM',
        ACKNOWLEDGED_BY: 'ACKNOWLEDGED_BY', COMPLETED_BY: 'COMPLETED_BY'
    });
    const clone = value => JSON.parse(JSON.stringify(value));
    const timestamp = value => new Date(value || Date.now()).toISOString();
    const artifactNodeId = (type, id) => `${type}:${id}`;

    class RuntimeNode {
        constructor({ nodeId, nodeType, createdTime = new Date(), updatedTime = createdTime, metadata = {} }) {
            if (!nodeId || !Object.values(NodeType).includes(nodeType)) throw new TypeError('RuntimeNode requires valid nodeId and nodeType');
            this.nodeId = String(nodeId); this.nodeType = nodeType;
            this.createdTime = timestamp(createdTime); this.updatedTime = timestamp(updatedTime);
            this.metadata = clone(metadata);
        }
        toJSON() { return clone({ ...this }); }
    }

    class RuntimeEdge {
        constructor({ edgeId, from, to, relation, createdTime = new Date(), metadata = {} }) {
            if (!edgeId || !from || !to || !Object.values(EdgeType).includes(relation)) {
                throw new TypeError('RuntimeEdge requires valid edgeId, endpoints, and relation');
            }
            this.edgeId = String(edgeId); this.from = String(from); this.to = String(to);
            this.relation = relation; this.createdTime = timestamp(createdTime); this.metadata = clone(metadata);
        }
        toJSON() { return clone({ ...this }); }
    }

    class RuntimeGraph {
        constructor() {
            this.nodes = new Map(); this.edges = new Map();
            this.latestObservationByTarget = new Map();
        }

        addNode(nodeInput) {
            const node = nodeInput instanceof RuntimeNode ? nodeInput : new RuntimeNode(nodeInput);
            const existing = this.nodes.get(node.nodeId);
            if (existing) {
                existing.updatedTime = node.updatedTime;
                existing.metadata = { ...existing.metadata, ...clone(node.metadata) };
                return existing;
            }
            this.nodes.set(node.nodeId, node); return node;
        }

        addEdge(edgeInput) {
            const edge = edgeInput instanceof RuntimeEdge ? edgeInput : new RuntimeEdge(edgeInput);
            if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) return null;
            const key = `${edge.from}|${edge.relation}|${edge.to}`;
            const existing = this.edges.get(key);
            if (existing) { existing.metadata = { ...existing.metadata, ...clone(edge.metadata) }; return existing; }
            this.edges.set(key, edge); return edge;
        }

        connect(from, to, relation, metadata = {}, createdTime = new Date()) {
            return this.addEdge({ edgeId: `edge:${from}:${relation}:${to}`, from, to, relation, createdTime, metadata });
        }

        addContext(context, targetNodeId, createdTime) {
            if (!context) return;
            const vehicleId = context.vehicleId;
            const driverId = context.driverId;
            const assignmentId = context.driverAssignmentId || null;
            if (vehicleId) {
                const vehicleNode = this.addNode({ nodeId: artifactNodeId(NodeType.VEHICLE, vehicleId),
                    nodeType: NodeType.VEHICLE, createdTime, metadata: { vehicleId, vehicleType: context.vehicleType || null } });
                this.connect(vehicleNode.nodeId, targetNodeId, EdgeType.APPLIES_TO, { targetId: context.targetId || null }, createdTime);
            }
            if (driverId) {
                const identity = `${driverId}|${assignmentId || 'UNASSIGNED'}`;
                const driverNode = this.addNode({ nodeId: artifactNodeId(NodeType.DRIVER, identity),
                    nodeType: NodeType.DRIVER, createdTime, metadata: { driverId, driverAssignmentId: assignmentId } });
                this.connect(driverNode.nodeId, targetNodeId, EdgeType.CONCERNS, { targetId: context.targetId || null }, createdTime);
            }
        }

        recordObservation(input) {
            const value = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            if (!value || !value.observationId) return null;
            const id = artifactNodeId(NodeType.OBSERVATION, value.observationId);
            const node = this.addNode({ nodeId: id, nodeType: NodeType.OBSERVATION,
                createdTime: value.observedAt, updatedTime: value.observedAt, metadata: value });
            if (value.targetId) this.latestObservationByTarget.set(value.targetId, id);
            this.addContext({ ...value.metadata, targetId: value.targetId }, id, value.observedAt);
            return node;
        }

        recordRiskEvent(input, observationId = null) {
            const value = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            if (!value || !value.eventId) return null;
            const id = artifactNodeId(NodeType.RISK_EVENT, value.eventId);
            const node = this.addNode({ nodeId: id, nodeType: NodeType.RISK_EVENT,
                createdTime: value.createdTime, updatedTime: value.updatedTime, metadata: value });
            const observationNodeId = observationId
                ? artifactNodeId(NodeType.OBSERVATION, observationId)
                : this.latestObservationByTarget.get(value.targetId);
            if (observationNodeId) this.connect(observationNodeId, id, EdgeType.GENERATED,
                { observationGeneratedRiskEvent: true }, value.createdTime);
            return node;
        }

        recordPolicyDecision(input) {
            const value = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            if (!value || !value.decisionId) return null;
            const id = artifactNodeId(NodeType.POLICY_DECISION, value.decisionId);
            const node = this.addNode({ nodeId: id, nodeType: NodeType.POLICY_DECISION,
                createdTime: value.createdTime, updatedTime: value.updatedTime, metadata: value });
            const source = artifactNodeId(NodeType.RISK_EVENT, value.sourceEventId);
            if (value.sourceEventId && !this.nodes.has(source)) {
                this.addNode({ nodeId: source, nodeType: NodeType.RISK_EVENT, createdTime: value.createdTime,
                    metadata: { eventId: value.sourceEventId, targetId: value.targetId, inferredFromPolicyDecision: true } });
                const observation = this.latestObservationByTarget.get(value.targetId);
                if (observation) this.connect(observation, source, EdgeType.GENERATED,
                    { inferredFromPolicyDecision: true }, value.createdTime);
            }
            this.connect(source, id, EdgeType.TRIGGERED, { reasonCodes: value.reasonCodes || [] }, value.createdTime);
            this.connect(id, source, EdgeType.DERIVED_FROM, { configurationVersion: value.configurationVersion }, value.createdTime);
            return node;
        }

        recordActionRequest(input) {
            const value = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            if (!value || !value.actionId) return null;
            const id = artifactNodeId(NodeType.ACTION_REQUEST, value.actionId);
            const node = this.addNode({ nodeId: id, nodeType: NodeType.ACTION_REQUEST,
                createdTime: value.createdTime, updatedTime: value.updatedTime, metadata: value });
            const source = artifactNodeId(NodeType.POLICY_DECISION, value.sourceDecisionId);
            if (value.sourceDecisionId && !this.nodes.has(source)) {
                this.addNode({ nodeId: source, nodeType: NodeType.POLICY_DECISION, createdTime: value.createdTime,
                    metadata: { decisionId: value.sourceDecisionId, sourceEventId: value.sourceEventId,
                        targetId: value.targetId, inferredFromActionRequest: true } });
            }
            this.connect(source, id, EdgeType.REQUESTED, { sourceEventId: value.sourceEventId }, value.createdTime);
            return node;
        }

        recordActionExecution(input) {
            const value = input && typeof input.toJSON === 'function' ? input.toJSON() : clone(input);
            if (!value || !value.executionId) return null;
            const updated = value.completedTime || value.failedTime || value.cancelledTime || value.startedTime || value.requestedTime;
            const id = artifactNodeId(NodeType.ACTION_EXECUTION, value.executionId);
            const node = this.addNode({ nodeId: id, nodeType: NodeType.ACTION_EXECUTION,
                createdTime: value.requestedTime, updatedTime: updated, metadata: value });
            const action = artifactNodeId(NodeType.ACTION_REQUEST, value.actionId);
            if (value.actionId && !this.nodes.has(action)) {
                this.addNode({ nodeId: action, nodeType: NodeType.ACTION_REQUEST, createdTime: value.requestedTime,
                    metadata: { actionId: value.actionId, sourceEventId: value.sourceEventId,
                        sourceDecisionId: value.sourceDecisionId, targetId: value.targetId,
                        inferredFromActionExecution: true } });
            }
            this.connect(action, id, EdgeType.DISPATCHED, { dispatcherVersion:
                value.metadata && value.metadata.dispatcherVersion }, value.requestedTime);
            const adapterType = value.metadata && value.metadata.selectedAdapterType || value.adapterType;
            if (adapterType) {
                const adapter = this.addNode({ nodeId: artifactNodeId(NodeType.ADAPTER, adapterType),
                    nodeType: NodeType.ADAPTER, createdTime: value.startedTime || value.requestedTime,
                    metadata: { adapterType, simulation: value.simulation, actuatorConnected: value.actuatorConnected } });
                this.connect(adapter.nodeId, id, EdgeType.PRODUCED_BY, { result: value.result }, updated);
                this.connect(id, adapter.nodeId, EdgeType.EXECUTED, { state: value.state }, updated);
            }
            const context = value.metadata && value.metadata.relationships &&
                value.metadata.relationships.actionExecutionAppliesToVehicleContext;
            this.addContext({ ...context, targetId: value.targetId }, id, value.requestedTime);
            this.connect(id, artifactNodeId(NodeType.ACTION_REQUEST, value.actionId), EdgeType.DERIVED_FROM,
                { sourceEventId: value.sourceEventId, sourceDecisionId: value.sourceDecisionId }, updated);
            if (value.state === 'ACKNOWLEDGED' && context && context.driverId) {
                this.connect(id, artifactNodeId(NodeType.DRIVER,
                    `${context.driverId}|${context.driverAssignmentId || 'UNASSIGNED'}`), EdgeType.ACKNOWLEDGED_BY, {}, updated);
            }
            if (value.state === 'COMPLETED' && context && context.driverId) {
                this.connect(id, artifactNodeId(NodeType.DRIVER,
                    `${context.driverId}|${context.driverAssignmentId || 'UNASSIGNED'}`), EdgeType.COMPLETED_BY, {}, updated);
            }
            return node;
        }

        ingest(value) {
            if (!value) return null;
            if (value.observationId) return this.recordObservation(value);
            if (value.eventId) return this.recordRiskEvent(value);
            if (value.decisionId) return this.recordPolicyDecision(value);
            if (value.executionId) return this.recordActionExecution(value);
            if (value.actionId) return this.recordActionRequest(value);
            return null;
        }

        ingestRuntimeChain({ observation, riskEvent, policyDecision, actionRequest, actionExecution }) {
            const observationNode = this.recordObservation(observation);
            this.recordRiskEvent(riskEvent, observation && observation.observationId);
            this.recordPolicyDecision(policyDecision);
            this.recordActionRequest(actionRequest);
            this.recordActionExecution(actionExecution);
            return observationNode ? this.findRuntimePath(
                observationNode.nodeId,
                artifactNodeId(NodeType.ACTION_EXECUTION, actionExecution.executionId)
            ) : [];
        }

        getRuntimeNodes() { return Array.from(this.nodes.values()).map(node => node.toJSON()); }
        getRuntimeEdges() { return Array.from(this.edges.values()).map(edge => edge.toJSON()); }
        getRuntimeGraph() { return { nodes: this.getRuntimeNodes(), edges: this.getRuntimeEdges() }; }
        findRuntimeNode(nodeId) { const node = this.nodes.get(nodeId); return node ? node.toJSON() : null; }
        findRuntimePath(from, to) {
            if (!this.nodes.has(from) || !this.nodes.has(to)) return [];
            const queue = [[from]]; const visited = new Set([from]);
            while (queue.length) {
                const path = queue.shift(); const current = path[path.length - 1];
                if (current === to) return path.map(id => this.findRuntimeNode(id));
                Array.from(this.edges.values()).filter(edge => edge.from === current).forEach(edge => {
                    if (!visited.has(edge.to)) { visited.add(edge.to); queue.push([...path, edge.to]); }
                });
            }
            return [];
        }
        exportRuntimeGraphJSON(space = 2) { return JSON.stringify(this.getRuntimeGraph(), null, space); }
        clear() { this.nodes.clear(); this.edges.clear(); this.latestObservationByTarget.clear(); }
    }

    const runtimeGraph = new RuntimeGraph();
    const safeParse = element => { try { return element && JSON.parse(element.textContent); } catch (_) { return null; } };
    function initializeRuntimeGraphViewer() {
        const panel = document.getElementById('runtimeEventGraphViewer');
        if (!panel) return null;
        const watched = [
            'lastDriverObservation', 'driverRiskEventHistory', 'driverPolicyCurrentDecision',
            'driverPolicyPendingActions', 'driverActionAuditHistory'
        ].map(id => document.getElementById(id)).filter(Boolean);
        function collect() {
            const observation = safeParse(document.getElementById('lastDriverObservation'));
            if (observation && observation.observationId) runtimeGraph.recordObservation(observation);
            const events = safeParse(document.getElementById('driverRiskEventHistory'));
            (Array.isArray(events) ? events : []).forEach(event => runtimeGraph.recordRiskEvent(event));
            const decision = safeParse(document.getElementById('driverPolicyCurrentDecision'));
            if (decision && decision.decisionId) runtimeGraph.recordPolicyDecision(decision);
            const actions = global.DriverPolicyPage ? global.DriverPolicyPage.engine.getDriverActionRequests() : [];
            actions.forEach(action => runtimeGraph.recordActionRequest(action));
            const executions = global.DriverActionPage ? global.DriverActionPage.dispatcher.getDriverActionExecutions() : [];
            executions.forEach(execution => runtimeGraph.recordActionExecution(execution));
            render();
        }
        function render() {
            const graph = runtimeGraph.getRuntimeGraph();
            document.getElementById('runtimeGraphNodes').textContent = JSON.stringify(graph.nodes, null, 2);
            document.getElementById('runtimeGraphEdges').textContent = JSON.stringify(graph.edges, null, 2);
            document.getElementById('runtimeGraphJSON').textContent = runtimeGraph.exportRuntimeGraphJSON();
            const observation = [...graph.nodes].reverse().find(node => node.nodeType === NodeType.OBSERVATION);
            const execution = [...graph.nodes].reverse().find(node => node.nodeType === NodeType.ACTION_EXECUTION);
            const path = observation && execution ? runtimeGraph.findRuntimePath(observation.nodeId, execution.nodeId) : [];
            document.getElementById('runtimeGraphPath').textContent = path.length
                ? path.map(node => node.nodeType).join(' → ') : 'Observation → RiskEvent → PolicyDecision → ActionRequest → ActionExecution';
        }
        const observer = new MutationObserver(collect);
        watched.forEach(element => observer.observe(element, { childList: true, characterData: true, subtree: true }));
        collect();
        return Object.freeze({ graph: runtimeGraph, collect, render, disconnect: () => observer.disconnect() });
    }

    global.RuntimeEventGraph = Object.freeze({ NodeType, EdgeType, RuntimeNode, RuntimeEdge, RuntimeGraph,
        runtimeGraph, getRuntimeGraph: () => runtimeGraph.getRuntimeGraph(),
        getRuntimeNodes: () => runtimeGraph.getRuntimeNodes(), getRuntimeEdges: () => runtimeGraph.getRuntimeEdges(),
        findRuntimePath: (from, to) => runtimeGraph.findRuntimePath(from, to),
        findRuntimeNode: id => runtimeGraph.findRuntimeNode(id),
        exportRuntimeGraphJSON: space => runtimeGraph.exportRuntimeGraphJSON(space), initializeRuntimeGraphViewer });
}(window));
