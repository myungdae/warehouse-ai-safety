(function defineDriverCalibration(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const CalibrationStates = Object.freeze({
        NOT_STARTED: 'NOT_STARTED', COLLECTING: 'COLLECTING', READY: 'READY',
        INVALID: 'INVALID', RESETTING: 'RESETTING', RESET: 'RESETTING'
    });
    let calibrationSessionSequence = 0;
    const sessionId = timestamp => `calibration-${Number(timestamp)}-${++calibrationSessionSequence}`;
    const finitePositive = value => Number.isFinite(value) && value > 0;
    const median = values => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const percentile = (values, ratio) => {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
    };
    const statistics = values => {
        const center = median(values);
        return Object.freeze({ count: values.filter(Number.isFinite).length, median: center,
            mad: center === null ? null : median(values.filter(Number.isFinite).map(value => Math.abs(value - center))),
            p10: percentile(values, .1), p25: percentile(values, .25), p75: percentile(values, .75), p90: percentile(values, .9) });
    };
    const neutralEyeSamples = values => {
        const valid = values.filter(finitePositive), initial = statistics(valid);
        if (!valid.length) return { accepted: [], rejected: [], statistics: statistics([]) };
        const openReference = initial.p75 || initial.median;
        const minimumNeutral = openReference * .55;
        const accepted = valid.filter(value => value >= minimumNeutral), rejected = valid.filter(value => value < minimumNeutral);
        return { accepted, rejected, statistics: statistics(accepted) };
    };

    class DriverCalibration {
        constructor(config = {}) {
            this.config = { calibrationMode: 'BOUNDED_ADAPTIVE',
                minimumCollectionMs: config.durationMs ?? 3000, maximumCollectionMs: 10000,
                rollingEvaluationWindowMs: 3000, passingConfirmationMs: 500,
                minimumPassingEvaluations: 3, ...config };
            this.calibrationGeneration = 0;
            this.calibrationSessionId = null;
            this.auditHistory = [];
            this.lastResetSource = null;
            this.lastStartSource = null;
            this.lastAcceptedFrameSequence = null;
            this.lastRejectedFrameSequence = null;
            this.lastRejectReason = null;
            this.lastStateWriter = 'CONSTRUCTOR';
            this.lastStateTransition = 'NONE';
            this.reset(false);
        }

        _audit(eventType, details = {}) {
            this.auditHistory.push(Object.freeze({ eventType, at: new Date().toISOString(),
                calibrationSessionId: this.calibrationSessionId, calibrationGeneration: this.calibrationGeneration, ...details }));
            if (this.auditHistory.length > 100) this.auditHistory.splice(0, this.auditHistory.length - 100);
        }

        _transition(state, writer, eventType) {
            const previous = this.state;
            this.state = state;
            this.lastStateWriter = writer;
            this.lastStateTransition = `${previous}->${state}`;
            if (eventType) this._audit(eventType, { previousState: previous, state });
        }

        bindRuntimeGeneration(runtimeGeneration) {
            if (!Number.isInteger(runtimeGeneration) || runtimeGeneration < 0) return this.getState();
            this.runtimeGeneration = runtimeGeneration;
            return this.getState();
        }

        start(timestamp = Date.now(), identity = {}) {
            if (![CalibrationStates.NOT_STARTED, CalibrationStates.RESETTING].includes(this.state)) {
                this._audit('CALIBRATION_START_IGNORED', { source: identity.source || 'START_CALIBRATION', reason: 'EXPLICIT_RESET_REQUIRED' });
                return this.getState(timestamp);
            }
            this.calibrationGeneration += 1;
            this.calibrationSessionId = sessionId(timestamp);
            this.canonicalTargetId = identity.canonicalTargetId ?? this.canonicalTargetId ?? null;
            this.assignmentId = identity.assignmentId ?? this.assignmentId ?? null;
            this.runtimeGeneration = Number.isInteger(identity.runtimeGeneration) ? identity.runtimeGeneration : (this.runtimeGeneration || 0);
            this.lastStartSource = identity.source || 'START_CALIBRATION';
            this.baselineSourceSessionId = null;
            this.baselineSourceGeneration = null;
            this._audit('CALIBRATION_SESSION_CREATED', { source: identity.source || 'START_CALIBRATION' });
            this._transition(CalibrationStates.COLLECTING, identity.source || 'DRIVER_PERCEPTION_RUNTIME', 'CALIBRATION_COLLECTION_STARTED');
            this.startedAt = Number(timestamp);
            this.completedAt = null;
            this.samples = [];
            this.acceptedFrames = [];
            this.leftSamples = [];
            this.rightSamples = [];
            this.pitchSamples = [];
            this.yawSamples = [];
            this.rollSamples = [];
            this.mouthSamples = [];
            this.mouthRejectedSampleCount = 0;
            this.mouthRejectReasons = {};
            this.lastMouthRejectReason = null;
            this.rejectedSampleCount = 0;
            this.leftRejectedSampleCount = 0;
            this.rightRejectedSampleCount = 0;
            this.eyeCalibrationReasonCodes = [];
            this.calibrationQualityState = 'COLLECTING';
            this.passingStartedAt = null;
            this.consecutivePassingEvaluations = 0;
            this.selectedAcceptedInterval = null;
            this.timeoutReason = null;
            this.earlyCompletionReason = null;
            this.baseline = null;
            this.threshold = null;
            return this.getState(timestamp);
        }

        addSample(ear, { valid = true, leftEAR = null, rightEAR = null, pitch = null, yaw = null, roll = null,
            mar = null, marValid = false, marRejectReason = null, timestamp = Date.now(),
            frameSequence = null,
            expectedCalibrationSessionId = this.calibrationSessionId,
            expectedCalibrationGeneration = this.calibrationGeneration } = {}) {
            if (expectedCalibrationSessionId !== this.calibrationSessionId || expectedCalibrationGeneration !== this.calibrationGeneration) {
                this.lastStateWriter = 'STALE_CALLBACK_REJECTED';
                this.lastRejectedFrameSequence = frameSequence;
                this.lastRejectReason = expectedCalibrationSessionId !== this.calibrationSessionId
                    ? 'CALIBRATION_SESSION_MISMATCH' : 'CALIBRATION_GENERATION_MISMATCH';
                this._audit('STALE_CALIBRATION_CALLBACK_REJECTED', { expectedCalibrationSessionId, expectedCalibrationGeneration });
                return this.getState(timestamp);
            }
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            const value = Number(ear);
            const finite = Number.isFinite(value) && value > 0;
            const geometryV2 = this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2';
            const openCandidate = geometryV2
                ? finite && finitePositive(leftEAR) && finitePositive(rightEAR)
                : finite && value >= (this.config.minimumOpenEar || 0);
            if (!valid || !openCandidate) {
                this.rejectedSampleCount += 1;
                this.lastRejectedFrameSequence = frameSequence;
                this.lastRejectReason = !valid ? 'FACE_OR_EAR_INVALID' : 'OPEN_EYE_SAMPLE_INVALID';
            }
            else {
                this.samples.push(value);
                this.acceptedFrames.push(Object.freeze({ timestamp: Number(timestamp), ear: value,
                    leftEAR: finitePositive(leftEAR) ? Number(leftEAR) : null,
                    rightEAR: finitePositive(rightEAR) ? Number(rightEAR) : null,
                    pitch: Number.isFinite(pitch) ? Number(pitch) : null,
                    yaw: Number.isFinite(yaw) ? Number(yaw) : null,
                    roll: Number.isFinite(roll) ? Number(roll) : null }));
                this.lastAcceptedFrameSequence = frameSequence;
                this.lastRejectReason = null;
                if (this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2' && finitePositive(leftEAR) && finitePositive(rightEAR)) {
                    this.leftSamples.push(leftEAR);
                    this.rightSamples.push(rightEAR);
                }
                if (Number.isFinite(pitch) && Number.isFinite(yaw) && Number.isFinite(roll)) {
                    this.pitchSamples.push(pitch); this.yawSamples.push(yaw); this.rollSamples.push(roll);
                }
            }
            let mouthRejectReason = null;
            if (!marValid) mouthRejectReason = marRejectReason || 'MAR_INVALID';
            else if (!Number.isFinite(mar) || mar <= 0) mouthRejectReason = 'NON_FINITE_MAR';
            else if (mar > (this.config.maximumNeutralMar || 0.28)) mouthRejectReason = 'MOUTH_ALREADY_OPEN';
            if (!mouthRejectReason) {
                this.mouthSamples.push(mar);
                this.lastMouthRejectReason = null;
            } else {
                this.mouthRejectedSampleCount += 1;
                this.lastMouthRejectReason = mouthRejectReason;
                this.mouthRejectReasons[mouthRejectReason] = (this.mouthRejectReasons[mouthRejectReason] || 0) + 1;
            }
            const at = Number(timestamp), elapsedMs = at - this.startedAt;
            if (elapsedMs >= this.config.minimumCollectionMs) {
                const diagnostics = this._completionDiagnostics(at);
                const currentEvidenceValid = valid && openCandidate;
                if (currentEvidenceValid && diagnostics.readyIfCompletedNow) {
                    if (this.passingStartedAt === null) this.passingStartedAt = at;
                    this.consecutivePassingEvaluations += 1;
                    const confirmationMs = at - this.passingStartedAt;
                    if (confirmationMs >= this.config.passingConfirmationMs &&
                        this.consecutivePassingEvaluations >= this.config.minimumPassingEvaluations) {
                        this.earlyCompletionReason = 'SUSTAINED_SIMULTANEOUS_ALL_GATES_PASS';
                        this.complete(at, { interval: diagnostics.rollingWindow, diagnostics });
                    }
                } else {
                    this.passingStartedAt = null;
                    this.consecutivePassingEvaluations = 0;
                }
                if (this.state === CalibrationStates.COLLECTING && elapsedMs >= this.config.maximumCollectionMs) {
                    this.timeoutReason = 'MAXIMUM_COLLECTION_DURATION_REACHED';
                    this.complete(at, { interval: diagnostics.rollingWindow, diagnostics, timeout: true });
                }
            }
            return this.getState(timestamp);
        }

        complete(timestamp = Date.now(), { interval = null, diagnostics = null, timeout = false } = {}) {
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            if (!timeout && (Number(timestamp) - this.startedAt < this.config.minimumCollectionMs || !diagnostics ||
                diagnostics.persistentBlockers.length || this.consecutivePassingEvaluations < this.config.minimumPassingEvaluations ||
                Number(timestamp) - this.passingStartedAt < this.config.passingConfirmationMs)) return this.getState(timestamp);
            this.completedAt = Number(timestamp);
            const frames = interval ? this.acceptedFrames.filter(frame => frame.timestamp >= interval.startAt && frame.timestamp <= interval.endAt)
                : this.acceptedFrames.slice();
            const samples = frames.map(frame => frame.ear).filter(finitePositive);
            const leftSamples = frames.map(frame => frame.leftEAR).filter(finitePositive);
            const rightSamples = frames.map(frame => frame.rightEAR).filter(finitePositive);
            const pitchSamples = frames.map(frame => frame.pitch).filter(Number.isFinite);
            const yawSamples = frames.map(frame => frame.yaw).filter(Number.isFinite);
            const rollSamples = frames.map(frame => frame.roll).filter(Number.isFinite);
            this.selectedAcceptedInterval = interval ? Object.freeze({ ...interval, sampleCount: frames.length }) : null;
            if (timeout && diagnostics && !diagnostics.readyIfCompletedNow) {
                const blockers = diagnostics.persistentBlockers || diagnostics.blockers || [];
                const reasonMap = { leftStabilityAcceptable: 'LEFT_EYE_STABILITY_UNACCEPTABLE',
                    rightStabilityAcceptable: 'RIGHT_EYE_STABILITY_UNACCEPTABLE',
                    leftOpenSampleMinimum: 'INSUFFICIENT_LEFT_OPEN_EYE_SAMPLES',
                    rightOpenSampleMinimum: 'INSUFFICIENT_RIGHT_OPEN_EYE_SAMPLES',
                    combinedSampleMinimum: 'INSUFFICIENT_OPEN_EYE_SAMPLES',
                    combinedBaselineAcceptable: 'BASELINE_UNACCEPTABLE', poseBaselinesFinite: 'POSE_BASELINE_UNAVAILABLE' };
                this.eyeCalibrationReasonCodes.push(...blockers.map(blocker => reasonMap[blocker] || blocker));
                this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_TIMEOUT', 'CALIBRATION_COMPLETED_INVALID');
                return this.getState(timestamp);
            }
            if (samples.length < this.config.minimumSamples) {
                if (this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2') {
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this.eyeCalibrationReasonCodes.push('INSUFFICIENT_OPEN_EYE_SAMPLES');
                }
                this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_INVALID');
                return this.getState(timestamp);
            }
            const sorted = [...samples].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            const baseline = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
            if (!Number.isFinite(baseline) || (this.config.profileVersion !== 'PERCEPTION_GEOMETRY_V2' && baseline < this.config.minimumBaseline)) {
                this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_INVALID');
                return this.getState(timestamp);
            }
            this.baseline = baseline;
            this.threshold = baseline * this.config.thresholdRatio;
            if (this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2') {
                const left = neutralEyeSamples(leftSamples), right = neutralEyeSamples(rightSamples);
                this.leftRejectedSampleCount = left.rejected.length;
                this.rightRejectedSampleCount = right.rejected.length;
                if (left.rejected.length || right.rejected.length) this.eyeCalibrationReasonCodes.push('EYE_SAMPLE_TOO_LOW');
                if (left.accepted.length < this.config.minimumSamples || right.accepted.length < this.config.minimumSamples) {
                    this.eyeCalibrationReasonCodes.push('INSUFFICIENT_OPEN_EYE_SAMPLES');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_INVALID');
                    return this.getState(timestamp);
                }
                this.leftNoise = left.statistics;
                this.rightNoise = right.statistics;
                this.leftBaseline = this.leftNoise.median;
                this.rightBaseline = this.rightNoise.median;
                this.neutralPitch = median(pitchSamples);
                this.neutralYaw = median(yawSamples);
                this.neutralRoll = median(rollSamples);
                if (![this.leftBaseline, this.rightBaseline, this.neutralPitch, this.neutralYaw, this.neutralRoll].every(Number.isFinite)) {
                    this.eyeCalibrationReasonCodes.push('LANDMARK_UNSTABLE');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_INVALID');
                    return this.getState(timestamp);
                }
                this.leftBaselineStability = this.leftNoise.mad / this.leftBaseline;
                this.rightBaselineStability = this.rightNoise.mad / this.rightBaseline;
                this.leftOpenEyeConfidence = Math.max(0, Math.min(1, 1 - this.leftBaselineStability));
                this.rightOpenEyeConfidence = Math.max(0, Math.min(1, 1 - this.rightBaselineStability));
                if (this.leftBaselineStability > .15 || this.rightBaselineStability > .15) {
                    this.eyeCalibrationReasonCodes.push('LANDMARK_UNSTABLE');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this._transition(CalibrationStates.INVALID, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_INVALID');
                    return this.getState(timestamp);
                }
                this.calibrationQualityState = 'ACCEPTABLE';
            }
            const mouthMinimum = this.config.minimumMouthSamples || 6;
            if (this.mouthSamples.length >= mouthMinimum) {
                const mouth = [...this.mouthSamples].sort((a, b) => a - b);
                const keep = mouth.slice(0, Math.max(mouthMinimum, Math.ceil(mouth.length * .75)));
                const index = Math.floor(keep.length / 2);
                this.mouthBaseline = keep.length % 2 ? keep[index] : (keep[index - 1] + keep[index]) / 2;
                this.mouthOpenThreshold = Math.max(
                    this.mouthBaseline * (this.config.mouthOpenThresholdRatio || 1.8),
                    this.mouthBaseline + (this.config.mouthOpenThresholdOffset || .08)
                );
            }
            this.baselineSourceSessionId = this.calibrationSessionId;
            this.baselineSourceGeneration = this.calibrationGeneration;
            this._transition(CalibrationStates.READY, 'DRIVER_CALIBRATION_COMPLETE', 'CALIBRATION_COMPLETED_READY');
            return this.getState(timestamp);
        }

        _completionDiagnostics(timestamp = Date.now()) {
            const geometryV2 = this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2';
            const minimumSamples = this.config.minimumSamples;
            const evaluatedAt = this.completedAt ?? Number(timestamp), windowStartAt = this.startedAt === null ? evaluatedAt
                : Math.max(this.startedAt, evaluatedAt - this.config.rollingEvaluationWindowMs);
            const windowFrames = this.acceptedFrames.filter(frame => frame.timestamp >= windowStartAt && frame.timestamp <= evaluatedAt);
            const windowSamples = windowFrames.map(frame => frame.ear).filter(finitePositive);
            const left = geometryV2 ? neutralEyeSamples(windowFrames.map(frame => frame.leftEAR)) : null;
            const right = geometryV2 ? neutralEyeSamples(windowFrames.map(frame => frame.rightEAR)) : null;
            const leftBaseline = left?.statistics.median ?? null;
            const rightBaseline = right?.statistics.median ?? null;
            const leftStability = finitePositive(leftBaseline) && Number.isFinite(left?.statistics.mad)
                ? left.statistics.mad / leftBaseline : null;
            const rightStability = finitePositive(rightBaseline) && Number.isFinite(right?.statistics.mad)
                ? right.statistics.mad / rightBaseline : null;
            const pose = {
                pitch: median(windowFrames.map(frame => frame.pitch)), yaw: median(windowFrames.map(frame => frame.yaw)),
                roll: median(windowFrames.map(frame => frame.roll))
            };
            const gates = {
                durationReached: this.startedAt !== null && evaluatedAt - this.startedAt >= this.config.minimumCollectionMs,
                combinedSampleMinimum: windowSamples.length >= minimumSamples,
                combinedBaselineAcceptable: finitePositive(median(windowSamples)) &&
                    (geometryV2 || median(windowSamples) >= this.config.minimumBaseline),
                leftOpenSampleMinimum: !geometryV2 || left.accepted.length >= minimumSamples,
                rightOpenSampleMinimum: !geometryV2 || right.accepted.length >= minimumSamples,
                poseBaselinesFinite: !geometryV2 || [pose.pitch, pose.yaw, pose.roll].every(Number.isFinite),
                leftStabilityAcceptable: !geometryV2 || (Number.isFinite(leftStability) && leftStability <= .15),
                rightStabilityAcceptable: !geometryV2 || (Number.isFinite(rightStability) && rightStability <= .15)
            };
            const blockers = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
            const persistentBlockers = blockers.filter(name => name !== 'durationReached');
            const passingConfirmationDurationMs = this.passingStartedAt === null ? 0 : Math.max(0, evaluatedAt - this.passingStartedAt);
            return Object.freeze({
                calibrationMode: this.config.calibrationMode, minimumCollectionMs: this.config.minimumCollectionMs,
                maximumCollectionMs: this.config.maximumCollectionMs,
                rollingEvaluationWindowMs: this.config.rollingEvaluationWindowMs,
                evaluatedAt, currentElapsedMs: this.startedAt === null ? 0 : Math.max(0, evaluatedAt - this.startedAt),
                rollingWindow: Object.freeze({ startAt: windowStartAt, endAt: evaluatedAt, sampleCount: windowFrames.length }),
                readyIfCompletedNow: persistentBlockers.length === 0,
                allCompletionGatesPassed: blockers.length === 0, blockers: Object.freeze(blockers), gates: Object.freeze(gates),
                passingGates: Object.freeze(Object.entries(gates).filter(([, passed]) => passed).map(([name]) => name)),
                consecutivePassingEvaluations: this.consecutivePassingEvaluations,
                passingConfirmationDurationMs,
                requiredPassingConfirmationMs: this.config.passingConfirmationMs,
                requiredPassingEvaluations: this.config.minimumPassingEvaluations,
                persistentBlockers: Object.freeze(persistentBlockers),
                selectedAcceptedInterval: this.selectedAcceptedInterval,
                timeoutReason: this.timeoutReason,
                earlyCompletionReason: this.earlyCompletionReason,
                counts: Object.freeze({
                    observed: this.samples.length + this.rejectedSampleCount, combinedAccepted: this.samples.length,
                    combinedRejected: this.rejectedSampleCount, requiredPerEye: minimumSamples,
                    currentWindowSampleCount: windowFrames.length,
                    leftRaw: windowFrames.length, leftNeutralAccepted: left?.accepted.length ?? null,
                    leftNeutralRejected: left?.rejected.length ?? null, rightRaw: windowFrames.length,
                    rightNeutralAccepted: right?.accepted.length ?? null, rightNeutralRejected: right?.rejected.length ?? null
                }),
                quality: Object.freeze({
                    predictedState: blockers.some(name => name !== 'durationReached') ? 'CALIBRATION_DEGRADED' : 'ACCEPTABLE',
                    maximumStabilityRatio: .15, leftStability, rightStability,
                    leftMedian: leftBaseline, rightMedian: rightBaseline, neutralPose: Object.freeze(pose)
                }),
                semantics: Object.freeze({
                    samples: 'COHERENT_ROLLING_COMBINED_EAR_ACCEPTED_FRAMES', progress: 'BOUNDED_ADAPTIVE_DURATION',
                    guidedCounter: 'SEPARATE_GUIDED_TUNING_STEP_INDEX'
                })
            });
        }

        reset(markReset = true, source = 'EXPLICIT_RESET') {
            if (markReset) {
                this.calibrationGeneration += 1;
                this.calibrationSessionId = sessionId(Date.now());
                this.lastResetSource = source;
                this._transition(CalibrationStates.RESETTING, source, 'CALIBRATION_RESET');
            } else this.state = CalibrationStates.NOT_STARTED;
            this.startedAt = null;
            this.completedAt = null;
            this.samples = [];
            this.acceptedFrames = [];
            this.leftSamples = [];
            this.rightSamples = [];
            this.pitchSamples = [];
            this.yawSamples = [];
            this.rollSamples = [];
            this.mouthSamples = [];
            this.mouthRejectedSampleCount = 0;
            this.mouthRejectReasons = {};
            this.lastMouthRejectReason = null;
            this.rejectedSampleCount = 0;
            this.leftRejectedSampleCount = 0;
            this.rightRejectedSampleCount = 0;
            this.eyeCalibrationReasonCodes = [];
            this.calibrationQualityState = 'NOT_EVALUATED';
            this.passingStartedAt = null;
            this.consecutivePassingEvaluations = 0;
            this.selectedAcceptedInterval = null;
            this.timeoutReason = null;
            this.earlyCompletionReason = null;
            this.baseline = null;
            this.threshold = null;
            this.leftBaseline = null;
            this.rightBaseline = null;
            this.leftNoise = null;
            this.rightNoise = null;
            this.neutralPitch = null;
            this.neutralYaw = null;
            this.neutralRoll = null;
            this.leftBaselineStability = null;
            this.rightBaselineStability = null;
            this.leftOpenEyeConfidence = null;
            this.rightOpenEyeConfidence = null;
            this.mouthBaseline = null;
            this.mouthOpenThreshold = null;
            this.baselineSourceSessionId = null;
            this.baselineSourceGeneration = null;
            this.lastAcceptedFrameSequence = null;
            this.lastRejectedFrameSequence = null;
            this.lastRejectReason = null;
            if (markReset) this._transition(CalibrationStates.NOT_STARTED, source, 'CALIBRATION_RESET_COMPLETED');
            return this.getState();
        }

        getState(timestamp = Date.now()) {
            const elapsedEnd = this.completedAt ?? Number(timestamp);
            const elapsedMs = this.startedAt === null ? 0 : Math.max(0, elapsedEnd - this.startedAt);
            const completionDiagnostics = this._completionDiagnostics(timestamp);
            return Object.freeze({
                state: this.state,
                calibrated: this.state === CalibrationStates.READY,
                calibrationSessionId: this.calibrationSessionId,
                calibrationGeneration: this.calibrationGeneration,
                runtimeGeneration: this.runtimeGeneration || 0,
                canonicalTargetId: this.canonicalTargetId || null,
                assignmentId: this.assignmentId || null,
                baselineSourceSessionId: this.baselineSourceSessionId,
                baselineSourceGeneration: this.baselineSourceGeneration,
                profileVersion: this.config.profileVersion || 'PERCEPTION_GEOMETRY_V1',
                sampleCount: this.samples.length,
                rejectedSampleCount: this.rejectedSampleCount,
                elapsedMs,
                calibrationMode: this.config.calibrationMode,
                minimumCollectionMs: this.config.minimumCollectionMs,
                maximumCollectionMs: this.config.maximumCollectionMs,
                rollingEvaluationWindowMs: this.config.rollingEvaluationWindowMs,
                passingConfirmationMs: this.config.passingConfirmationMs,
                minimumPassingEvaluations: this.config.minimumPassingEvaluations,
                progress: this.startedAt === null ? 0 : Math.min(1, elapsedMs / this.config.maximumCollectionMs),
                baseline: this.baseline,
                threshold: this.threshold,
                leftBaseline: this.leftBaseline,
                rightBaseline: this.rightBaseline,
                leftNoise: this.leftNoise,
                rightNoise: this.rightNoise,
                leftAcceptedSampleCount: this.leftNoise?.count || 0,
                rightAcceptedSampleCount: this.rightNoise?.count || 0,
                leftRejectedSampleCount: this.leftRejectedSampleCount,
                rightRejectedSampleCount: this.rightRejectedSampleCount,
                leftBaselineStability: this.leftBaselineStability,
                rightBaselineStability: this.rightBaselineStability,
                leftOpenEyeConfidence: this.leftOpenEyeConfidence,
                rightOpenEyeConfidence: this.rightOpenEyeConfidence,
                calibrationQualityState: this.calibrationQualityState,
                eyeCalibrationReasonCodes: [...this.eyeCalibrationReasonCodes],
                neutralPitch: this.neutralPitch,
                neutralYaw: this.neutralYaw,
                neutralRoll: this.neutralRoll,
                relativeClosureThreshold: this.config.thresholdRatio,
                mouthCalibrationAvailable: Number.isFinite(this.mouthBaseline) && Number.isFinite(this.mouthOpenThreshold),
                mouthBaseline: this.mouthBaseline,
                mouthOpenThreshold: this.mouthOpenThreshold,
                mouthSampleCount: this.mouthSamples.length,
                mouthRejectedSampleCount: this.mouthRejectedSampleCount,
                mouthRejectReasons: { ...this.mouthRejectReasons },
                lastMouthRejectReason: this.lastMouthRejectReason,
                mouthMinimumSampleCount: this.config.minimumMouthSamples || 6,
                mouthAcceptedMaximumMar: this.config.maximumNeutralMar || 0.28,
                mouthCalibrationState: Number.isFinite(this.mouthBaseline) ? 'READY' : (this.state === CalibrationStates.COLLECTING ? 'COLLECTING' : 'UNAVAILABLE'),
                completionDiagnostics,
                lastResetSource: this.lastResetSource,
                lastStartSource: this.lastStartSource,
                lastStateWriter: this.lastStateWriter,
                lastStateTransition: this.lastStateTransition,
                lastAcceptedFrameSequence: this.lastAcceptedFrameSequence,
                lastRejectedFrameSequence: this.lastRejectedFrameSequence,
                lastRejectReason: this.lastRejectReason,
                auditHistory: this.auditHistory.slice(),
                notice: 'DEVELOPMENT_UNVALIDATED_CALIBRATION'
            });
        }
    }

    namespace.CalibrationStates = CalibrationStates;
    namespace.DriverCalibration = DriverCalibration;
})(window);
