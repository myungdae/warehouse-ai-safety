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
        configurationVersion: 'driver-state-simulation-v1',
        drowsiness: candidateRule,
        incapacitation: candidateRule,
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
