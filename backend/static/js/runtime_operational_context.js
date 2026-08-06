(function defineRuntimeOperationalContext(global) {
    'use strict';

    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const iso = value => {
        const time = Date.parse(value);
        if (!Number.isFinite(time)) throw new TypeError('A valid timestamp is required');
        return new Date(time).toISOString();
    };
    const text = (value, name) => {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
        return value.trim();
    };
    const freezeRecord = instance => Object.freeze(instance);
    const ConditionType = Object.freeze({ RIGHT_TURN_ACTIVE: 'RIGHT_TURN_ACTIVE' });

    class ContextCondition {
        constructor(input) {
            if (!input || typeof input !== 'object') throw new TypeError('ContextCondition input is required');
            this.conditionId = text(input.conditionId, 'conditionId');
            this.conditionType = text(input.conditionType, 'conditionType');
            this.targetId = text(input.targetId, 'targetId');
            this.driverAssignmentId = input.driverAssignmentId || null;
            this.value = clone(input.value);
            this.sourceObservationId = input.sourceObservationId || null;
            this.timestamp = iso(input.timestamp);
            this.validUntil = iso(input.validUntil);
            this.quality = clone(input.quality || { confidenceAvailable: false });
            this.operationalContext = clone(input.operationalContext || null);
            this.simulation = input.simulation === true;
            this.confidence = Number.isFinite(input.confidence) ? input.confidence : null;
            this.confidenceAvailable = input.confidenceAvailable === true;
            this.operationalUseAllowed = false;
            freezeRecord(this);
        }
        toJSON() { return clone({ ...this }); }
    }

    class OperationalContext {
        constructor(input) {
            if (!input || typeof input !== 'object') throw new TypeError('OperationalContext input is required');
            Object.assign(this, clone(input));
            this.contextId = text(input.contextId, 'contextId');
            this.targetId = text(input.targetId, 'targetId');
            this.contextVersion = text(input.contextVersion, 'contextVersion');
            this.createdAt = iso(input.createdAt); this.updatedAt = iso(input.updatedAt);
            this.windowStart = iso(input.windowStart); this.windowEnd = iso(input.windowEnd);
            this.activeRiskEventIds = Object.freeze([...(input.activeRiskEventIds || [])]);
            this.activeRiskTypes = Object.freeze([...(input.activeRiskTypes || [])]);
            this.observations = Object.freeze(clone(input.observations || []));
            this.conditions = Object.freeze(clone(input.conditions || []));
            this.source = 'runtime-fusion'; this.operationalUseAllowed = false;
            freezeRecord(this);
        }
        toJSON() { return clone({ ...this }); }
    }

    class CompositeRisk {
        constructor(input) {
            if (!input || typeof input !== 'object') throw new TypeError('CompositeRisk input is required');
            Object.assign(this, clone(input));
            this.compositeRiskId = text(input.compositeRiskId, 'compositeRiskId');
            this.contextId = text(input.contextId, 'contextId');
            this.targetId = text(input.targetId, 'targetId');
            this.createdAt = iso(input.createdAt); this.updatedAt = iso(input.updatedAt);
            this.contributingRiskEventIds = Object.freeze([...(input.contributingRiskEventIds || [])]);
            this.contributingRiskTypes = Object.freeze([...(input.contributingRiskTypes || [])]);
            this.contributingConditions = Object.freeze(clone(input.contributingConditions || []));
            this.reasonCodes = Object.freeze([...(input.reasonCodes || [])]);
            this.recommendedActions = Object.freeze([...(input.recommendedActions || [])]);
            this.operationalUseAllowed = false;
            freezeRecord(this);
        }
        toJSON() { return clone({ ...this }); }
    }

    class PriorityDecision {
        constructor(input) {
            if (!input || typeof input !== 'object') throw new TypeError('PriorityDecision input is required');
            Object.assign(this, clone(input));
            this.priorityDecisionId = text(input.priorityDecisionId, 'priorityDecisionId');
            this.compositeRiskId = text(input.compositeRiskId, 'compositeRiskId');
            this.targetId = text(input.targetId, 'targetId');
            this.createdAt = iso(input.createdAt);
            this.reasonCodes = Object.freeze([...(input.reasonCodes || [])]);
            this.recommendedActions = Object.freeze([...(input.recommendedActions || [])]);
            this.simulation = true; this.actuatorConnected = false; this.operationalUseAllowed = false;
            freezeRecord(this);
        }
        toJSON() { return clone({ ...this }); }
    }

    global.RuntimeOperationalContext = Object.freeze({
        ConditionType, ContextCondition, OperationalContext, CompositeRisk, PriorityDecision
    });
})(window);
