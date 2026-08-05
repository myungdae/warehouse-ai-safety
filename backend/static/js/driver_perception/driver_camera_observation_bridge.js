(function defineDriverCameraObservationBridge(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const Status = Object.freeze({
        STOPPED: 'STOPPED', STARTING: 'STARTING', RUNNING: 'RUNNING', STOPPING: 'STOPPING', READY: 'READY', SENSOR_WAITING: 'SENSOR_WAITING',
        CALIBRATION_REQUIRED: 'CALIBRATION_REQUIRED', FACE_NOT_DETECTED: 'FACE_NOT_DETECTED',
        QUALITY_INSUFFICIENT: 'QUALITY_INSUFFICIENT', STALE_SAMPLE: 'STALE_SAMPLE',
        PUBLISHING: 'PUBLISHING', ERROR: 'ERROR'
    });
    const requiredText = (value, name) => {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
        return value.trim();
    };
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

    class DriverCameraObservationBridge {
        constructor({ perceptionRuntime, runtimePage = global.DriverRuntimePage, now = () => Date.now() } = {}) {
            if (!perceptionRuntime?.onMetricSnapshot) throw new TypeError('perceptionRuntime.onMetricSnapshot is required');
            if (!runtimePage?.ingestObservation || !runtimePage?.getInputModeController) throw new TypeError('DriverRuntimePage public facade is required');
            this.perceptionRuntime = perceptionRuntime;
            this.runtimePage = runtimePage;
            this.now = now;
            this.sourceId = 'driver-camera-observation-bridge';
            this.status = Status.STOPPED;
            this.generation = 0;
            this.ownership = null;
            this.context = null;
            this.unsubscribe = null;
            this.lastObservation = null;
            this.lastResult = null;
            this.audit = [];
            this.lastBlinkEpisodeId = null;
            this.lastLongClosureEpisodeId = null;
            this.lastYawnCount = 0;
            this.startCount = 0;
            this.stopCount = 0;
            this.bridgeOwner = 'DRIVER_SAFETY_CAMERA_LIFECYCLE';
            this.boundRuntimeGeneration = null;
            this.lastStartReason = null;
            this.lastStopReason = null;
            this.runtimePage.getInputModeController().registerSource({
                sourceId: this.sourceId,
                mode: global.DriverInputModeController.Mode.LIVE_WEBCAM,
                onRelease: ownership => this._released(ownership)
            });
        }

        start(contextInput, reason = 'CAMERA_RUNTIME_RUNNING') {
            const context = new global.DriverState.VehicleContext(contextInput);
            if (this.unsubscribe && this.ownership && this.context?.targetId === context.targetId &&
                this.boundRuntimeGeneration === this.perceptionRuntime.runtimeGeneration) return this.getState();
            if (this.unsubscribe || this.ownership) this.stop('BRIDGE_REBIND');
            this.status = Status.STARTING;
            const generation = ++this.generation;
            this.context = context;
            this.boundRuntimeGeneration = this.perceptionRuntime.runtimeGeneration;
            this.lastStartReason = reason;
            this.startCount += 1;
            this.lastBlinkEpisodeId = null; this.lastLongClosureEpisodeId = null; this.lastYawnCount = 0;
            this.ownership = this.runtimePage.getInputModeController().activateMode({
                observationType: 'DROWSINESS', targetId: context.targetId,
                mode: global.DriverInputModeController.Mode.LIVE_WEBCAM,
                sourceId: this.sourceId, reason: 'LIVE_BRIDGE_STARTED'
            });
            this.unsubscribe = this.perceptionRuntime.onMetricSnapshot(snapshot => this._handleSnapshot(generation, snapshot));
            this.status = Status.RUNNING;
            this._record('STARTED');
            const latest = this.perceptionRuntime.getLatestMetricSnapshot?.();
            if (latest) this._handleSnapshot(generation, latest);
            else this.status = Status.SENSOR_WAITING;
            return this.getState();
        }

        stop(reason = 'BRIDGE_STOPPED') {
            if (!this.unsubscribe && !this.ownership && this.status === Status.STOPPED) return this.getState();
            this.status = Status.STOPPING;
            this.generation += 1;
            this.unsubscribe?.();
            this.unsubscribe = null;
            const owned = this.ownership;
            this.ownership = null;
            if (owned) this.runtimePage.getInputModeController().deactivateMode({
                observationType: 'DROWSINESS', targetId: owned.targetId,
                sourceId: this.sourceId, token: owned.token, reason
            });
            this.context = null;
            this.boundRuntimeGeneration = null;
            this.lastStopReason = reason;
            this.stopCount += 1;
            this.status = Status.STOPPED;
            this._record(reason);
            return this.getState();
        }

        _released(ownership) {
            if (this.ownership?.token !== ownership.token) return;
            this.generation += 1;
            this.unsubscribe?.();
            this.unsubscribe = null;
            this.ownership = null;
            this.boundRuntimeGeneration = null;
            this.lastStopReason = ownership.reason || 'OWNERSHIP_RELEASED';
            this.stopCount += 1;
            this.status = Status.STOPPED;
            this._record(ownership.reason || 'OWNERSHIP_RELEASED');
        }

        _qualityStatus(snapshot) {
            if (![namespace.States.RUNNING, namespace.States.FACE_NOT_DETECTED].includes(this.perceptionRuntime.state)) return Status.SENSOR_WAITING;
            if (snapshot.faceDetected !== true) return Status.FACE_NOT_DETECTED;
            if (!snapshot.quality?.landmarkAvailable) return Status.QUALITY_INSUFFICIENT;
            if (!snapshot.calibrated || snapshot.calibrationState !== 'READY') return Status.CALIBRATION_REQUIRED;
            if (!snapshot.quality?.earValid || !Number.isFinite(snapshot.metrics?.ear) ||
                !Number.isFinite(snapshot.metrics?.earThreshold)) return Status.QUALITY_INSUFFICIENT;
            const age = this.now() - Date.parse(snapshot.timestamp);
            if (!Number.isFinite(age) || age < 0 || age > namespace.Config.liveDrowsinessConfig.maximumSampleAgeMs) return Status.STALE_SAMPLE;
            return null;
        }

        _handleSnapshot(generation, snapshot) {
            if (generation !== this.generation || !this.ownership || !this.context) return null;
            const allowed = this.runtimePage.getInputModeController().canPublish({
                observationType: 'DROWSINESS', targetId: this.context.targetId,
                sourceId: this.sourceId, token: this.ownership.token
            });
            if (!allowed) { this.status = Status.ERROR; this._record('OWNERSHIP_REJECTED'); return null; }
            const blocked = this._qualityStatus(snapshot);
            if (blocked) { this.status = blocked; this._record(blocked); return null; }
            this.status = Status.PUBLISHING;
            const metrics = snapshot.metrics;
            const evidenceCodes = [];
            let episodeId = null;
            const blinkId = snapshot.diagnostics?.eye?.lastAcceptedEpisodeId || null;
            if (snapshot.diagnostics?.eye?.blinkAccepted === true && blinkId && blinkId !== this.lastBlinkEpisodeId) {
                evidenceCodes.push('BLINK_ACCEPTED'); episodeId = blinkId; this.lastBlinkEpisodeId = blinkId;
            }
            if (metrics.longClosureAccepted === true && metrics.longClosureEpisodeId && metrics.longClosureEpisodeId !== this.lastLongClosureEpisodeId) {
                evidenceCodes.push('LONG_EYE_CLOSURE_ACCEPTED'); episodeId = metrics.longClosureEpisodeId; this.lastLongClosureEpisodeId = metrics.longClosureEpisodeId;
            }
            if (Number.isInteger(metrics.yawnCount) && metrics.yawnCount > this.lastYawnCount) {
                evidenceCodes.push('YAWN_CONFIRMED'); episodeId = `yawn-${snapshot.runtimeGeneration ?? snapshot.calibrationGeneration ?? 0}-${metrics.yawnCount}`;
            }
            this.lastYawnCount = Math.max(this.lastYawnCount, Number.isInteger(metrics.yawnCount) ? metrics.yawnCount : 0);
            if (snapshot.quality?.perclosValid && Number.isFinite(metrics.perclos)) evidenceCodes.push('PERCLOS_EVIDENCE');
            if (!evidenceCodes.length) evidenceCodes.push('DROWSINESS_METRIC_UPDATE');
            const sampleAgeMs = Math.max(0, this.now() - Date.parse(snapshot.timestamp));
            const metadata = {
                vehicleType: this.context.vehicleType, vehicleId: this.context.vehicleId,
                driverId: this.context.driverId, driverAssignmentId: this.context.driverAssignmentId,
                targetId: this.context.targetId, cameraId: snapshot.cameraId,
                sensorId: `driver-camera-${snapshot.cameraId || 'primary'}`, sensorType: 'DRIVER_CAMERA',
                source: 'live-webcam', simulation: false, sensorConnected: true, operationalUseAllowed: false,
                measurementStatus: 'VALID', sampleWindowMs: 0, algorithmVersion: 'driver-perception-metrics-v1',
                configurationVersion: namespace.Config.configurationVersion, processingLocation: 'browser',
                imageStored: false, imageTransmitted: false, browserLocalProcessing: true,
                driverMetricSnapshotId: requiredText(snapshot.driverMetricSnapshotId, 'driverMetricSnapshotId'),
                snapshotTimestamp: snapshot.timestamp, derivedFromType: 'DriverMetricSnapshot',
                metrics: clone(metrics),
                quality: { confidenceAvailable: false, faceDetected: snapshot.faceDetected, calibrated: snapshot.calibrated,
                    calibrationState: snapshot.calibrationState, earValid: snapshot.quality.earValid,
                    perclosValid: snapshot.quality.perclosValid, headPoseValid: snapshot.quality.headPoseValid,
                    landmarkAvailable: snapshot.quality.landmarkAvailable, sampleAgeMs,
                    marValid: snapshot.quality.marValid === true,
                    mouthCalibrationAvailable: snapshot.quality.mouthCalibrationAvailable === true,
                    yawnMetricAvailable: snapshot.quality.yawnMetricAvailable === true },
                runtime: { processingTimeMs: snapshot.runtime?.processingTimeMs ?? null,
                    frameTimestamp: snapshot.runtime?.frameTimestamp ?? null, snapshotTimestamp: snapshot.timestamp,
                    runtimeGeneration: snapshot.runtimeGeneration ?? null },
                policy: { evidenceCodes, episodeId, sourceEvidenceType: 'LIVE_CAMERA', operationalUseAllowed: false }
            };
            const observation = global.DriverState.createDriverObservation({
                context: this.context, observationType: 'DROWSINESS', value: 'live-driver-state',
                unit: 'composite-driver-state', confidence: null, observedAt: snapshot.timestamp, metadata
            });
            this.lastObservation = observation.toJSON();
            this.lastResult = this.runtimePage.ingestObservation(observation);
            this.status = Status.RUNNING;
            this._record('OBSERVATION_PUBLISHED');
            return clone(this.lastResult);
        }

        resetTarget() {
            if (!this.context) return null;
            const targetId = this.context.targetId;
            this.stop('OPERATOR_RESET');
            return this.runtimePage.resetTarget(targetId, { observationType: 'DROWSINESS', reason: 'LIVE_TARGET_RESET' });
        }
        destroy(reason = 'PAGE_TEARDOWN') { return this.stop(reason); }
        _record(type) { this.audit.push({ type, status: this.status, timestamp: new Date(this.now()).toISOString(), targetId: this.context?.targetId || null }); }
        getState() { return clone({ status: this.status, bridgeState: [Status.STARTING, Status.RUNNING, Status.STOPPING, Status.STOPPED, Status.ERROR].includes(this.status) ? this.status : (this.unsubscribe ? Status.RUNNING : Status.STOPPED),
            generation: this.generation, source: 'LIVE_WEBCAM', bridgeOwner: this.bridgeOwner,
            subscriptionActive: typeof this.unsubscribe === 'function', startCount: this.startCount, stopCount: this.stopCount,
            currentRuntimeGeneration: this.perceptionRuntime.runtimeGeneration, boundRuntimeGeneration: this.boundRuntimeGeneration,
            lastStartReason: this.lastStartReason, lastStopReason: this.lastStopReason,
            targetId: this.context?.targetId || null, ownershipTokenActive: Boolean(this.ownership),
            lastObservation: this.lastObservation, lastResult: this.lastResult, audit: this.audit }); }
    }

    namespace.DriverCameraObservationBridgeStatus = Status;
    namespace.DriverCameraObservationBridge = DriverCameraObservationBridge;
})(window);
