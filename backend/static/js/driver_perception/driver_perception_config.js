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
            dependencyMode: 'LOCAL_PINNED',
            source: 'LOCAL',
            assetManifestVersion: 'mediapipe-browser-assets-v1',
            packages: Object.freeze({
                cameraUtils: Object.freeze({ name: '@mediapipe/camera_utils', version: '0.3.1675466862' }),
                faceMesh: Object.freeze({ name: '@mediapipe/face_mesh', version: '0.4.1633559619' })
            }),
            cameraUtilsUrl: '/static/vendor/mediapipe/camera_utils/camera_utils.js',
            faceMeshUrl: '/static/vendor/mediapipe/face_mesh/face_mesh.js',
            assetBaseUrl: '/static/vendor/mediapipe/face_mesh/',
            requiredAssets: Object.freeze([
                'face_mesh.binarypb', 'face_mesh_solution_packed_assets_loader.js',
                'face_mesh_solution_packed_assets.data', 'face_mesh_solution_simd_wasm_bin.data',
                'face_mesh_solution_simd_wasm_bin.js', 'face_mesh_solution_simd_wasm_bin.wasm',
                'face_mesh_solution_wasm_bin.js', 'face_mesh_solution_wasm_bin.wasm'
            ]),
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
            geometryVersion: 'PERCEPTION_GEOMETRY_V2',
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
            blinkRearm: Object.freeze({
                version: 'DEVELOPMENT_UNVALIDATED_BLINK_REARM_CANDIDATE-v1',
                closeEntryRatio: 0.55, openRecoveryRatio: 0.65,
                entrySustainMs: 40, recoverySustainMs: 100,
                bilateralCorrelationMs: 140, invalidFrameTolerance: 2,
                maximumEpisodeDurationMs: 500, smoothingAlpha: 0.45
            }),
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
            profileVersion: 'PERCEPTION_GEOMETRY_V2',
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
