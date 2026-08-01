(function defineDriverMetricSnapshot(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const deepFreeze = value => {
        if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
        Object.values(value).forEach(deepFreeze);
        return Object.freeze(value);
    };
    const safeNumber = value => Number.isFinite(value) ? value : null;

    function createDriverMetricSnapshot({ frame, metrics, calibration, now = Date.now() }) {
        const frameTime = Date.parse(frame.timestamp);
        const snapshot = {
            timestamp: new Date(now).toISOString(),
            source: 'live-webcam',
            cameraId: frame.cameraId || null,
            faceDetected: frame.faceDetected === true,
            calibrated: calibration.calibrated === true,
            calibrationState: calibration.state,
            metrics: {
                leftEAR: safeNumber(metrics.leftEAR), rightEAR: safeNumber(metrics.rightEAR), ear: safeNumber(metrics.ear),
                earBaseline: safeNumber(calibration.baseline), earThreshold: safeNumber(calibration.threshold),
                eyeClosed: typeof metrics.eyeClosed === 'boolean' ? metrics.eyeClosed : null,
                eyeClosureDurationMs: safeNumber(metrics.eyeClosureDurationMs), blinkCount: metrics.blinkCount,
                blinkRate: safeNumber(metrics.blinkRate), lastBlinkDurationMs: safeNumber(metrics.lastBlinkDurationMs),
                perclos: safeNumber(metrics.perclos), pitch: safeNumber(metrics.pitch), roll: safeNumber(metrics.roll),
                yaw: safeNumber(metrics.yaw), headPoseState: metrics.headPoseState || 'UNKNOWN'
            },
            quality: {
                earValid: metrics.earValid === true, perclosValid: metrics.perclosValid === true,
                headPoseValid: metrics.headPoseValid === true, landmarkAvailable: frame.faceDetected === true && Array.isArray(frame.landmarks) && frame.landmarks.length > 0,
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
