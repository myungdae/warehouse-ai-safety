(function defineDriverPerceptionRuntime(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const States = Object.freeze({
        IDLE: 'IDLE', PERMISSION_REQUIRED: 'PERMISSION_REQUIRED', STARTING: 'STARTING',
        RUNNING: 'RUNNING', FACE_NOT_DETECTED: 'FACE_NOT_DETECTED', STOPPING: 'STOPPING',
        STOPPED: 'STOPPED', ERROR: 'ERROR'
    });

    class DriverPerceptionRuntime {
        constructor({ cameraManager, landmarkAdapter, metricCalculator, calibration, snapshotFactory, scheduler, cancelScheduler,
            canonicalTargetId = null, assignmentId = null } = {}) {
            this.cameraManager = cameraManager || new namespace.CameraManager();
            this.landmarkAdapter = landmarkAdapter || new namespace.FaceLandmarkAdapter();
            this.metricCalculator = metricCalculator || new namespace.DriverMetricCalculator(namespace.Config.metrics);
            this.calibration = calibration || new namespace.DriverCalibration({ ...namespace.Config.calibration, ...namespace.Config.yawn });
            this.snapshotFactory = snapshotFactory || namespace.createDriverMetricSnapshot;
            this.scheduler = scheduler || global.requestAnimationFrame.bind(global);
            this.cancelScheduler = cancelScheduler || global.cancelAnimationFrame.bind(global);
            this.usesInjectedScheduler = typeof scheduler === 'function';
            this.frameRequestKind = null;
            this.state = States.IDLE;
            this.videoElement = null;
            this.frameRequest = null;
            this.runToken = 0;
            this.listeners = new Set();
            this.lastLandmarkFrame = null;
            this.latestMetricSnapshot = null;
            this.metricListeners = new Set();
            this.runtimeGeneration = 0;
            this.canonicalTargetId = canonicalTargetId;
            this.assignmentId = assignmentId;
            this.guidedState = null;
            this.videoFrameCallbackCount = 0;
            this.schedulerWatchdog = null;
            this.schedulerHealth = { state: 'NOT_STARTED', reason: null, message: null,
                nextCallbackScheduled: false, videoOutsideViewport: null, callbackGapMs: null, lastCallbackAt: null };
        }

        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
        onMetricSnapshot(listener) { this.metricListeners.add(listener); return () => this.metricListeners.delete(listener); }
        getLatestMetricSnapshot() { return this.latestMetricSnapshot; }
        _videoViewportState() {
            const video = this.videoElement, rect = video?.getBoundingClientRect?.();
            const outside = !rect || rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0 ||
                rect.top >= (global.innerHeight || 0) || rect.left >= (global.innerWidth || 0);
            return Object.freeze({ videoOutsideViewport: outside, pageVisible: global.document?.visibilityState === 'visible',
                pageFocused: global.document?.hasFocus?.() === true, videoCurrentTime: Number(video?.currentTime) || 0,
                videoReadyState: video?.readyState ?? null });
        }
        getSchedulerHealth() { return Object.freeze({ ...this.schedulerHealth, ...this._videoViewportState(),
            videoFrameCallbackCount: this.videoFrameCallbackCount, scheduler: this.frameRequestKind || 'NONE' }); }
        _clearSchedulerWatchdog() { if (this.schedulerWatchdog !== null) global.clearTimeout(this.schedulerWatchdog); this.schedulerWatchdog = null; }
        _armSchedulerWatchdog(token, requestId, scheduledAt, scheduledVideoTime) {
            this._clearSchedulerWatchdog();
            this.schedulerWatchdog = global.setTimeout(() => {
                if (token !== this.runToken || this.frameRequest !== requestId) return;
                const viewport = this._videoViewportState(), callbackGapMs = Math.max(0, (global.performance?.now?.() ?? Date.now()) - scheduledAt);
                if (viewport.videoCurrentTime <= scheduledVideoTime + .1) return;
                this.schedulerHealth = { ...this.schedulerHealth, state: 'LIVE_CAMERA_THROTTLED',
                    reason: viewport.videoOutsideViewport ? 'VIDEO_PREVIEW_OUTSIDE_VIEWPORT' : 'VIDEO_FRAME_CALLBACK_STALLED',
                    message: viewport.videoOutsideViewport ? 'Video preview is outside the visible viewport. Bring the camera preview into view.'
                        : 'Live camera frame callbacks are throttled.', nextCallbackScheduled: true,
                    videoOutsideViewport: viewport.videoOutsideViewport, callbackGapMs };
                this._publish({ frameStatus: 'LIVE_CAMERA_THROTTLED', schedulerHealth: this.getSchedulerHealth() });
                global.dispatchEvent(new CustomEvent('driver-camera-throttled', { detail: this.getSchedulerHealth() }));
            }, 1000);
        }
        getLiveBridgeReadiness(expectedRuntimeGeneration = this.runtimeGeneration) {
            const camera = this.cameraManager.getLiveReadiness({ role: 'primary', videoElement: this.videoElement });
            const runtimeActive = [States.RUNNING, States.FACE_NOT_DETECTED].includes(this.state);
            const generationMatch = expectedRuntimeGeneration === this.runtimeGeneration;
            let blockedReason = null;
            if (!runtimeActive) blockedReason = 'RUNTIME_NOT_RUNNING';
            else if (camera.permission !== 'GRANTED') blockedReason = 'CAMERA_STREAM_UNAVAILABLE';
            else if (!camera.streamPresent) blockedReason = 'CAMERA_STREAM_UNAVAILABLE';
            else if (camera.videoTrackState !== 'live') blockedReason = 'VIDEO_TRACK_NOT_LIVE';
            else if (camera.trackEnabled !== true) blockedReason = 'VIDEO_TRACK_DISABLED';
            else if (!generationMatch) blockedReason = 'GENERATION_MISMATCH';
            return Object.freeze({ ...camera, runtimeState: this.state, runtimeGeneration: this.runtimeGeneration,
                expectedRuntimeGeneration, generationMatch, runtimeActive,
                readyForLiveBridge: blockedReason === null, blockedReason,
                stateSource: 'DRIVER_PERCEPTION_RUNTIME_LIVE_BRIDGE_READINESS-v1' });
        }
        startCalibration(timestamp = Date.now(), source = 'CALIBRATION_START_BUTTON') {
            let current = this.calibration.getState(timestamp);
            if (source === 'POC_EYE_CALIBRATION' && ![namespace.CalibrationStates.NOT_STARTED, namespace.CalibrationStates.RESETTING].includes(current.state)) {
                current = this.resetCalibration('POC_EYE_CALIBRATION_EXPLICIT_RESET');
            }
            if (![namespace.CalibrationStates.NOT_STARTED, namespace.CalibrationStates.RESETTING].includes(current.state)) return current;
            this.metricCalculator.reset();
            return this.calibration.start(timestamp, { runtimeGeneration: this.runtimeGeneration,
                canonicalTargetId: this.canonicalTargetId, assignmentId: this.assignmentId, source });
        }
        resetCalibration(source = 'CALIBRATION_RESET_BUTTON') { this.metricCalculator.reset(); return this.calibration.reset(true, source); }
        getCalibrationState(timestamp = Date.now()) {
            const state = this.calibration.getState(timestamp);
            const generationMatch = state.runtimeGeneration === this.runtimeGeneration;
            return Object.freeze({ ...state, boundRuntimeGeneration: state.runtimeGeneration,
                currentRuntimeGeneration: this.runtimeGeneration, generationMatch,
                calibrationState: state.state,
                frameIngestionActive: [States.RUNNING, States.FACE_NOT_DETECTED].includes(this.state) &&
                    state.state === namespace.CalibrationStates.COLLECTING && generationMatch });
        }
        setGuidedState(state) { this.guidedState = state || null; return this.getSynchronizationSnapshot(); }
        getSynchronizationSnapshot(timestamp = Date.now()) {
            const calibration = this.getCalibrationState(timestamp), guided = this.guidedState || {};
            const snapshotSessionMatch = !guided.calibrationSessionId || guided.calibrationSessionId === calibration.calibrationSessionId;
            const snapshotGenerationMatch = guided.calibrationGeneration == null || guided.calibrationGeneration === calibration.calibrationGeneration;
            let synchronizationStatus = 'SYNCHRONIZED';
            if (!snapshotSessionMatch) synchronizationStatus = 'SESSION_MISMATCH';
            else if (!snapshotGenerationMatch || calibration.runtimeGeneration !== this.runtimeGeneration) synchronizationStatus = 'GENERATION_MISMATCH';
            else if (calibration.lastStateWriter === 'STALE_CALLBACK_REJECTED') synchronizationStatus = 'STALE_CALLBACK_REJECTED';
            else if (calibration.state === namespace.CalibrationStates.INVALID) synchronizationStatus = 'BLOCKED_BY_CALIBRATION_INVALID';
            else if (calibration.state !== namespace.CalibrationStates.READY) synchronizationStatus = 'WAITING_FOR_CALIBRATION';
            return Object.freeze({ calibrationSessionId: calibration.calibrationSessionId,
                calibrationGeneration: calibration.calibrationGeneration, guidedSessionId: guided.guidedSessionId || null,
                guidedStepId: guided.step?.id || null, runtimeGeneration: this.runtimeGeneration,
                canonicalTargetId: calibration.canonicalTargetId, assignmentId: calibration.assignmentId,
                authoritativeCalibrationState: calibration.state, guidedBlockedReason: guided.blockedReason || null,
                snapshotSessionMatch, snapshotGenerationMatch,
                blinkBaselineSessionMatch: calibration.baselineSourceSessionId == null || calibration.baselineSourceSessionId === calibration.calibrationSessionId,
                lastResetSource: calibration.lastResetSource, lastStateWriter: calibration.lastStateWriter,
                lastStateTransition: calibration.lastStateTransition, synchronizationStatus });
        }
        _publish(extra = {}) {
            const snapshot = Object.freeze({ state: this.state, permission: this.cameraManager.permissionState, ...extra });
            this.listeners.forEach(listener => listener(snapshot));
            return snapshot;
        }

        async start({ deviceId = '', videoElement }) {
            if ([States.STARTING, States.RUNNING, States.FACE_NOT_DETECTED].includes(this.state)) return false;
            if (!videoElement) throw new Error('VIDEO_ELEMENT_REQUIRED');
            const token = ++this.runToken;
            this.runtimeGeneration += 1;
            this.videoElement = videoElement;
            this.state = States.STARTING;
            this._publish();
            try {
                await this.landmarkAdapter.initialize();
                await this.cameraManager.start({ role: 'primary', deviceId, videoElement });
                if (token !== this.runToken) {
                    await this.cameraManager.stop('primary', videoElement);
                    return false;
                }
                const track = this.cameraManager.streams.get('primary')?.getVideoTracks?.()[0];
                const settings = track?.getSettings?.() || {};
                this.calibration.bindRuntimeGeneration?.(this.runtimeGeneration);
                this.landmarkAdapter.start({
                    cameraId: settings.deviceId || deviceId || 'primary',
                    imageWidth: videoElement.videoWidth || settings.width || 0,
                    imageHeight: videoElement.videoHeight || settings.height || 0,
                    onLandmarkFrame: frame => this._handleLandmarkFrame(token, frame)
                });
                this.state = States.RUNNING;
                this._publish({ faceDetected: null, frameStatus: 'WAITING_FOR_FRAME' });
                this._schedule(token);
                return true;
            } catch (error) {
                this.state = error?.name === 'NotAllowedError' ? States.PERMISSION_REQUIRED : States.ERROR;
                await this.cameraManager.stop('primary', videoElement);
                this._publish({ error: error?.message || String(error) });
                throw error;
            }
        }

        _schedule(token) {
            if (token !== this.runToken || ![States.RUNNING, States.FACE_NOT_DETECTED].includes(this.state)) return;
            const process = async metadata => {
                this._clearSchedulerWatchdog();
                this.videoFrameCallbackCount += 1;
                const callbackAt = global.performance?.now?.() ?? Date.now(), previousAt = this.schedulerHealth.lastCallbackAt;
                this.schedulerHealth = { state: 'ACTIVE', reason: null, message: null, nextCallbackScheduled: false,
                    videoOutsideViewport: this._videoViewportState().videoOutsideViewport,
                    callbackGapMs: previousAt == null ? null : callbackAt - previousAt, lastCallbackAt: callbackAt };
                try { await this.landmarkAdapter.process(this.videoElement, metadata); }
                catch (error) { this.state = States.ERROR; this._publish({ error: error.message }); return; }
                this._schedule(token);
            };
            if (!this.usesInjectedScheduler && typeof this.videoElement?.requestVideoFrameCallback === 'function') {
                this.frameRequestKind = 'VIDEO_FRAME_CALLBACK';
                this.frameRequest = this.videoElement.requestVideoFrameCallback((_now, metadata) => process(metadata));
                this.schedulerHealth = { ...this.schedulerHealth, nextCallbackScheduled: true };
                this._armSchedulerWatchdog(token, this.frameRequest, global.performance?.now?.() ?? Date.now(), Number(this.videoElement.currentTime) || 0);
            } else {
                this.frameRequestKind = 'ANIMATION_FRAME';
                this.frameRequest = this.scheduler(() => process(null));
            }
        }

        _handleLandmarkFrame(token, frame) {
            if (token !== this.runToken) return;
            this.lastLandmarkFrame = frame;
            let calibrationState = this.calibration.getState(Date.parse(frame.timestamp));
            const callbackSessionId = calibrationState.calibrationSessionId;
            const callbackGeneration = calibrationState.calibrationGeneration;
            const metrics = this.metricCalculator.processFrame(frame, { ...calibrationState, currentRuntimeGeneration: this.runtimeGeneration });
            if (calibrationState.state === namespace.CalibrationStates.COLLECTING) {
                calibrationState = this.calibration.addSample(metrics.rawEar, { valid: metrics.earValid,
                    leftEAR: metrics.leftEAR, rightEAR: metrics.rightEAR,
                    pitch: metrics.pitch, yaw: metrics.yaw, roll: metrics.roll,
                    mar: metrics.marRaw, marValid: metrics.marValid, marRejectReason: metrics.marInvalidReason,
                    frameSequence: frame.frameSequence ?? null,
                    timestamp: Date.parse(frame.timestamp), expectedCalibrationSessionId: callbackSessionId,
                    expectedCalibrationGeneration: callbackGeneration });
            }
            this.latestMetricSnapshot = this.snapshotFactory({ frame, metrics, calibration: calibrationState });
            this.metricListeners.forEach(listener => listener(this.latestMetricSnapshot));
            this.state = frame.faceDetected ? States.RUNNING : States.FACE_NOT_DETECTED;
            this._publish({ faceDetected: frame.faceDetected, frameStatus: frame.status, processingTimeMs: frame.processingTimeMs, landmarkFrame: frame });
        }

        async stop() {
            if ([States.IDLE, States.STOPPED].includes(this.state)) return 0;
            this.state = States.STOPPING;
            this._publish();
            this.runToken += 1;
            if (this.frameRequest !== null) {
                if (this.frameRequestKind === 'VIDEO_FRAME_CALLBACK' && typeof this.videoElement?.cancelVideoFrameCallback === 'function')
                    this.videoElement.cancelVideoFrameCallback(this.frameRequest);
                else this.cancelScheduler(this.frameRequest);
            }
            this.frameRequest = null;
            this.frameRequestKind = null;
            this._clearSchedulerWatchdog();
            this.schedulerHealth = { state: 'STOPPED', reason: null, message: null, nextCallbackScheduled: false,
                videoOutsideViewport: null, callbackGapMs: null, lastCallbackAt: null };
            this.landmarkAdapter.stop();
            const count = await this.cameraManager.stop('primary', this.videoElement);
            this.videoElement = null;
            this.lastLandmarkFrame = null;
            this.latestMetricSnapshot = null;
            this.metricCalculator.reset();
            this.state = States.STOPPED;
            this._publish({ faceDetected: null, frameStatus: 'STOPPED' });
            return count;
        }
    }

    function mountLiveCameraFoundation(root) {
        if (!root || root.dataset.mounted === 'true') return null;
        root.dataset.mounted = 'true';
        const runtime = new DriverPerceptionRuntime();
        const select = root.querySelector('[data-camera-select]');
        const video = root.querySelector('[data-camera-video]');
        const overlay = root.querySelector('[data-camera-overlay]');
        const start = root.querySelector('[data-camera-start]');
        const stop = root.querySelector('[data-camera-stop]');
        const field = name => root.querySelector(`[data-perception-${name}]`);
        const display = (name, value, digits = 3) => {
            const target = field(name); if (!target) return;
            target.textContent = Number.isFinite(value) ? value.toFixed(digits) : (value ?? '-');
        };
        const renderCalibration = calibrationState => {
            display('calibration-state', calibrationState.state, 0);
            display('calibration-samples', calibrationState.sampleCount, 0);
            display('calibration-progress', `${Math.round(calibrationState.progress * 100)}%`, 0);
            const counts = calibrationState.completionDiagnostics?.counts || {};
            const gates = calibrationState.completionDiagnostics?.gates || {};
            display('calibration-observed', counts.observed, 0);
            display('calibration-rejected', counts.combinedRejected, 0);
            display('calibration-left-neutral', counts.leftNeutralAccepted, 0);
            display('calibration-right-neutral', counts.rightNeutralAccepted, 0);
            display('calibration-required', counts.requiredPerEye, 0);
            display('calibration-gates', `${Object.values(gates).filter(Boolean).length} / ${Object.keys(gates).length}`, 0);
            display('baseline', calibrationState.baseline);
            display('threshold', calibrationState.threshold);
            const diagnostics = field('calibration-completion-diagnostics');
            if (diagnostics) diagnostics.textContent = JSON.stringify(calibrationState.completionDiagnostics, null, 2);
            const adaptive = calibrationState.completionDiagnostics || {};
            const guidedStep = root.querySelector('[data-guided-step]');
            const guidedInstruction = root.querySelector('[data-guided-instruction]');
            const qualityProgress = `${Object.values(gates).filter(Boolean).length} / ${Object.keys(gates).length} gates; ` +
                `${adaptive.consecutivePassingEvaluations || 0} / ${adaptive.requiredPassingEvaluations || 0} confirmations; ` +
                `${adaptive.passingConfirmationDurationMs || 0} / ${adaptive.requiredPassingConfirmationMs || 0} ms`;
            if (calibrationState.state === namespace.CalibrationStates.COLLECTING) {
                if (guidedStep) guidedStep.textContent = 'Collecting stable neutral samples';
                if (guidedInstruction) guidedInstruction.textContent = calibrationState.elapsedMs < calibrationState.minimumCollectionMs
                    ? `Current quality progress: ${qualityProgress}`
                    : adaptive.persistentBlockers?.length
                        ? `Quality is marginal; collection extends automatically. Current blockers: ${adaptive.persistentBlockers.join(', ')}`
                        : `All gates pass together; confirming sustained quality. ${qualityProgress}`;
            } else if (calibrationState.state === namespace.CalibrationStates.READY) {
                if (guidedStep) guidedStep.textContent = 'READY — sustained simultaneous quality achieved';
                if (guidedInstruction) guidedInstruction.textContent = `Accepted interval: ${JSON.stringify(adaptive.selectedAcceptedInterval)}`;
            } else if (calibrationState.state === namespace.CalibrationStates.INVALID) {
                if (guidedStep) guidedStep.textContent = 'Calibration timed out';
                if (guidedInstruction) guidedInstruction.textContent = `Persistent blockers: ${(adaptive.persistentBlockers || []).join(', ') || 'UNKNOWN'}`;
            }
            const synchronization = field('calibration-synchronization');
            if (synchronization) synchronization.textContent = JSON.stringify(runtime.getSynchronizationSnapshot(), null, 2);
        };
        let latestMouthMetrics = null;
        const drawOverlay = frame => {
            if (!overlay) return;
            const width = frame.imageWidth || video.videoWidth || 640;
            const height = frame.imageHeight || video.videoHeight || 480;
            overlay.width = width; overlay.height = height;
            const context = overlay.getContext('2d'); context.clearRect(0, 0, width, height);
            if (!frame.faceDetected || !Array.isArray(frame.landmarks)) return;
            const drawPath = indices => {
                context.beginPath();
                indices.forEach((index, offset) => {
                    const point = frame.landmarks[index]; if (!point) return;
                    const x = point.x * width, y = point.y * height;
                    if (offset === 0) context.moveTo(x, y); else context.lineTo(x, y);
                });
                context.closePath(); context.stroke();
            };
            context.strokeStyle = '#00d4ff'; context.lineWidth = 2;
            drawPath(namespace.Config.metrics.leftEyeIndices); drawPath(namespace.Config.metrics.rightEyeIndices);
            const outline = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 152, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
            context.strokeStyle = 'rgba(0,212,255,.45)'; drawPath(outline);
            context.strokeStyle = '#f59e0b'; drawPath(namespace.Config.metrics.mouthIndices.contour);
            if (latestMouthMetrics) {
                context.fillStyle = latestMouthMetrics.yawnConfirmed ? '#ef4444' : '#fbbf24';
                context.font = 'bold 16px ui-monospace, monospace';
                const marText = Number.isFinite(latestMouthMetrics.marSmoothed) ? latestMouthMetrics.marSmoothed.toFixed(3) : 'UNKNOWN';
                context.fillText(`MAR ${marText} · ${latestMouthMetrics.yawnState}`, 12, height - 16);
            }
        };
        const refresh = async (preferredDeviceId = select.value) => {
            try {
                const cameras = await runtime.cameraManager.enumerateDevices();
                select.replaceChildren(...cameras.map((camera, index) => {
                    const option = document.createElement('option'); option.value = camera.deviceId;
                    option.textContent = camera.label || `Camera ${index + 1}`;
                    return option;
                }));
                if (cameras.some(camera => camera.deviceId === preferredDeviceId)) select.value = preferredDeviceId;
            } catch (error) {
                select.replaceChildren(new Option('Camera enumeration unavailable', ''));
                render({ state: States.ERROR, permission: runtime.cameraManager.permissionState, frameStatus: error.message });
            }
        };
        const render = snapshot => {
            if (field('permission')) field('permission').textContent = snapshot.permission;
            if (field('state')) field('state').textContent = snapshot.state;
            if (field('face')) field('face').textContent = snapshot.faceDetected === null || snapshot.faceDetected === undefined
                ? 'NOT EVALUATED' : (snapshot.faceDetected ? 'DETECTED' : 'NOT DETECTED');
            if (field('frame')) field('frame').textContent = snapshot.frameStatus || 'IDLE';
            const loader = runtime.landmarkAdapter.getLoaderDiagnostics?.() || {};
            if (field('mediapipe-source')) field('mediapipe-source').textContent = loader.source || 'UNKNOWN';
            if (field('mediapipe-version')) field('mediapipe-version').textContent = loader.version || '-';
            if (field('mediapipe-loader')) field('mediapipe-loader').textContent = loader.loaderState || 'NOT_STARTED';
            if (field('mediapipe-missing')) field('mediapipe-missing').textContent = loader.missingAssetFilename || 'NONE';
            if (field('mediapipe-error')) field('mediapipe-error').textContent = loader.initializationError || 'NONE';
            const camera = runtime.cameraManager.getDiagnostics?.() || {};
            if (field('camera-open-state')) field('camera-open-state').textContent = camera.cameraOpenState || 'IDLE';
            if (field('camera-requested-device')) field('camera-requested-device').textContent = camera.requestedDeviceId || 'DEFAULT';
            if (field('camera-opened-device')) field('camera-opened-device').textContent = camera.openedDeviceId || 'NONE';
            if (field('camera-stream-id')) field('camera-stream-id').textContent = camera.streamId || 'NONE';
            if (field('camera-track-state')) field('camera-track-state').textContent = camera.videoTrackState || 'NONE';
            if (field('camera-track-enabled')) field('camera-track-enabled').textContent = camera.trackEnabled == null ? 'UNKNOWN' : String(camera.trackEnabled);
            if (field('camera-track-muted')) field('camera-track-muted').textContent = camera.trackMuted == null ? 'UNKNOWN' : String(camera.trackMuted);
            if (field('camera-resolution')) field('camera-resolution').textContent = camera.width && camera.height ? `${camera.width} × ${camera.height}` : 'UNKNOWN';
            if (field('camera-fps')) field('camera-fps').textContent = camera.frameRate ?? 'UNKNOWN';
            if (field('camera-label')) field('camera-label').textContent = camera.cameraLabel || 'UNKNOWN';
            if (field('camera-error')) field('camera-error').textContent = camera.lastCameraError
                ? `${camera.lastCameraError.name}: ${camera.lastCameraError.message}` : 'NONE';
            if (field('camera-error-stack')) field('camera-error-stack').textContent = camera.lastCameraError?.stack || 'NONE';
            const scheduler = runtime.getSchedulerHealth();
            if (field('scheduler-health')) field('scheduler-health').textContent = scheduler.state;
            if (field('scheduler-reason')) field('scheduler-reason').textContent = scheduler.reason || 'NONE';
            if (field('scheduler-message')) field('scheduler-message').textContent = scheduler.message || 'NONE';
            if (field('video-viewport')) field('video-viewport').textContent = scheduler.videoOutsideViewport ? 'OUTSIDE VIEWPORT' : 'VISIBLE';
            if (field('camera-constraints')) field('camera-constraints').textContent = JSON.stringify(camera.requestedConstraints || {}, null, 2);
            if (field('camera-stop-verification')) field('camera-stop-verification').textContent = JSON.stringify(camera.trackStopVerification || [], null, 2);
            if (snapshot.landmarkFrame) drawOverlay(snapshot.landmarkFrame);
            if (snapshot.frameStatus === 'STOPPED' && overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
            start.disabled = [States.STARTING, States.RUNNING, States.FACE_NOT_DETECTED].includes(snapshot.state);
            stop.disabled = !start.disabled && snapshot.state !== States.ERROR;
        };
        runtime.subscribe(render);
        render({ state: States.IDLE, permission: runtime.cameraManager.permissionState });

        refresh();
        start.addEventListener('click', async () => {
            try {
                const selectedDeviceId = select.value;
                await runtime.start({ deviceId: selectedDeviceId, videoElement: video });
                await refresh(selectedDeviceId);
            }
            catch (_) { /* Runtime state presents the error without creating observations. */ }
        });
        stop.addEventListener('click', () => runtime.stop());
        root.querySelector('[data-calibration-start]')?.addEventListener('click', () => {
            const state = runtime.startCalibration(); renderCalibration(state);
            root.dispatchEvent(new CustomEvent('driver-calibration-started', { detail: state }));
        });
        root.querySelector('[data-calibration-reset]')?.addEventListener('click', () => {
            const state = runtime.resetCalibration(); renderCalibration(state);
            root.dispatchEvent(new CustomEvent('driver-calibration-reset', { detail: state }));
        });
        runtime.onMetricSnapshot(snapshot => {
            const metrics = snapshot.metrics; const quality = snapshot.quality; const debug = snapshot.diagnostics; const calibrationState = runtime.getCalibrationState();
            latestMouthMetrics = metrics;
            display('last-frame', snapshot.runtime.frameTimestamp, 0);
            renderCalibration(calibrationState);
            display('left-ear', metrics.leftEAR); display('right-ear', metrics.rightEAR); display('ear', metrics.ear);
            display('left-baseline', metrics.leftBaseline); display('right-baseline', metrics.rightBaseline);
            display('left-closure-ratio', metrics.leftClosureRatio); display('right-closure-ratio', metrics.rightClosureRatio);
            display('left-eye-state', debug.eye.leftEyeState, 0); display('right-eye-state', debug.eye.rightEyeState, 0);
            display('blink-episode-state', debug.eye.episodeState, 0); display('blink-armed', debug.eye.armed ? 'ARMED' : 'NOT ARMED', 0);
            display('rearm-pending', debug.eye.episodeState === 'REARM_PENDING', 0); display('bilateral-correlation', debug.eye.bilateralCorrelationMs, 0);
            display('calibration-quality', debug.eye.calibrationQuality, 0); display('episode-reject', debug.eye.blinkRejectReason, 0);
            display('ear-valid', quality.earValid, 0); display('eye-state', metrics.eyeClosed === null ? 'RAW ONLY' : (metrics.eyeClosed ? 'CLOSED' : 'OPEN'), 0);
            display('closure', metrics.eyeClosureDurationMs, 0); display('blink-count', metrics.blinkCount, 0); display('blink-rate', metrics.blinkRate, 1); display('perclos', metrics.perclos, 1);
            display('gate-calibration', snapshot.calibrated, 0); display('gate-bilateral', debug.eye.earValid && !debug.eye.oneEyeOnly, 0);
            display('gate-one-eye', debug.eye.oneEyeOnly, 0); display('gate-blink-candidate', debug.eye.blinkCandidate, 0);
            display('gate-blink-accepted', debug.eye.blinkAccepted, 0); display('gate-blink-reason', debug.eye.blinkRejectReason, 0);
            display('pitch', metrics.pitch, 1); display('roll', metrics.roll, 1); display('yaw', metrics.yaw, 1); display('pose-state', metrics.headPoseState, 0);
            display('neutral-pitch', metrics.neutralPitch, 1); display('neutral-roll', metrics.neutralRoll, 1); display('neutral-yaw', metrics.neutralYaw, 1);
            display('pitch-delta', metrics.pitchDelta, 1); display('roll-delta', metrics.rollDelta, 1); display('yaw-delta', metrics.yawDelta, 1);
            display('mar-raw', metrics.marRaw); display('mar-smoothed', metrics.marSmoothed); display('mar-valid', quality.marValid, 0);
            display('mouth-baseline', metrics.mouthBaseline); display('mouth-threshold', metrics.mouthOpenThreshold);
            display('mouth-state', metrics.mouthOpen === null ? 'INVALID' : (metrics.mouthOpen ? 'OPEN' : 'CLOSED'), 0);
            display('gate-mar-reason', debug.mouth.marInvalidReason, 0); display('gate-mouth-pose', debug.mouth.headPoseAllowsMouthMetric, 0);
            display('gate-pitch', `${metrics.pitch == null ? '-' : metrics.pitch.toFixed(1)} / allowed ±${debug.mouth.pitchLimit} => ${metrics.pitch != null && Math.abs(metrics.pitch) > debug.mouth.pitchLimit ? 'OUT_OF_RANGE' : 'IN_RANGE'}`, 0);
            display('gate-yaw', `${metrics.yaw == null ? '-' : metrics.yaw.toFixed(1)} / allowed ±${debug.mouth.yawLimit} => ${metrics.yaw != null && Math.abs(metrics.yaw) > debug.mouth.yawLimit ? 'OUT_OF_RANGE' : 'IN_RANGE'}`, 0);
            display('gate-roll', `${metrics.roll == null ? '-' : metrics.roll.toFixed(1)} / allowed ±${debug.mouth.rollLimit} => ${metrics.roll != null && Math.abs(metrics.roll) > debug.mouth.rollLimit ? 'OUT_OF_RANGE' : 'IN_RANGE'}`, 0);
            display('gate-mouth-calibration', quality.mouthCalibrationAvailable, 0);
            display('mouth-duration', metrics.mouthOpenDurationMs, 0); display('yawn-state', metrics.yawnState, 0);
            display('yawn-candidate', metrics.yawnCandidate, 0); display('yawn-confirmed', metrics.yawnConfirmed, 0);
            display('yawn-count', metrics.yawnCount, 0); display('last-yawn', metrics.lastYawnDurationMs, 0);
            display('debug-ear-raw', debug.eye.rawEAR); display('debug-ear-smooth', debug.eye.smoothedEAR);
            display('debug-ear-threshold', debug.eye.activeEARThreshold); display('debug-closure', debug.eye.currentClosureDurationMs, 0);
            display('debug-blink-candidate', debug.eye.blinkCandidate, 0); display('debug-blink-accepted', debug.eye.blinkAccepted, 0);
            display('debug-blink-reason', debug.eye.blinkRejectReason || '-', 0); display('debug-frame-delta', debug.eye.frameDeltaMs, 0);
            display('debug-mouth-width', debug.mouth.mouthWidth); display('debug-mouth-vertical', JSON.stringify(debug.mouth.verticalDistances), 0);
            display('debug-mar-raw', debug.mouth.marRaw); display('debug-mar-smooth', debug.mouth.marSmoothed);
            display('debug-mar-reason', debug.mouth.marInvalidReason || '-', 0); display('debug-mouth-accepted', debug.mouth.calibrationAccepted, 0);
            display('debug-mouth-rejected', debug.mouth.calibrationRejected, 0); display('debug-mouth-reject-reason', debug.mouth.lastCalibrationRejectReason || '-', 0);
            display('debug-mouth-calibration', debug.mouth.calibrationState, 0); display('debug-mouth-baseline-ready', debug.mouth.baselineReady, 0);
            display('debug-face', debug.quality.faceDetected, 0); display('debug-landmark', debug.quality.landmarkAvailable, 0);
            display('debug-head-pose', debug.mouth.headPoseAllowsMouthMetric, 0); display('debug-sample-age', debug.quality.sampleAgeMs, 0);
            display('debug-processing-time', debug.quality.processingTimeMs, 0);
            display('snapshot-time', snapshot.timestamp, 0);
            const json = field('snapshot-json'); if (json) json.textContent = JSON.stringify(snapshot, null, 2);
        });
        global.addEventListener('pagehide', () => runtime.stop(), { once: true });
        root.driverPerceptionRuntime = runtime;
        return runtime;
    }

    namespace.States = States;
    namespace.DriverPerceptionRuntime = DriverPerceptionRuntime;
    namespace.mountLiveCameraFoundation = mountLiveCameraFoundation;
    document.addEventListener('DOMContentLoaded', () => mountLiveCameraFoundation(document.querySelector('[data-driver-perception-root]')));
})(window);
