(function defineDriverMetricCalculator(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const finite = value => Number.isFinite(value);
    const pointValid = point => point && finite(point.x) && finite(point.y) && finite(point.z || 0);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    class DriverMetricCalculator {
        constructor(config = {}) {
            this.config = { ...config, yawn: config.yawn || namespace.Config?.yawn || {} };
            this.smoothed = { ear: null, pitch: null, roll: null, yaw: null, mar: null };
            this.eyeClosedSince = null;
            this.lastEyeClosed = false;
            this.blinkCount = 0;
            this.lastBlinkDurationMs = null;
            this.lastClosureDurationMs = null;
            this.blinkTimestamps = [];
            this.perclosSegments = [];
            this.previousSample = null;
            this.firstSampleAt = null;
            this._resetYawn();
            this.lastFrameTimestamp = null;
            this.blinkDiagnostics = {};
        }

        static computeEyeEAR(landmarks, indices) {
            if (!Array.isArray(landmarks) || !indices.every(index => pointValid(landmarks[index]))) return null;
            const points = indices.map(index => landmarks[index]);
            const horizontal = distance(points[0], points[3]);
            if (!finite(horizontal) || horizontal <= Number.EPSILON) return null;
            const result = (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal);
            return finite(result) && result > 0 ? result : null;
        }

        static computeMouthMAR(landmarks, mouthIndices) {
            return DriverMetricCalculator.computeMouthGeometry(landmarks, mouthIndices).marRaw;
        }

        static computeMouthGeometry(landmarks, mouthIndices) {
            const required = [...mouthIndices.corners, ...mouthIndices.verticalPairs.flat()];
            if (!Array.isArray(landmarks)) return { marRaw: null, mouthWidth: null, verticalDistances: [null, null, null], mouthLandmarksAvailable: false, mouthGeometryValid: false, invalidReason: 'FACE_NOT_DETECTED' };
            if (!required.every(index => pointValid(landmarks[index]))) return { marRaw: null, mouthWidth: null, verticalDistances: [null, null, null], mouthLandmarksAvailable: false, mouthGeometryValid: false, invalidReason: 'LANDMARK_MISSING' };
            const width = distance(landmarks[mouthIndices.corners[0]], landmarks[mouthIndices.corners[1]]);
            if (!finite(width)) return { marRaw: null, mouthWidth: width, verticalDistances: [null, null, null], mouthLandmarksAvailable: true, mouthGeometryValid: false, invalidReason: 'NON_FINITE_DISTANCE' };
            if (width <= Number.EPSILON) return { marRaw: null, mouthWidth: width, verticalDistances: [null, null, null], mouthLandmarksAvailable: true, mouthGeometryValid: false, invalidReason: 'MOUTH_WIDTH_TOO_SMALL' };
            const heights = mouthIndices.verticalPairs.map(([upper, lower]) => distance(landmarks[upper], landmarks[lower]));
            if (heights.some(value => !finite(value))) return { marRaw: null, mouthWidth: width, verticalDistances: heights, mouthLandmarksAvailable: true, mouthGeometryValid: false, invalidReason: 'NON_FINITE_DISTANCE' };
            const result = heights.reduce((sum, value) => sum + value, 0) / heights.length / width;
            return { marRaw: finite(result) && result >= 0 ? result : null, mouthWidth: width,
                verticalDistances: heights, mouthLandmarksAvailable: true,
                mouthGeometryValid: finite(result) && result >= 0, invalidReason: finite(result) && result >= 0 ? null : 'NON_FINITE_DISTANCE' };
        }

        _smooth(key, value) {
            if (!finite(value)) return null;
            const previous = this.smoothed[key];
            const alpha = key === 'mar' ? this.config.marSmoothingAlpha : this.config.smoothingAlpha;
            this.smoothed[key] = previous === null ? value : alpha * value + (1 - alpha) * previous;
            return this.smoothed[key];
        }

        computeHeadPose(landmarks) {
            const required = [1, 33, 263];
            if (!Array.isArray(landmarks) || !required.every(index => pointValid(landmarks[index]))) {
                return { pitch: null, roll: null, yaw: null, headPoseValid: false, headPoseState: 'UNKNOWN' };
            }
            const nose = landmarks[1], leftEye = landmarks[33], rightEye = landmarks[263];
            const eyeDistance = distance(leftEye, rightEye);
            if (!finite(eyeDistance) || eyeDistance <= Number.EPSILON) {
                return { pitch: null, roll: null, yaw: null, headPoseValid: false, headPoseState: 'UNKNOWN' };
            }
            const midX = (leftEye.x + rightEye.x) / 2;
            const midY = (leftEye.y + rightEye.y) / 2;
            const pitch = this._smooth('pitch', (nose.y - midY) / eyeDistance * 60);
            const yaw = this._smooth('yaw', (nose.x - midX) / eyeDistance * 60);
            const roll = this._smooth('roll', Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180 / Math.PI);
            const pose = this.config.headPose;
            let state = 'CENTER';
            if (pitch >= pose.downDegrees) state = 'DOWN';
            else if (pitch <= pose.upDegrees) state = 'UP';
            else if (yaw <= -pose.yawDegrees) state = 'LEFT';
            else if (yaw >= pose.yawDegrees) state = 'RIGHT';
            return { pitch, roll, yaw, headPoseValid: true, headPoseState: state };
        }

        _recordPerclos(timestamp, valid, closed) {
            if (this.firstSampleAt === null) this.firstSampleAt = timestamp;
            const previous = this.previousSample;
            if (previous) {
                const duration = timestamp - previous.timestamp;
                if (duration > 0 && duration <= this.config.maxFrameGapMs && previous.valid) {
                    this.perclosSegments.push({ start: previous.timestamp, end: timestamp, closed: previous.closed });
                }
            }
            this.previousSample = { timestamp, valid, closed };
            const cutoff = timestamp - this.config.perclosWindowMs;
            this.perclosSegments = this.perclosSegments
                .filter(segment => segment.end > cutoff)
                .map(segment => segment.start < cutoff ? { ...segment, start: cutoff } : segment);
            const validEyeTimeMs = this.perclosSegments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
            const closedEyeTimeMs = this.perclosSegments.reduce((sum, segment) => sum + (segment.closed ? segment.end - segment.start : 0), 0);
            const observedSpan = Math.min(this.config.perclosWindowMs, Math.max(0, timestamp - this.firstSampleAt));
            const validRatio = observedSpan > 0 ? validEyeTimeMs / observedSpan : 0;
            return {
                perclos: validEyeTimeMs > 0 ? closedEyeTimeMs / validEyeTimeMs * 100 : null,
                perclosWindowMs: this.config.perclosWindowMs,
                validEyeTimeMs,
                closedEyeTimeMs,
                perclosValid: validEyeTimeMs >= this.config.minimumPerclosValidMs && validRatio >= this.config.minimumPerclosValidRatio
            };
        }

        _updateBlink(timestamp, earValid, eyeClosed, { oneEyeOnly = false } = {}) {
            const frameDeltaMs = this.lastFrameTimestamp === null ? null : timestamp - this.lastFrameTimestamp;
            this.lastFrameTimestamp = timestamp;
            let blinkAccepted = false;
            let blinkRejectReason = oneEyeOnly ? 'ONE_EYE_ONLY' : (earValid ? 'THRESHOLD_NOT_CROSSED' : 'EAR_INVALID');
            if (this.eyeClosedSince !== null) {
                if (earValid) this.blinkValidFrameCount = (this.blinkValidFrameCount || 0) + 1;
                else this.blinkInvalidFrameCount = (this.blinkInvalidFrameCount || 0) + 1;
            }
            if (!earValid) {
                if (this.eyeClosedSince !== null) blinkRejectReason = oneEyeOnly ? 'ONE_EYE_ONLY' : 'EAR_INVALID';
                this.eyeClosedSince = null;
                this.lastEyeClosed = false;
            } else if (eyeClosed && !this.lastEyeClosed) {
                this.eyeClosedSince = timestamp;
                this.blinkValidFrameCount = 1; this.blinkInvalidFrameCount = 0;
            } else if (!eyeClosed && this.lastEyeClosed && this.eyeClosedSince !== null) {
                const duration = timestamp - this.eyeClosedSince;
                this.lastClosureDurationMs = duration;
                if (duration >= this.config.blink.minimumDurationMs && duration <= this.config.blink.maximumDurationMs) {
                    this.blinkCount += 1;
                    this.lastBlinkDurationMs = duration;
                    this.blinkTimestamps.push(timestamp);
                    blinkAccepted = true; blinkRejectReason = null;
                } else {
                    blinkRejectReason = duration < this.config.blink.minimumDurationMs ? 'BELOW_MIN_DURATION' : 'ABOVE_MAX_DURATION';
                }
                this.eyeClosedSince = null;
            }
            this.lastEyeClosed = earValid && eyeClosed;
            while (this.blinkTimestamps.length && timestamp - this.blinkTimestamps[0] > this.config.blink.rateWindowMs) {
                this.blinkTimestamps.shift();
            }
            return {
                eyeClosedSince: this.eyeClosedSince,
                eyeClosureDurationMs: this.eyeClosedSince === null ? 0 : Math.max(0, timestamp - this.eyeClosedSince),
                blinkCount: this.blinkCount,
                blinkRate: this.blinkTimestamps.length * 60000 / this.config.blink.rateWindowMs,
                lastBlinkDurationMs: this.lastBlinkDurationMs,
                lastClosureDurationMs: this.lastClosureDurationMs,
                blinkCandidate: this.eyeClosedSince !== null,
                blinkAccepted,
                blinkRejectReason,
                frameDeltaMs
                , validFrameCountDuringClosure: this.blinkValidFrameCount || 0,
                invalidFrameCountDuringClosure: this.blinkInvalidFrameCount || 0
            };
        }

        _resetYawn() {
            this.mouthOpenSince = null; this.mouthClosedSince = null; this.yawnEpisodeConfirmed = false;
            this.yawnCount = 0; this.lastYawnDurationMs = null; this.lastYawnTimestamp = null;
            this.yawnState = 'MOUTH_CLOSED'; this.lastMouthTimestamp = null;
        }

        _updateYawn(timestamp, { valid, mouthOpen }) {
            const config = this.config.yawn;
            if (!valid || (this.lastMouthTimestamp !== null && timestamp - this.lastMouthTimestamp > config.staleSampleMs)) {
                this.mouthOpenSince = null; this.mouthClosedSince = null; this.yawnEpisodeConfirmed = false;
                this.yawnState = 'INVALID'; this.lastMouthTimestamp = timestamp;
                return this._yawnOutput(null, false, false);
            }
            this.lastMouthTimestamp = timestamp;
            if (mouthOpen) {
                this.mouthClosedSince = null;
                if (this.mouthOpenSince === null) this.mouthOpenSince = timestamp;
                const duration = Math.max(0, timestamp - this.mouthOpenSince);
                let candidate = duration >= config.mouthOpenMinimumMs;
                if (duration >= config.yawnConfirmationMs && duration <= config.maximumValidYawnMs) this.yawnEpisodeConfirmed = true;
                this.yawnState = this.yawnEpisodeConfirmed ? 'YAWN_CONFIRMED' : (candidate ? 'YAWN_CANDIDATE' : 'MOUTH_OPEN_PENDING');
                if (duration > config.maximumValidYawnMs) { this.yawnEpisodeConfirmed = false; this.yawnState = 'MOUTH_OPEN'; candidate = false; }
                return this._yawnOutput(duration, candidate, this.yawnEpisodeConfirmed);
            }
            if (this.mouthOpenSince === null) { this.yawnState = 'MOUTH_CLOSED'; return this._yawnOutput(0, false, false); }
            if (this.mouthClosedSince === null) this.mouthClosedSince = timestamp;
            const duration = timestamp - this.mouthOpenSince;
            if (timestamp - this.mouthClosedSince < config.yawnClearMs) {
                this.yawnState = 'RECOVERING'; return this._yawnOutput(duration, false, this.yawnEpisodeConfirmed);
            }
            if (this.yawnEpisodeConfirmed) {
                this.yawnCount += 1; this.lastYawnDurationMs = duration; this.lastYawnTimestamp = new Date(timestamp).toISOString();
            }
            this.mouthOpenSince = null; this.mouthClosedSince = null; this.yawnEpisodeConfirmed = false; this.yawnState = 'MOUTH_CLOSED';
            return this._yawnOutput(0, false, false);
        }

        _yawnOutput(duration, candidate, confirmed) {
            return { mouthOpenSince: this.mouthOpenSince, mouthOpenDurationMs: duration,
                yawnCandidate: candidate, yawnConfirmed: confirmed, yawnCount: this.yawnCount,
                lastYawnDurationMs: this.lastYawnDurationMs, lastYawnTimestamp: this.lastYawnTimestamp, yawnState: this.yawnState };
        }

        processFrame(frame, calibrationState) {
            const timestamp = Date.parse(frame.timestamp);
            const usableTimestamp = finite(timestamp) ? timestamp : Date.now();
            const landmarks = frame.faceDetected && Array.isArray(frame.landmarks) ? frame.landmarks : null;
            const leftEAR = DriverMetricCalculator.computeEyeEAR(landmarks, this.config.leftEyeIndices);
            const rightEAR = DriverMetricCalculator.computeEyeEAR(landmarks, this.config.rightEyeIndices);
            const earValid = finite(leftEAR) && finite(rightEAR);
            const rawEar = earValid ? (leftEAR + rightEAR) / 2 : null;
            const ear = earValid ? this._smooth('ear', rawEar) : null;
            const calibrated = Boolean(calibrationState?.calibrated);
            const eyeClosed = calibrated && earValid ? ear < calibrationState.threshold : null;
            const leftEyeClosed = calibrated && earValid ? leftEAR < calibrationState.threshold : null;
            const rightEyeClosed = calibrated && earValid ? rightEAR < calibrationState.threshold : null;
            const oneEyeOnly = calibrated && earValid && leftEyeClosed !== rightEyeClosed;
            const bothEyesClosed = leftEyeClosed === true && rightEyeClosed === true;
            const blink = this._updateBlink(usableTimestamp, calibrated && earValid && !oneEyeOnly, bothEyesClosed, { oneEyeOnly });
            const perclos = this._recordPerclos(usableTimestamp, calibrated && earValid, Boolean(eyeClosed));
            const pose = this.computeHeadPose(landmarks);
            const mouthGeometry = DriverMetricCalculator.computeMouthGeometry(landmarks, this.config.mouthIndices);
            const marRaw = mouthGeometry.marRaw;
            const marValid = finite(marRaw) && pose.headPoseValid && Math.abs(pose.yaw) <= this.config.yawn.maximumAbsoluteYaw &&
                Math.abs(pose.roll) <= this.config.yawn.maximumAbsoluteRoll && Math.abs(pose.pitch) <= this.config.yawn.maximumAbsolutePitch;
            const marSmoothed = marValid ? this._smooth('mar', marRaw) : null;
            const mouthCalibrationAvailable = calibrationState?.mouthCalibrationAvailable === true;
            const mouthOpen = marValid && mouthCalibrationAvailable ? marSmoothed > calibrationState.mouthOpenThreshold : null;
            const yawn = this._updateYawn(usableTimestamp, { valid: marValid && mouthCalibrationAvailable, mouthOpen: mouthOpen === true });
            const headPoseAllowsMouthMetric = pose.headPoseValid && Math.abs(pose.yaw) <= this.config.yawn.maximumAbsoluteYaw &&
                Math.abs(pose.roll) <= this.config.yawn.maximumAbsoluteRoll && Math.abs(pose.pitch) <= this.config.yawn.maximumAbsolutePitch;
            const marInvalidReason = !mouthGeometry.mouthGeometryValid ? mouthGeometry.invalidReason
                : (!headPoseAllowsMouthMetric ? 'HEAD_POSE_OUT_OF_RANGE' : null);
            return Object.freeze({
                leftEAR, rightEAR, rawEar, ear, earValid, eyeClosed, leftEyeClosed, rightEyeClosed, bothEyesClosed,
                ...blink, ...perclos, ...pose, mar: marSmoothed, marRaw, marSmoothed, marValid,
                mouthOpen, mouthCalibrationAvailable, mouthBaseline: calibrationState?.mouthBaseline ?? null,
                mouthOpenThreshold: calibrationState?.mouthOpenThreshold ?? null, ...yawn,
                mouthWidth: mouthGeometry.mouthWidth,
                mouthVerticalDistance1: mouthGeometry.verticalDistances[0], mouthVerticalDistance2: mouthGeometry.verticalDistances[1],
                mouthVerticalDistance3: mouthGeometry.verticalDistances[2], mouthLandmarksAvailable: mouthGeometry.mouthLandmarksAvailable,
                mouthGeometryValid: mouthGeometry.mouthGeometryValid, headPoseAllowsMouthMetric, marInvalidReason,
                mouthCalibrationSampleAccepted: calibrationState?.lastMouthRejectReason == null && calibrationState?.state === 'COLLECTING',
                mouthCalibrationRejectReason: calibrationState?.lastMouthRejectReason || null
            });
        }

        reset() {
            this.smoothed = { ear: null, pitch: null, roll: null, yaw: null, mar: null };
            this.eyeClosedSince = null; this.lastEyeClosed = false; this.blinkCount = 0;
            this.lastBlinkDurationMs = null; this.blinkTimestamps = [];
            this.lastClosureDurationMs = null;
            this.perclosSegments = []; this.previousSample = null; this.firstSampleAt = null;
            this._resetYawn();
            this.lastFrameTimestamp = null;
        }
    }

    namespace.DriverMetricCalculator = DriverMetricCalculator;
})(window);
