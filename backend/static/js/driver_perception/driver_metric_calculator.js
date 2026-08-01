(function defineDriverMetricCalculator(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const finite = value => Number.isFinite(value);
    const pointValid = point => point && finite(point.x) && finite(point.y) && finite(point.z || 0);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    class DriverMetricCalculator {
        constructor(config = {}) {
            this.config = config;
            this.smoothed = { ear: null, pitch: null, roll: null, yaw: null };
            this.eyeClosedSince = null;
            this.lastEyeClosed = false;
            this.blinkCount = 0;
            this.lastBlinkDurationMs = null;
            this.blinkTimestamps = [];
            this.perclosSegments = [];
            this.previousSample = null;
            this.firstSampleAt = null;
        }

        static computeEyeEAR(landmarks, indices) {
            if (!Array.isArray(landmarks) || !indices.every(index => pointValid(landmarks[index]))) return null;
            const points = indices.map(index => landmarks[index]);
            const horizontal = distance(points[0], points[3]);
            if (!finite(horizontal) || horizontal <= Number.EPSILON) return null;
            const result = (distance(points[1], points[5]) + distance(points[2], points[4])) / (2 * horizontal);
            return finite(result) && result > 0 ? result : null;
        }

        _smooth(key, value) {
            if (!finite(value)) return null;
            const previous = this.smoothed[key];
            const alpha = this.config.smoothingAlpha;
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

        _updateBlink(timestamp, earValid, eyeClosed) {
            if (!earValid) {
                this.eyeClosedSince = null;
                this.lastEyeClosed = false;
            } else if (eyeClosed && !this.lastEyeClosed) {
                this.eyeClosedSince = timestamp;
            } else if (!eyeClosed && this.lastEyeClosed && this.eyeClosedSince !== null) {
                const duration = timestamp - this.eyeClosedSince;
                if (duration >= this.config.blink.minimumDurationMs && duration <= this.config.blink.maximumDurationMs) {
                    this.blinkCount += 1;
                    this.lastBlinkDurationMs = duration;
                    this.blinkTimestamps.push(timestamp);
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
                lastBlinkDurationMs: this.lastBlinkDurationMs
            };
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
            const blink = this._updateBlink(usableTimestamp, calibrated && earValid, Boolean(eyeClosed));
            const perclos = this._recordPerclos(usableTimestamp, calibrated && earValid, Boolean(eyeClosed));
            const pose = this.computeHeadPose(landmarks);
            return Object.freeze({
                leftEAR, rightEAR, rawEar, ear, earValid, eyeClosed,
                ...blink, ...perclos, ...pose
            });
        }

        reset() {
            this.smoothed = { ear: null, pitch: null, roll: null, yaw: null };
            this.eyeClosedSince = null; this.lastEyeClosed = false; this.blinkCount = 0;
            this.lastBlinkDurationMs = null; this.blinkTimestamps = [];
            this.perclosSegments = []; this.previousSample = null; this.firstSampleAt = null;
        }
    }

    namespace.DriverMetricCalculator = DriverMetricCalculator;
})(window);
