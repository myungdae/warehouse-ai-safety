(function (global) {
    'use strict';
    const scopes = Object.freeze(['TARGET', 'ASSIGNMENT', 'SENSOR', 'CAMERA', 'PERCEPTION', 'VOICE', 'MEMORY', 'COMPANION', 'HARDWARE', 'FULL_RUNTIME']);
    class RuntimeResetCoordinator {
        constructor({ now = () => Date.now() } = {}) { this.now = now; this.modules = new Map(); this.generations = new Map(); this.history = []; this.inProgress = new Set(); this.sequence = 0; }
        register(name, handler, supportedScopes = scopes) { if (!name || !handler) throw new TypeError('Reset module name and handler required'); this.modules.set(name, { handler, supportedScopes: new Set(supportedScopes) }); return this; }
        generation(target, assignment) { return this.generations.get(`${target || '*'}|${assignment || '*'}`) || 0; }
        isBlocked(target, assignment) { return this.inProgress.has(`${target || '*'}|${assignment || '*'}`); }
        async reset(input) {
            if (!scopes.includes(input?.scope)) throw new RangeError('Unsupported reset scope');
            const key = `${input.canonicalTargetId || '*'}|${input.assignmentId || '*'}`; if (this.inProgress.has(key)) throw new Error('RESET_ALREADY_IN_PROGRESS');
            this.inProgress.add(key); const before = this.generation(input.canonicalTargetId, input.assignmentId), completed = [], failed = [], affected = [];
            const report = { resetId: input.resetId || `runtime-reset-${++this.sequence}`, scope: input.scope, canonicalTargetId: input.canonicalTargetId || null, assignmentId: input.assignmentId || null,
                reasonCode: input.reasonCode || 'OPERATIONAL_DISCONTINUITY', requestedAt: new Date(input.requestedAt || this.now()).toISOString(), generationBefore: before, generationAfter: before,
                affectedModules: affected, completedModules: completed, failedModules: failed, status: 'IN_PROGRESS', simulation: true, operationalUseAllowed: false };
            for (const [name, module] of this.modules) { if (!module.supportedScopes.has(input.scope) && input.scope !== 'FULL_RUNTIME') continue; affected.push(name); try { await module.handler(input); completed.push(name); } catch (error) { failed.push({ module: name, reason: error.message }); } }
            const after = before + 1; this.generations.set(key, after); report.generationAfter = after; report.status = failed.length ? 'PARTIAL_FAILURE' : 'COMPLETED'; this.inProgress.delete(key); this.history.push(JSON.parse(JSON.stringify(report))); return JSON.parse(JSON.stringify(report));
        }
        getHistory() { return JSON.parse(JSON.stringify(this.history)); }
    }
    global.RuntimeResetCoordinator = Object.freeze({ scopes, RuntimeResetCoordinator, create: options => new RuntimeResetCoordinator(options) });
}(window));
