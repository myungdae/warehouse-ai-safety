(function defineDriverPerceptionRuntime(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const States = Object.freeze({
        IDLE: 'IDLE', PERMISSION_REQUIRED: 'PERMISSION_REQUIRED', STARTING: 'STARTING',
        RUNNING: 'RUNNING', FACE_NOT_DETECTED: 'FACE_NOT_DETECTED', STOPPING: 'STOPPING',
        STOPPED: 'STOPPED', ERROR: 'ERROR'
    });

    class DriverPerceptionRuntime {
        constructor({ cameraManager, landmarkAdapter, metricCalculator, calibration, snapshotFactory, scheduler, cancelScheduler } = {}) {
            this.cameraManager = cameraManager || new namespace.CameraManager();
            this.landmarkAdapter = landmarkAdapter || new namespace.FaceLandmarkAdapter();
            this.metricCalculator = metricCalculator || new namespace.DriverMetricCalculator(namespace.Config.metrics);
            this.calibration = calibration || new namespace.DriverCalibration(namespace.Config.calibration);
            this.snapshotFactory = snapshotFactory || namespace.createDriverMetricSnapshot;
            this.scheduler = scheduler || global.requestAnimationFrame.bind(global);
            this.cancelScheduler = cancelScheduler || global.cancelAnimationFrame.bind(global);
            this.state = States.IDLE;
            this.videoElement = null;
            this.frameRequest = null;
            this.runToken = 0;
            this.listeners = new Set();
            this.lastLandmarkFrame = null;
            this.latestMetricSnapshot = null;
            this.metricListeners = new Set();
        }

        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
        onMetricSnapshot(listener) { this.metricListeners.add(listener); return () => this.metricListeners.delete(listener); }
        getLatestMetricSnapshot() { return this.latestMetricSnapshot; }
        startCalibration(timestamp = Date.now()) { this.metricCalculator.reset(); return this.calibration.start(timestamp); }
        resetCalibration() { this.metricCalculator.reset(); return this.calibration.reset(); }
        getCalibrationState(timestamp = Date.now()) { return this.calibration.getState(timestamp); }
        _publish(extra = {}) {
            const snapshot = Object.freeze({ state: this.state, permission: this.cameraManager.permissionState, ...extra });
            this.listeners.forEach(listener => listener(snapshot));
            return snapshot;
        }

        async start({ deviceId = '', videoElement }) {
            if ([States.STARTING, States.RUNNING, States.FACE_NOT_DETECTED].includes(this.state)) return false;
            if (!videoElement) throw new Error('VIDEO_ELEMENT_REQUIRED');
            const token = ++this.runToken;
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
            this.frameRequest = this.scheduler(async () => {
                try { await this.landmarkAdapter.process(this.videoElement); }
                catch (error) { this.state = States.ERROR; this._publish({ error: error.message }); return; }
                this._schedule(token);
            });
        }

        _handleLandmarkFrame(token, frame) {
            if (token !== this.runToken) return;
            this.lastLandmarkFrame = frame;
            let calibrationState = this.calibration.getState(Date.parse(frame.timestamp));
            const metrics = this.metricCalculator.processFrame(frame, calibrationState);
            if (calibrationState.state === namespace.CalibrationStates.COLLECTING) {
                calibrationState = this.calibration.addSample(metrics.rawEar, { valid: metrics.earValid, timestamp: Date.parse(frame.timestamp) });
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
            if (this.frameRequest !== null) this.cancelScheduler(this.frameRequest);
            this.frameRequest = null;
            this.landmarkAdapter.stop();
            const count = await this.cameraManager.stop('primary', this.videoElement);
            this.videoElement = null;
            this.lastLandmarkFrame = null;
            this.latestMetricSnapshot = null;
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
            display('baseline', calibrationState.baseline);
            display('threshold', calibrationState.threshold);
        };
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
        root.querySelector('[data-calibration-start]')?.addEventListener('click', () => renderCalibration(runtime.startCalibration()));
        root.querySelector('[data-calibration-reset]')?.addEventListener('click', () => renderCalibration(runtime.resetCalibration()));
        runtime.onMetricSnapshot(snapshot => {
            const metrics = snapshot.metrics; const quality = snapshot.quality; const calibrationState = runtime.getCalibrationState();
            display('last-frame', snapshot.runtime.frameTimestamp, 0);
            renderCalibration(calibrationState);
            display('left-ear', metrics.leftEAR); display('right-ear', metrics.rightEAR); display('ear', metrics.ear);
            display('ear-valid', quality.earValid, 0); display('eye-state', metrics.eyeClosed === null ? 'RAW ONLY' : (metrics.eyeClosed ? 'CLOSED' : 'OPEN'), 0);
            display('closure', metrics.eyeClosureDurationMs, 0); display('blink-count', metrics.blinkCount, 0); display('blink-rate', metrics.blinkRate, 1); display('perclos', metrics.perclos, 1);
            display('pitch', metrics.pitch, 1); display('roll', metrics.roll, 1); display('yaw', metrics.yaw, 1); display('pose-state', metrics.headPoseState, 0);
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
