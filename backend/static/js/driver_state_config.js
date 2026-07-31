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
        configurationVersion: 'driver-state-simulation-v3',
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
            ...candidateRule,
            legalThresholdConfigured: false,
            jurisdiction: null,
            measurementUnit: null
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
