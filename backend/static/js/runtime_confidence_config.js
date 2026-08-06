(function defineRuntimeConfidenceConfig(global) {
    'use strict';
    global.RuntimeConfidenceConfig = Object.freeze({
        configurationVersion: 'UNVALIDATED_RUNTIME_CONFIDENCE_CANDIDATE-v1',
        confidenceVersion: '1.0.0',
        bands: Object.freeze({ VERY_LOW:[0,24], LOW:[25,44], MEDIUM:[45,64], HIGH:[65,84], VERY_HIGH:[85,100] }),
        weights: Object.freeze({ measurement:0.24, sensorHealth:0.16, identity:0.20, freshness:0.14, contextCompleteness:0.16, agreement:0.10 }),
        freshness: Object.freeze({ freshThresholdMs:1000, degradedThresholdMs:3000, staleThresholdMs:10000, expiredThresholdMs:30000 }),
        penalties: Object.freeze({ identityConflict:30, missingRequiredContext:20, sensorDisagreement:18 }),
        decision: Object.freeze({ highRiskScore:65, criticalRiskScore:85, highConfidence:65, lowConfidence:44 })
    });
})(window);
