(function defineDriverCalibration(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const CalibrationStates = Object.freeze({
        NOT_STARTED: 'NOT_STARTED', COLLECTING: 'COLLECTING', READY: 'READY',
        INVALID: 'INVALID', RESET: 'RESET'
    });
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
            this.config = config;
            this.reset(false);
        }

        start(timestamp = Date.now()) {
            this.state = CalibrationStates.COLLECTING;
            this.startedAt = Number(timestamp);
            this.completedAt = null;
            this.samples = [];
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
            this.baseline = null;
            this.threshold = null;
            return this.getState(timestamp);
        }

        addSample(ear, { valid = true, leftEAR = null, rightEAR = null, pitch = null, yaw = null, roll = null,
            mar = null, marValid = false, marRejectReason = null, timestamp = Date.now() } = {}) {
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            const value = Number(ear);
            const finite = Number.isFinite(value) && value > 0;
            const geometryV2 = this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2';
            const openCandidate = geometryV2
                ? finite && finitePositive(leftEAR) && finitePositive(rightEAR)
                : finite && value >= (this.config.minimumOpenEar || 0);
            if (!valid || !openCandidate) this.rejectedSampleCount += 1;
            else {
                this.samples.push(value);
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
            if (Number(timestamp) - this.startedAt >= this.config.durationMs) this.complete(timestamp);
            return this.getState(timestamp);
        }

        complete(timestamp = Date.now()) {
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            this.completedAt = Number(timestamp);
            if (this.samples.length < this.config.minimumSamples) {
                if (this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2') {
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this.eyeCalibrationReasonCodes.push('INSUFFICIENT_OPEN_EYE_SAMPLES');
                }
                this.state = CalibrationStates.INVALID;
                return this.getState(timestamp);
            }
            const sorted = [...this.samples].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            const baseline = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
            if (!Number.isFinite(baseline) || (this.config.profileVersion !== 'PERCEPTION_GEOMETRY_V2' && baseline < this.config.minimumBaseline)) {
                this.state = CalibrationStates.INVALID;
                return this.getState(timestamp);
            }
            this.baseline = baseline;
            this.threshold = baseline * this.config.thresholdRatio;
            if (this.config.profileVersion === 'PERCEPTION_GEOMETRY_V2') {
                const left = neutralEyeSamples(this.leftSamples), right = neutralEyeSamples(this.rightSamples);
                this.leftRejectedSampleCount = left.rejected.length;
                this.rightRejectedSampleCount = right.rejected.length;
                if (left.rejected.length || right.rejected.length) this.eyeCalibrationReasonCodes.push('EYE_SAMPLE_TOO_LOW');
                if (left.accepted.length < this.config.minimumSamples || right.accepted.length < this.config.minimumSamples) {
                    this.eyeCalibrationReasonCodes.push('INSUFFICIENT_OPEN_EYE_SAMPLES');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this.state = CalibrationStates.INVALID;
                    return this.getState(timestamp);
                }
                this.leftNoise = left.statistics;
                this.rightNoise = right.statistics;
                this.leftBaseline = this.leftNoise.median;
                this.rightBaseline = this.rightNoise.median;
                this.neutralPitch = median(this.pitchSamples);
                this.neutralYaw = median(this.yawSamples);
                this.neutralRoll = median(this.rollSamples);
                if (![this.leftBaseline, this.rightBaseline, this.neutralPitch, this.neutralYaw, this.neutralRoll].every(Number.isFinite)) {
                    this.eyeCalibrationReasonCodes.push('LANDMARK_UNSTABLE');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this.state = CalibrationStates.INVALID;
                    return this.getState(timestamp);
                }
                this.leftBaselineStability = this.leftNoise.mad / this.leftBaseline;
                this.rightBaselineStability = this.rightNoise.mad / this.rightBaseline;
                this.leftOpenEyeConfidence = Math.max(0, Math.min(1, 1 - this.leftBaselineStability));
                this.rightOpenEyeConfidence = Math.max(0, Math.min(1, 1 - this.rightBaselineStability));
                if (this.leftBaselineStability > .15 || this.rightBaselineStability > .15) {
                    this.eyeCalibrationReasonCodes.push('LANDMARK_UNSTABLE');
                    this.calibrationQualityState = 'CALIBRATION_DEGRADED';
                    this.state = CalibrationStates.INVALID;
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
            this.state = CalibrationStates.READY;
            return this.getState(timestamp);
        }

        reset(markReset = true) {
            this.state = markReset ? CalibrationStates.RESET : CalibrationStates.NOT_STARTED;
            this.startedAt = null;
            this.completedAt = null;
            this.samples = [];
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
            return this.getState();
        }

        getState(timestamp = Date.now()) {
            const elapsedMs = this.startedAt === null ? 0 : Math.max(0, Number(timestamp) - this.startedAt);
            return Object.freeze({
                state: this.state,
                calibrated: this.state === CalibrationStates.READY,
                profileVersion: this.config.profileVersion || 'PERCEPTION_GEOMETRY_V1',
                sampleCount: this.samples.length,
                rejectedSampleCount: this.rejectedSampleCount,
                elapsedMs,
                progress: this.state === CalibrationStates.COLLECTING
                    ? Math.min(1, elapsedMs / this.config.durationMs)
                    : (this.state === CalibrationStates.READY ? 1 : 0),
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
                notice: 'DEVELOPMENT_UNVALIDATED_CALIBRATION'
            });
        }
    }

    namespace.CalibrationStates = CalibrationStates;
    namespace.DriverCalibration = DriverCalibration;
})(window);
