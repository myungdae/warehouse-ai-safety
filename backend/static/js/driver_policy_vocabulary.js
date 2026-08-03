(function (global) {
    'use strict';
    const HazardSeverity = Object.freeze(['INFORMATIONAL', 'CAUTION', 'WARNING', 'URGENT', 'CRITICAL']);
    const DriverRecommendation = Object.freeze(['CONTINUE_MONITORING', 'LOOK_FORWARD', 'CHECK_SURROUNDINGS', 'REDUCE_SPEED', 'STOP_TURN_AND_CHECK', 'PREPARE_TO_REST', 'REST_WHEN_SAFE', 'STOP_WHEN_SAFE', 'DO_NOT_DRIVE', 'RESPOND_IF_OK', 'REQUEST_HELP_CANDIDATE', 'VERIFY_SENSOR']);
    const DeliveryStatus = Object.freeze(['NOT_REQUESTED', 'QUEUED', 'PLAYING', 'PLAYED', 'ACKNOWLEDGED', 'SUPPRESSED', 'PREEMPTED', 'EXPIRED', 'CANCELLED', 'UNAVAILABLE', 'ERROR']);
    const ConfidenceAction = Object.freeze(['MONITOR', 'VERIFY_FIRST', 'WARNING_WITH_CAUTION', 'ACTION_RECOMMENDED', 'HIGH_CONFIDENCE_ACTION_CANDIDATE', 'INSUFFICIENT_EVIDENCE']);
    const aliases = Object.freeze({ SAFE_STOP_RECOMMENDED: 'STOP_WHEN_SAFE', REST_RECOMMENDED: 'REST_WHEN_SAFE', DELIVERY_UNAVAILABLE: 'UNAVAILABLE', SYSTEM_DEGRADED: 'VERIFY_SENSOR', CRITICAL_WARNING: 'CRITICAL', HIGH_WARNING: 'WARNING', URGENT_WARNING: 'URGENT' });
    const all = new Set([...HazardSeverity, ...DriverRecommendation, ...DeliveryStatus, ...ConfidenceAction]);
    function canonicalize(term, audit) {
        if (typeof term !== 'string' || !term) return 'UNKNOWN';
        const canonical = aliases[term] || term;
        if (aliases[term]) audit?.({ eventType: 'POLICY_ALIAS_RESOLVED', alias: term, canonical, operationalUseAllowed: false });
        return all.has(canonical) ? canonical : 'UNKNOWN';
    }
    global.DriverPolicyVocabulary = Object.freeze({ schemaVersion: '1.0.0', HazardSeverity, DriverRecommendation, DeliveryStatus, ConfidenceAction, aliases, canonicalize, isCanonical: term => all.has(term), operationalUseAllowed: false });
}(window));
