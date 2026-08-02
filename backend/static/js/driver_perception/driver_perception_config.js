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
            mouthIndices: Object.freeze({
                corners: Object.freeze([61, 291]),
                verticalPairs: Object.freeze([Object.freeze([13, 14]), Object.freeze([81, 178]), Object.freeze([311, 402])]),
                contour: Object.freeze([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]),
                source: 'Smart MAR 13/14 and 61/291; additional pairs from MediaPipe FACEMESH_LIPS connections'
            }),
            smoothingAlpha: 0.15,
            marSmoothingAlpha: 0.35,
            maxFrameGapMs: 500,
            perclosWindowMs: 180000,
            minimumPerclosValidMs: 3000,
            minimumPerclosValidRatio: 0.7,
            blink: Object.freeze({ minimumDurationMs: 80, maximumDurationMs: 500, rateWindowMs: 60000 }),
            headPose: Object.freeze({ downDegrees: 20, upDegrees: -10, yawDegrees: 18, method: 'HEURISTIC' })
        }),
        yawn: Object.freeze({
            validationStatus: 'DEVELOPMENT_UNVALIDATED_MAR_CANDIDATE',
            mouthOpenThresholdRatio: 1.8, mouthOpenThresholdOffset: 0.08,
            minimumCalibrationSamples: 6, maximumNeutralMar: 0.28,
            mouthOpenMinimumMs: 500, yawnConfirmationMs: 1000,
            yawnClearMs: 300, maximumValidYawnMs: 10000, staleSampleMs: 500,
            maximumAbsoluteYaw: 30, maximumAbsoluteRoll: 25, maximumAbsolutePitch: 30
        }),
        calibration: Object.freeze({
            durationMs: 3000,
            minimumSamples: 8,
            minimumOpenEar: 0.18,
            minimumBaseline: 0.18,
            thresholdRatio: 0.75,
            validationStatus: 'DEVELOPMENT_UNVALIDATED'
        }),
        liveDrowsinessConfig: Object.freeze({
            validationStatus: 'UNVALIDATED_LIVE_WEBCAM_CANDIDATE',
            entrySustainMs: 1500,
            clearSustainMs: 2000,
            maximumSampleAgeMs: 1000,
            perclosEntryPercent: 40,
            prolongedEyeClosureMs: 1200
        }),
        recorder: Object.freeze({
            validationStatus: 'DEVELOPMENT_RESEARCH_CANDIDATE',
            schemaVersion: 'perception-dataset-v1', recorderVersion: '1.0.0',
            defaultSamplingMode: 'HYBRID', baseSamplingIntervalMs: 200,
            activeEpisodeIntervalMs: 50, maximumRowsPerSession: 20000,
            maximumSessionDurationMs: 1800000
        })
    });
})(window);
