(function initializeDriverPolicyConfig(global) {
    'use strict';

    global.DriverPolicyConfig = Object.freeze({
        policyVersion: 'driver-policy-simulation-v1',
        configurationVersion: 'driver-policy-simulation-config-v1',
        status: 'UNVALIDATED_DETERMINISTIC_SIMULATION_CANDIDATE',
        simulation: true,
        operationalUseAllowed: false,
        actuatorConnected: false,
        externalNotificationConnected: false,
        actionDeduplicationWindowMs: 1000,
        eventPriority: Object.freeze({
            DRIVER_INCAPACITATION: 300,
            ALCOHOL_POLICY_VIOLATION: 200,
            DROWSINESS: 100
        }),
        actionPriority: Object.freeze({
            EMERGENCY_RESPONSE_REQUEST: 900,
            SAFE_STOP_REQUEST: 800,
            BLOCK_START_REQUEST: 750,
            SUPERVISOR_NOTIFICATION_REQUEST: 700,
            BEACON_REQUEST: 600,
            SEAT_VIBRATION_REQUEST: 500,
            VOICE_WARNING: 400,
            VISUAL_WARNING: 300,
            RETEST_REQUEST: 200
        }),
        drowsiness: Object.freeze({
            stage1Ms: 250,
            stage2Ms: 500,
            stage3Ms: 750,
            acknowledgeSuppressesRepeatedWarnings: true
        }),
        incapacitation: Object.freeze({
            emergencyEscalationMs: 500,
            acknowledgeKeepsSafetyRequests: true
        }),
        alcohol: Object.freeze({
            reuseObservationPolicyDecision: true
        }),
        clearPolicy: Object.freeze({
            completeDispatchedActions: true,
            cancelRequestedActions: true
        })
    });
}(window));
