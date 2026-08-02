(function defineDriverMetricSnapshot(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const deepFreeze = value => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.values(value).forEach(deepFreeze);
        return Object.freeze(value);
    };
    const safeNumber = value => Number.isFinite(value) ? value : null;
    let snapshotSequence = 0;

    function createDriverMetricSnapshot({ frame, metrics, calibration, now = Date.now() }) {
        const frameTime = Date.parse(frame.timestamp);
        snapshotSequence += 1;
        const snapshot = {
            driverMetricSnapshotId: `driver-metric-${Number(now)}-${snapshotSequence}`,
            timestamp: new Date(now).toISOString(),
            source: 'live-webcam',
            cameraId: frame.cameraId || null,
            faceDetected: frame.faceDetected === true,
            calibrated: calibration.calibrated === true,
            calibrationState: calibration.state,
            metrics: {
                leftEAR: safeNumber(metrics.leftEAR), rightEAR: safeNumber(metrics.rightEAR), rawEar: safeNumber(metrics.rawEar), ear: safeNumber(metrics.ear),
                earBaseline: safeNumber(calibration.baseline), earThreshold: safeNumber(calibration.threshold),
                eyeClosed: typeof metrics.eyeClosed === 'boolean' ? metrics.eyeClosed : null,
                eyeClosureDurationMs: safeNumber(metrics.eyeClosureDurationMs), blinkCount: metrics.blinkCount,
                blinkRate: safeNumber(metrics.blinkRate), lastBlinkDurationMs: safeNumber(metrics.lastBlinkDurationMs),
                perclos: safeNumber(metrics.perclos), pitch: safeNumber(metrics.pitch), roll: safeNumber(metrics.roll),
                yaw: safeNumber(metrics.yaw), headPoseState: metrics.headPoseState || 'UNKNOWN',
                mar: safeNumber(metrics.mar), marRaw: safeNumber(metrics.marRaw), marSmoothed: safeNumber(metrics.marSmoothed),
                mouthBaseline: safeNumber(calibration.mouthBaseline), mouthOpenThreshold: safeNumber(calibration.mouthOpenThreshold),
                mouthOpen: typeof metrics.mouthOpen === 'boolean' ? metrics.mouthOpen : null,
                mouthOpenDurationMs: safeNumber(metrics.mouthOpenDurationMs), yawnCandidate: metrics.yawnCandidate === true,
                yawnConfirmed: metrics.yawnConfirmed === true, yawnCount: Number.isInteger(metrics.yawnCount) ? metrics.yawnCount : 0,
                lastYawnDurationMs: safeNumber(metrics.lastYawnDurationMs), yawnState: metrics.yawnState || 'INVALID'
            },
            diagnostics: {
                eye: {
                    rawEAR: safeNumber(metrics.rawEar), smoothedEAR: safeNumber(metrics.ear), activeEARThreshold: safeNumber(calibration.threshold),
                    bothEyesClosed: metrics.bothEyesClosed === true, leftEyeClosed: metrics.leftEyeClosed, rightEyeClosed: metrics.rightEyeClosed,
                    eyeClosureStartTimestamp: metrics.eyeClosedSince === null || metrics.eyeClosedSince === undefined ? null : new Date(metrics.eyeClosedSince).toISOString(),
                    currentClosureDurationMs: safeNumber(metrics.eyeClosureDurationMs), lastClosureDurationMs: safeNumber(metrics.lastClosureDurationMs),
                    blinkCandidate: metrics.blinkCandidate === true, blinkAccepted: metrics.blinkAccepted === true,
                    blinkRejectReason: metrics.blinkRejectReason || null, frameDeltaMs: safeNumber(metrics.frameDeltaMs),
                    validFrameCountDuringClosure: metrics.validFrameCountDuringClosure || 0,
                    invalidFrameCountDuringClosure: metrics.invalidFrameCountDuringClosure || 0
                },
                mouth: {
                    mouthWidth: safeNumber(metrics.mouthWidth), verticalDistances: [safeNumber(metrics.mouthVerticalDistance1), safeNumber(metrics.mouthVerticalDistance2), safeNumber(metrics.mouthVerticalDistance3)],
                    marRaw: safeNumber(metrics.marRaw), marSmoothed: safeNumber(metrics.marSmoothed), marValid: metrics.marValid === true,
                    marInvalidReason: metrics.marInvalidReason || null, mouthLandmarksAvailable: metrics.mouthLandmarksAvailable === true,
                    mouthGeometryValid: metrics.mouthGeometryValid === true, headPoseAllowsMouthMetric: metrics.headPoseAllowsMouthMetric === true,
                    calibrationAccepted: calibration.mouthSampleCount || 0, calibrationRejected: calibration.mouthRejectedSampleCount || 0,
                    lastCalibrationRejectReason: calibration.lastMouthRejectReason || null,
                    calibrationState: calibration.mouthCalibrationState || 'UNAVAILABLE', baselineReady: calibration.mouthCalibrationAvailable === true
                },
                quality: { faceDetected: frame.faceDetected === true, landmarkAvailable: frame.faceDetected === true && Array.isArray(frame.landmarks) && frame.landmarks.length > 0,
                    sampleAgeMs: Number.isFinite(frameTime) ? Math.max(0, now - frameTime) : null, processingTimeMs: safeNumber(frame.processingTimeMs) }
            },
            quality: {
                earValid: metrics.earValid === true, perclosValid: metrics.perclosValid === true,
                headPoseValid: metrics.headPoseValid === true, landmarkAvailable: frame.faceDetected === true && Array.isArray(frame.landmarks) && frame.landmarks.length > 0,
                marValid: metrics.marValid === true, mouthCalibrationAvailable: calibration.mouthCalibrationAvailable === true,
                yawnMetricAvailable: metrics.marValid === true && calibration.mouthCalibrationAvailable === true,
                sampleAgeMs: Number.isFinite(frameTime) ? Math.max(0, now - frameTime) : null
            },
            runtime: { processingTimeMs: safeNumber(frame.processingTimeMs), frameTimestamp: frame.timestamp },
            privacy: { imageStored: false, imageTransmitted: false, browserLocalProcessing: true },
            operationalUseAllowed: false
        };
        return deepFreeze(snapshot);
    }

    namespace.createDriverMetricSnapshot = createDriverMetricSnapshot;
})(window);
