(function initializeDriverActionConfig(global) {
    'use strict';
    global.DriverActionConfig = Object.freeze({
        configurationVersion: 'driver-action-simulation-config-v1',
        dispatcherVersion: 'driver-action-dispatcher-simulation-v1',
        status: 'UNVALIDATED_DETERMINISTIC_SIMULATION_CANDIDATE',
        simulation: true,
        operationalUseAllowed: false,
        actuatorConnected: false,
        externalSystemConnected: false,
        vehicleControlConnected: false,
        dispatchDelayMs: 100,
        simulationDurationMs: 150,
        acknowledgementTimeoutMs: 500,
        retryLimit: 1,
        deduplicationWindowMs: 1000,
        priorityOrder: Object.freeze([
            'EMERGENCY_RESPONSE_REQUEST', 'SAFE_STOP_REQUEST', 'BLOCK_START_REQUEST',
            'SUPERVISOR_NOTIFICATION_REQUEST', 'BEACON_REQUEST', 'SEAT_VIBRATION_REQUEST',
            'VOICE_WARNING', 'VISUAL_WARNING', 'RETEST_REQUEST'
        ]),
        adapterRouting: Object.freeze({
            VOICE_WARNING: 'VoiceWarningAdapter', VISUAL_WARNING: 'VisualWarningAdapter',
            SEAT_VIBRATION_REQUEST: 'SeatVibrationAdapter', BEACON_REQUEST: 'BeaconAdapter',
            SUPERVISOR_NOTIFICATION_REQUEST: 'SupervisorNotificationAdapter', RETEST_REQUEST: 'RetestAdapter',
            BLOCK_START_REQUEST: 'VehicleControlRequestAdapter', SAFE_STOP_REQUEST: 'VehicleControlRequestAdapter',
            EMERGENCY_RESPONSE_REQUEST: 'EmergencyResponseRequestAdapter'
        })
    });
}(window));
