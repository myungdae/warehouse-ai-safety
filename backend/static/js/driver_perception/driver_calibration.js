(function defineDriverCalibration(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const CalibrationStates = Object.freeze({
        NOT_STARTED: 'NOT_STARTED', COLLECTING: 'COLLECTING', READY: 'READY',
        INVALID: 'INVALID', RESET: 'RESET'
    });

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
            this.mouthSamples = [];
            this.mouthRejectedSampleCount = 0;
            this.mouthRejectReasons = {};
            this.lastMouthRejectReason = null;
            this.rejectedSampleCount = 0;
            this.baseline = null;
            this.threshold = null;
            return this.getState(timestamp);
        }

        addSample(ear, { valid = true, mar = null, marValid = false, marRejectReason = null, timestamp = Date.now() } = {}) {
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            const value = Number(ear);
            const finite = Number.isFinite(value) && value > 0;
            const openCandidate = finite && value >= (this.config.minimumOpenEar || 0);
            if (!valid || !openCandidate) this.rejectedSampleCount += 1;
            else this.samples.push(value);
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
                this.state = CalibrationStates.INVALID;
                return this.getState(timestamp);
            }
            const sorted = [...this.samples].sort((a, b) => a - b);
            const middle = Math.floor(sorted.length / 2);
            const baseline = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
            if (!Number.isFinite(baseline) || baseline < this.config.minimumBaseline) {
                this.state = CalibrationStates.INVALID;
                return this.getState(timestamp);
            }
            this.baseline = baseline;
            this.threshold = baseline * this.config.thresholdRatio;
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
            this.mouthSamples = [];
            this.mouthRejectedSampleCount = 0;
            this.mouthRejectReasons = {};
            this.lastMouthRejectReason = null;
            this.rejectedSampleCount = 0;
            this.baseline = null;
            this.threshold = null;
            this.mouthBaseline = null;
            this.mouthOpenThreshold = null;
            return this.getState();
        }

        getState(timestamp = Date.now()) {
            const elapsedMs = this.startedAt === null ? 0 : Math.max(0, Number(timestamp) - this.startedAt);
            return Object.freeze({
                state: this.state,
                calibrated: this.state === CalibrationStates.READY,
                sampleCount: this.samples.length,
                rejectedSampleCount: this.rejectedSampleCount,
                elapsedMs,
                progress: this.state === CalibrationStates.COLLECTING
                    ? Math.min(1, elapsedMs / this.config.durationMs)
                    : (this.state === CalibrationStates.READY ? 1 : 0),
                baseline: this.baseline,
                threshold: this.threshold,
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
