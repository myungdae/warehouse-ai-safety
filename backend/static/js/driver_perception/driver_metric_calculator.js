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
            this.eyeStates = { left: this._newEyeState(), right: this._newEyeState() };
            this.blinkEpisode = this._newBlinkEpisode();
            this.blinkEpisodeSequence = 0;
            this.lastAcceptedEpisodeId = null;
            this.lastRejectedEpisodeId = null;
        }

        _newEyeState() {
            return { state: 'UNKNOWN', stateSince: null, pendingSince: null, invalidFrames: 0, smoothedRatio: null };
        }

        _newBlinkEpisode() {
            return { state: 'REARM_PENDING', armed: false, closureStartedAt: null, leftCloseStartedAt: null,
                rightCloseStartedAt: null, recoveryStartedAt: null, rearmStartedAt: null, countBefore: this?.blinkCount || 0 };
        }

        _updateEyeState(side, timestamp, ratio, valid) {
            const eye = this.eyeStates[side], config = this.config.blinkRearm;
            if (!valid || !finite(ratio)) {
                eye.invalidFrames += 1;
                if (eye.invalidFrames > config.invalidFrameTolerance) {
                    eye.state = 'INVALID'; eye.stateSince = timestamp; eye.pendingSince = null;
                }
                return eye;
            }
            eye.invalidFrames = 0;
            eye.smoothedRatio = eye.smoothedRatio === null ? ratio : config.smoothingAlpha * ratio + (1 - config.smoothingAlpha) * eye.smoothedRatio;
            const value = eye.smoothedRatio, enter = state => { if (eye.state !== state) { eye.state = state; eye.stateSince = timestamp; eye.pendingSince = null; } };
            if (eye.state === 'UNKNOWN' || eye.state === 'INVALID') {
                if (value >= config.openRecoveryRatio) enter('OPEN');
                else if (value <= config.closeEntryRatio) { enter('CLOSING'); eye.pendingSince = timestamp; }
                return eye;
            }
            if (eye.state === 'OPEN') {
                if (value <= config.closeEntryRatio) { enter('CLOSING'); eye.pendingSince = timestamp; }
            } else if (eye.state === 'CLOSING') {
                if (value >= config.openRecoveryRatio) enter('OPEN');
                else if (value <= config.closeEntryRatio && timestamp - (eye.pendingSince ?? timestamp) >= config.entrySustainMs) enter('CLOSED');
            } else if (eye.state === 'CLOSED') {
                if (value >= config.openRecoveryRatio) { enter('REOPENING'); eye.pendingSince = timestamp; }
            } else if (eye.state === 'REOPENING') {
                if (value <= config.closeEntryRatio) enter('CLOSED');
                else if (value >= config.openRecoveryRatio && timestamp - (eye.pendingSince ?? timestamp) >= config.recoverySustainMs) enter('OPEN');
            }
            return eye;
        }

        _updateBlinkV2(timestamp, { leftRatio, rightRatio, leftValid, rightValid, frameGapMs }) {
            const config = this.config.blinkRearm, before = this.blinkCount;
            const left = this._updateEyeState('left', timestamp, leftRatio, leftValid), right = this._updateEyeState('right', timestamp, rightRatio, rightValid);
            const leftClosing = ['CLOSING', 'CLOSED'].includes(left.state), rightClosing = ['CLOSING', 'CLOSED'].includes(right.state);
            const bothClosed = left.state === 'CLOSED' && right.state === 'CLOSED', bothOpen = left.state === 'OPEN' && right.state === 'OPEN';
            const oneEyeOnly = (leftClosing || rightClosing) && leftClosing !== rightClosing;
            const invalid = left.state === 'INVALID' || right.state === 'INVALID';
            let accepted = false, rejected = false, rejectReason = null, episodeState = this.blinkEpisode.state;
            const reject = reason => { rejected = true; rejectReason = reason; episodeState = 'REJECTED';
                this.lastRejectedEpisodeId = `blink-v2-${++this.blinkEpisodeSequence}`;
                this.blinkEpisode = { ...this._newBlinkEpisode(), state: 'REARM_PENDING', rearmStartedAt: null, countBefore: this.blinkCount }; };
            if (invalid && !['ARMED', 'REARM_PENDING'].includes(this.blinkEpisode.state)) reject('EYE_QUALITY_DEGRADED');
            else if (finite(frameGapMs) && frameGapMs > this.config.maxFrameGapMs && !['ARMED', 'REARM_PENDING'].includes(this.blinkEpisode.state)) reject('FRAME_GAP_TOO_LARGE');
            if (!rejected && this.blinkEpisode.state === 'REARM_PENDING') {
                if (bothOpen) {
                    if (this.blinkEpisode.rearmStartedAt === null) this.blinkEpisode.rearmStartedAt = timestamp;
                    if (timestamp - this.blinkEpisode.rearmStartedAt >= config.recoverySustainMs) {
                        this.blinkEpisode = { ...this._newBlinkEpisode(), state: 'ARMED', armed: true, countBefore: this.blinkCount };
                    }
                } else this.blinkEpisode.rearmStartedAt = null;
            } else if (!rejected && this.blinkEpisode.state === 'ARMED') {
                if (leftClosing || rightClosing) {
                    this.blinkEpisode.state = 'CLOSING_PENDING'; this.blinkEpisode.armed = false;
                    if (leftClosing) this.blinkEpisode.leftCloseStartedAt = timestamp;
                    if (rightClosing) this.blinkEpisode.rightCloseStartedAt = timestamp;
                }
            } else if (!rejected && this.blinkEpisode.state === 'CLOSING_PENDING') {
                if (leftClosing && this.blinkEpisode.leftCloseStartedAt === null) this.blinkEpisode.leftCloseStartedAt = timestamp;
                if (rightClosing && this.blinkEpisode.rightCloseStartedAt === null) this.blinkEpisode.rightCloseStartedAt = timestamp;
                const starts = [this.blinkEpisode.leftCloseStartedAt, this.blinkEpisode.rightCloseStartedAt];
                if (starts.every(finite) && Math.abs(starts[0] - starts[1]) <= config.bilateralCorrelationMs) {
                    if (bothClosed) { this.blinkEpisode.state = 'CLOSED'; this.blinkEpisode.closureStartedAt = Math.min(...starts); }
                } else if (starts.some(finite) && timestamp - starts.find(finite) > config.bilateralCorrelationMs) reject('ONE_EYE_ONLY');
                else if (bothOpen) reject('BLINK_TOO_SHORT');
            } else if (!rejected && this.blinkEpisode.state === 'CLOSED') {
                const duration = timestamp - this.blinkEpisode.closureStartedAt;
                if (duration > config.maximumEpisodeDurationMs) reject('BLINK_TOO_LONG');
                else if (!bothClosed) { this.blinkEpisode.state = 'REOPENING_PENDING'; this.blinkEpisode.recoveryStartedAt = timestamp; }
            } else if (!rejected && this.blinkEpisode.state === 'REOPENING_PENDING') {
                const duration = (this.blinkEpisode.recoveryStartedAt ?? timestamp) - this.blinkEpisode.closureStartedAt;
                if (oneEyeOnly && timestamp - this.blinkEpisode.recoveryStartedAt > config.bilateralCorrelationMs) reject('RECOVERY_INCOMPLETE');
                else if (bothOpen) {
                    if (duration >= this.config.blink.minimumDurationMs && duration <= this.config.blink.maximumDurationMs) {
                        this.blinkCount += 1; this.lastBlinkDurationMs = duration; this.lastClosureDurationMs = duration;
                        this.blinkTimestamps.push(timestamp); accepted = true; episodeState = 'ACCEPTED';
                        this.lastAcceptedEpisodeId = `blink-v2-${++this.blinkEpisodeSequence}`;
                        this.blinkEpisode = { ...this._newBlinkEpisode(), state: 'REARM_PENDING', rearmStartedAt: timestamp, countBefore: this.blinkCount };
                    } else reject(duration < this.config.blink.minimumDurationMs ? 'BLINK_TOO_SHORT' : 'BLINK_TOO_LONG');
                }
            }
            while (this.blinkTimestamps.length && timestamp - this.blinkTimestamps[0] > this.config.blink.rateWindowMs) this.blinkTimestamps.shift();
            if (!accepted && !rejected) episodeState = this.blinkEpisode.state;
            const episode = this.blinkEpisode, correlation = episode.leftCloseStartedAt !== null && episode.rightCloseStartedAt !== null
                ? Math.abs(episode.leftCloseStartedAt - episode.rightCloseStartedAt) : null;
            return { eyeClosedSince: episode.closureStartedAt, eyeClosureDurationMs: episode.closureStartedAt === null ? 0 : Math.max(0, timestamp - episode.closureStartedAt),
                blinkCount: this.blinkCount, blinkRate: this.blinkTimestamps.length * 60000 / this.config.blink.rateWindowMs,
                lastBlinkDurationMs: this.lastBlinkDurationMs, lastClosureDurationMs: this.lastClosureDurationMs,
                blinkCandidate: ['CLOSING_PENDING', 'CLOSED', 'REOPENING_PENDING'].includes(episode.state), blinkAccepted: accepted,
                blinkRejected: rejected, blinkRejectReason: rejectReason, blinkEpisodeState: episodeState, blinkArmed: episode.state === 'ARMED',
                leftEyeState: left.state, rightEyeState: right.state, leftSmoothedClosureRatio: left.smoothedRatio, rightSmoothedClosureRatio: right.smoothedRatio,
                leftEyeStateDurationMs: left.stateSince === null ? 0 : timestamp - left.stateSince, rightEyeStateDurationMs: right.stateSince === null ? 0 : timestamp - right.stateSince,
                leftCloseStartedAt: episode.leftCloseStartedAt, rightCloseStartedAt: episode.rightCloseStartedAt, bilateralCorrelationMs: correlation,
                recoveryDurationMs: episode.recoveryStartedAt === null ? 0 : timestamp - episode.recoveryStartedAt,
                rearmDurationMs: episode.rearmStartedAt === null ? 0 : timestamp - episode.rearmStartedAt,
                countBefore: before, countAfter: this.blinkCount, lastAcceptedEpisodeId: this.lastAcceptedEpisodeId,
                lastRejectedEpisodeId: this.lastRejectedEpisodeId, oneEyeOnly, frameDeltaMs: frameGapMs,
                validFrameCountDuringClosure: leftValid && rightValid ? 1 : 0,
                invalidFrameCountDuringClosure: leftValid && rightValid ? 0 : 1 };
        }

        static computeEyeEAR(landmarks, indices, imageWidth = 1, imageHeight = 1) {
            if (!Array.isArray(landmarks) || !indices.every(index => pointValid(landmarks[index]))) return null;
            const width = finite(imageWidth) && imageWidth > 0 ? imageWidth : 1;
            const height = finite(imageHeight) && imageHeight > 0 ? imageHeight : 1;
            const points = indices.map(index => ({ x: landmarks[index].x * width, y: landmarks[index].y * height }));
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

        computeHeadPose(landmarks, calibrationState = {}) {
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
            const geometryV2 = calibrationState.profileVersion === 'PERCEPTION_GEOMETRY_V2';
            const baselineReady = geometryV2 && [calibrationState.neutralPitch, calibrationState.neutralYaw, calibrationState.neutralRoll].every(finite);
            const pitchDelta = baselineReady ? pitch - calibrationState.neutralPitch : pitch;
            const yawDelta = baselineReady ? yaw - calibrationState.neutralYaw : yaw;
            const rollDelta = baselineReady ? roll - calibrationState.neutralRoll : roll;
            const pose = this.config.headPose;
            let state = 'CENTER';
            if (pitchDelta >= pose.downDegrees) state = 'DOWN';
            else if (pitchDelta <= pose.upDegrees) state = 'UP';
            else if (yawDelta <= -pose.yawDegrees) state = 'LEFT';
            else if (yawDelta >= pose.yawDegrees) state = 'RIGHT';
            return { pitch, roll, yaw, pitchDelta, rollDelta, yawDelta, neutralPitch: baselineReady ? calibrationState.neutralPitch : null,
                neutralYaw: baselineReady ? calibrationState.neutralYaw : null, neutralRoll: baselineReady ? calibrationState.neutralRoll : null,
                poseBaselineAvailable: baselineReady, headPoseValid: true, headPoseState: state };
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
            const geometryV2 = calibrationState?.profileVersion === 'PERCEPTION_GEOMETRY_V2';
            const geometryDimensionsValid = finite(frame.imageWidth) && frame.imageWidth > 0 && finite(frame.imageHeight) && frame.imageHeight > 0;
            const geometryWidth = geometryV2 && geometryDimensionsValid ? frame.imageWidth : 1, geometryHeight = geometryV2 && geometryDimensionsValid ? frame.imageHeight : 1;
            const leftEAR = DriverMetricCalculator.computeEyeEAR(landmarks, this.config.leftEyeIndices, geometryWidth, geometryHeight);
            const rightEAR = DriverMetricCalculator.computeEyeEAR(landmarks, this.config.rightEyeIndices, geometryWidth, geometryHeight);
            const leftEarValid = finite(leftEAR) && (!geometryV2 || geometryDimensionsValid);
            const rightEarValid = finite(rightEAR) && (!geometryV2 || geometryDimensionsValid);
            const earValid = leftEarValid && rightEarValid;
            const rawEar = earValid ? (leftEAR + rightEAR) / 2 : null;
            const ear = earValid ? this._smooth('ear', rawEar) : null;
            const sessionMismatch = Boolean(calibrationState?.calibrationSessionId) &&
                calibrationState?.baselineSourceSessionId !== calibrationState.calibrationSessionId;
            const generationMismatch = Number.isInteger(calibrationState?.calibrationGeneration) &&
                calibrationState?.baselineSourceGeneration !== calibrationState.calibrationGeneration;
            const runtimeGenerationMismatch = Number.isInteger(calibrationState?.runtimeGeneration) && Number.isInteger(calibrationState?.currentRuntimeGeneration) &&
                calibrationState.runtimeGeneration !== calibrationState.currentRuntimeGeneration;
            const calibrated = calibrationState?.state === 'READY' && calibrationState?.calibrated === true && !sessionMismatch && !generationMismatch && !runtimeGenerationMismatch;
            const relativeReady = geometryV2 && finite(calibrationState?.leftBaseline) && finite(calibrationState?.rightBaseline);
            const leftClosureRatio = relativeReady && leftEarValid ? leftEAR / calibrationState.leftBaseline : null;
            const rightClosureRatio = relativeReady && rightEarValid ? rightEAR / calibrationState.rightBaseline : null;
            const relativeThreshold = finite(calibrationState?.relativeClosureThreshold) ? calibrationState.relativeClosureThreshold : this.config?.thresholdRatio;
            let leftEyeClosed = calibrated && earValid ? (relativeReady ? leftClosureRatio < relativeThreshold : leftEAR < calibrationState.threshold) : null;
            let rightEyeClosed = calibrated && earValid ? (relativeReady ? rightClosureRatio < relativeThreshold : rightEAR < calibrationState.threshold) : null;
            let eyeClosed = calibrated && earValid ? (relativeReady ? (leftClosureRatio + rightClosureRatio) / 2 < relativeThreshold : ear < calibrationState.threshold) : null;
            let oneEyeOnly = calibrated && earValid && leftEyeClosed !== rightEyeClosed;
            let bothEyesClosed = leftEyeClosed === true && rightEyeClosed === true;
            const frameDeltaMs = this.lastFrameTimestamp === null ? null : usableTimestamp - this.lastFrameTimestamp;
            const blink = calibrated && relativeReady && this.config.blinkRearm
                ? this._updateBlinkV2(usableTimestamp, { leftRatio: leftClosureRatio, rightRatio: rightClosureRatio,
                    leftValid: calibrated && leftEarValid, rightValid: calibrated && rightEarValid, frameGapMs: frameDeltaMs })
                : this._updateBlink(usableTimestamp, calibrated && earValid && !oneEyeOnly, bothEyesClosed, { oneEyeOnly });
            if (relativeReady && this.config.blinkRearm) {
                this.lastFrameTimestamp = usableTimestamp;
                leftEyeClosed = blink.leftEyeState === 'CLOSED'; rightEyeClosed = blink.rightEyeState === 'CLOSED';
                bothEyesClosed = leftEyeClosed && rightEyeClosed; oneEyeOnly = blink.oneEyeOnly;
                eyeClosed = bothEyesClosed;
            }
            const blinkRejectReasons = [];
            if (!frame.faceDetected) blinkRejectReasons.push('FACE_LOST');
            if (!calibrated) blinkRejectReasons.push('CALIBRATION_NOT_READY');
            if (sessionMismatch) blinkRejectReasons.unshift('CALIBRATION_SESSION_MISMATCH');
            if (generationMismatch) blinkRejectReasons.unshift('CALIBRATION_GENERATION_MISMATCH');
            if (runtimeGenerationMismatch) blinkRejectReasons.unshift('CALIBRATION_GENERATION_MISMATCH');
            if (!earValid) blinkRejectReasons.push('EAR_INVALID');
            if (oneEyeOnly) blinkRejectReasons.push('ONE_EYE_ONLY');
            if (Number.isFinite(blink.frameDeltaMs) && blink.frameDeltaMs > this.config.maxFrameGapMs) blinkRejectReasons.push('FRAME_GAP_TOO_LARGE');
            if (blink.blinkRejectReason === 'BELOW_MIN_DURATION') blinkRejectReasons.push('BLINK_TOO_SHORT');
            if (blink.blinkRejectReason === 'ABOVE_MAX_DURATION') blinkRejectReasons.push('BLINK_TOO_LONG');
            if (blink.blinkRejected && blink.blinkRejectReason) blinkRejectReasons.push(blink.blinkRejectReason);
            if (blink.blinkCandidate && !blink.blinkAccepted) blinkRejectReasons.push('RECOVERY_INCOMPLETE');
            const blinkDiagnosticReason = blink.blinkAccepted || !blinkRejectReasons.length ? 'NONE' : blinkRejectReasons[0];
            const perclos = this._recordPerclos(usableTimestamp, calibrated && earValid, Boolean(eyeClosed));
            const pose = this.computeHeadPose(landmarks, calibrationState);
            const mouthGeometry = DriverMetricCalculator.computeMouthGeometry(landmarks, this.config.mouthIndices);
            const marRaw = mouthGeometry.marRaw;
            const marInvalidReasons = [];
            if (!frame.faceDetected) marInvalidReasons.push('FACE_NOT_DETECTED');
            if (frame.faceDetected && !Array.isArray(landmarks)) marInvalidReasons.push('LANDMARK_INVALID');
            if (!mouthGeometry.mouthGeometryValid) marInvalidReasons.push('MOUTH_GEOMETRY_INVALID');
            if (!finite(marRaw)) marInvalidReasons.push('MAR_NON_FINITE');
            if (!pose.headPoseValid) marInvalidReasons.push('HEAD_POSE_INVALID');
            const poseGateDeferred = geometryV2 && !pose.poseBaselineAvailable && calibrationState?.state === 'COLLECTING';
            const gatePitch = pose.poseBaselineAvailable ? pose.pitchDelta : pose.pitch;
            const gateYaw = pose.poseBaselineAvailable ? pose.yawDelta : pose.yaw;
            const gateRoll = pose.poseBaselineAvailable ? pose.rollDelta : pose.roll;
            if (!poseGateDeferred && finite(gatePitch) && Math.abs(gatePitch) > this.config.yawn.maximumAbsolutePitch) marInvalidReasons.push('PITCH_OUT_OF_RANGE');
            if (!poseGateDeferred && finite(gateYaw) && Math.abs(gateYaw) > this.config.yawn.maximumAbsoluteYaw) marInvalidReasons.push('YAW_OUT_OF_RANGE');
            if (!poseGateDeferred && finite(gateRoll) && Math.abs(gateRoll) > this.config.yawn.maximumAbsoluteRoll) marInvalidReasons.push('ROLL_OUT_OF_RANGE');
            const headPoseAllowsMouthMetric = pose.headPoseValid && (poseGateDeferred || (Math.abs(gateYaw) <= this.config.yawn.maximumAbsoluteYaw &&
                Math.abs(gateRoll) <= this.config.yawn.maximumAbsoluteRoll && Math.abs(gatePitch) <= this.config.yawn.maximumAbsolutePitch));
            const marValid = finite(marRaw) && headPoseAllowsMouthMetric;
            const marSmoothed = marValid ? this._smooth('mar', marRaw) : null;
            const mouthCalibrationAvailable = calibrationState?.mouthCalibrationAvailable === true;
            const mouthOpen = marValid && mouthCalibrationAvailable ? marSmoothed > calibrationState.mouthOpenThreshold : null;
            const yawn = this._updateYawn(usableTimestamp, { valid: marValid && mouthCalibrationAvailable, mouthOpen: mouthOpen === true });
            const marInvalidReason = marInvalidReasons[0] || 'NONE';
            return Object.freeze({
                leftEAR, rightEAR, rawEar, ear, earValid, leftEarValid, rightEarValid,
                eyeClosed, leftEyeClosed, rightEyeClosed, bothEyesClosed, oneEyeOnly,
                leftClosureRatio, rightClosureRatio, relativeClosureThreshold: relativeReady ? relativeThreshold : null,
                geometryVersion: geometryV2 ? 'PERCEPTION_GEOMETRY_V2' : 'PERCEPTION_GEOMETRY_V1',
                calibrationSessionId: calibrationState?.calibrationSessionId || null,
                calibrationGeneration: calibrationState?.calibrationGeneration ?? null,
                baselineSourceSessionId: calibrationState?.baselineSourceSessionId || null,
                baselineSourceGeneration: calibrationState?.baselineSourceGeneration ?? null,
                calibrationSessionMatch: !sessionMismatch, calibrationGenerationMatch: !generationMismatch && !runtimeGenerationMismatch,
                geometryDimensionsValid, geometryFallback: geometryV2 && !geometryDimensionsValid ? 'V2_DIMENSIONS_UNAVAILABLE' : null,
                ...blink, blinkRejectReason: blinkDiagnosticReason, blinkRejectReasons: Object.freeze([...new Set(blinkRejectReasons)]),
                blinkRecoveryDurationMs: blink.recoveryDurationMs ?? null,
                blinkRearmDurationMs: blink.rearmDurationMs ?? null,
                blinkRearmConfigVersion: relativeReady ? this.config.blinkRearm?.version : null,
                blinkCloseThreshold: relativeReady ? this.config.blinkRearm?.closeEntryRatio : null,
                blinkOpenThreshold: relativeReady ? this.config.blinkRearm?.openRecoveryRatio : null,
                ...perclos, ...pose, mar: marSmoothed, marRaw, marSmoothed, marValid,
                mouthOpen, mouthCalibrationAvailable, mouthBaseline: calibrationState?.mouthBaseline ?? null,
                mouthOpenThreshold: calibrationState?.mouthOpenThreshold ?? null, ...yawn,
                mouthWidth: mouthGeometry.mouthWidth,
                mouthVerticalDistance1: mouthGeometry.verticalDistances[0], mouthVerticalDistance2: mouthGeometry.verticalDistances[1],
                mouthVerticalDistance3: mouthGeometry.verticalDistances[2], mouthLandmarksAvailable: mouthGeometry.mouthLandmarksAvailable,
                mouthGeometryValid: mouthGeometry.mouthGeometryValid, headPoseAllowsMouthMetric, marInvalidReason,
                marInvalidReasons: Object.freeze([...new Set(marInvalidReasons)]),
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
            this.eyeStates = { left: this._newEyeState(), right: this._newEyeState() };
            this.blinkEpisode = this._newBlinkEpisode();
            this.blinkEpisodeSequence = 0;
            this.lastAcceptedEpisodeId = null;
            this.lastRejectedEpisodeId = null;
        }
    }

    namespace.DriverMetricCalculator = DriverMetricCalculator;
})(window);
