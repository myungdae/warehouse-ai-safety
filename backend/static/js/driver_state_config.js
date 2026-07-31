(function initializeDriverStateConfig(global) {
    'use strict';

    const candidateRule = Object.freeze({
        enterThreshold: null,
        clearThreshold: null,
        sustainMs: null,
        clearSustainMs: null,
        sampleWindowMs: null,
        status: 'UNVALIDATED_SIMULATION_CANDIDATE'
    });

    global.DriverStateConfig = Object.freeze({
        configurationVersion: 'driver-state-simulation-v4',
        drowsiness: Object.freeze({
            enterState: 'DROWSY',
            clearState: 'NORMAL',
            sustainMs: 250,
            clearSustainMs: 250,
            status: 'DETERMINISTIC_TEST_ONLY'
        }),
        incapacitation: Object.freeze({
            configurationVersion: 'driver-state-simulation-v3',
            sustainMs: 500,
            clearSustainMs: 500,
            minimumCompositeSignalCount: 3,
            requireVehicleMoving: true,
            requireQualityValid: true,
            operationalUseAllowed: false,
            status: 'UNVALIDATED_DETERMINISTIC_SIMULATION_CANDIDATE'
        }),
        alcohol: Object.freeze({
            configurationVersion: 'driver-state-simulation-v4',
            policyVersion: 'alcohol-deterministic-policy-v1',
            unit: 'simulation-level',
            entryThreshold: 0.05,
            clearThreshold: 0.02,
            sustainMs: 300,
            clearSustainMs: 300,
            modePolicies: Object.freeze({
                PRE_START: 'BLOCK_START',
                IN_OPERATION: 'SAFE_STOP_REQUEST'
            }),
            minimumSampleQuality: 0.8,
            requireIdentityVerified: true,
            requireCalibrationValid: true,
            maximumRetryCount: 2,
            jurisdiction: 'UNSPECIFIED_SIMULATION',
            operationalUseAllowed: false,
            legalThresholdConfigured: false,
            status: 'UNVALIDATED_DETERMINISTIC_SIMULATION_CANDIDATE'
        }),
        quality: Object.freeze({
            minimumConfidence: null,
            minimumValidSampleRatio: null,
            status: 'NOT_CONFIGURED'
        }),
        simulation: Object.freeze({
            enabled: true,
            deterministic: true,
            sensorConnected: false,
            operationalUseAllowed: false,
            sequenceIntervalMs: 250
        })
    });
}(window));
