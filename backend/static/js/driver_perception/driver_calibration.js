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
            this.rejectedSampleCount = 0;
            this.baseline = null;
            this.threshold = null;
            return this.getState(timestamp);
        }

        addSample(ear, { valid = true, timestamp = Date.now() } = {}) {
            if (this.state !== CalibrationStates.COLLECTING) return this.getState(timestamp);
            const value = Number(ear);
            const finite = Number.isFinite(value) && value > 0;
            const openCandidate = finite && value >= (this.config.minimumOpenEar || 0);
            if (!valid || !openCandidate) this.rejectedSampleCount += 1;
            else this.samples.push(value);
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
            this.state = CalibrationStates.READY;
            return this.getState(timestamp);
        }

        reset(markReset = true) {
            this.state = markReset ? CalibrationStates.RESET : CalibrationStates.NOT_STARTED;
            this.startedAt = null;
            this.completedAt = null;
            this.samples = [];
            this.rejectedSampleCount = 0;
            this.baseline = null;
            this.threshold = null;
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
                notice: 'DEVELOPMENT_UNVALIDATED_CALIBRATION'
            });
        }
    }

    namespace.CalibrationStates = CalibrationStates;
    namespace.DriverCalibration = DriverCalibration;
})(window);
