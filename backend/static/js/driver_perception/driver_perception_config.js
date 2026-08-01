(function configureDriverPerception(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    namespace.Config = Object.freeze({
        configurationVersion: 'driver-perception-metrics-v1',
        operationalUseAllowed: false,
        processingLocation: 'BROWSER_LOCAL',
        imageStorageAllowed: false,
        imageTransmissionAllowed: false,
        mediaPipe: Object.freeze({
            dependencyMode: 'DEVELOPMENT_ONLY_CDN',
            // Preserved exactly from the smart source. These URLs are intentionally
            // unversioned and must be replaced by reviewed, pinned local assets
            // before operational or offline Edge deployment.
            cameraUtilsUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
            faceMeshUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
            assetBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/',
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.4,
            minTrackingConfidence: 0.4
        }),
        camera: Object.freeze({
            width: 640,
            height: 480,
            frameRate: 30
        }),
        metrics: Object.freeze({
            leftEyeIndices: Object.freeze([33, 160, 158, 133, 153, 144]),
            rightEyeIndices: Object.freeze([362, 385, 387, 263, 373, 380]),
            smoothingAlpha: 0.15,
            maxFrameGapMs: 500,
            perclosWindowMs: 180000,
            minimumPerclosValidMs: 3000,
            minimumPerclosValidRatio: 0.7,
            blink: Object.freeze({ minimumDurationMs: 80, maximumDurationMs: 500, rateWindowMs: 60000 }),
            headPose: Object.freeze({ downDegrees: 20, upDegrees: -10, yawDegrees: 18, method: 'HEURISTIC' })
        }),
        calibration: Object.freeze({
            durationMs: 3000,
            minimumSamples: 8,
            minimumOpenEar: 0.18,
            minimumBaseline: 0.18,
            thresholdRatio: 0.75,
            validationStatus: 'DEVELOPMENT_UNVALIDATED'
        })
    });
})(window);
