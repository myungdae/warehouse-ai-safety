(function defineDriverPerceptionRuntime(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};
    const States = Object.freeze({
        IDLE: 'IDLE', PERMISSION_REQUIRED: 'PERMISSION_REQUIRED', STARTING: 'STARTING',
        RUNNING: 'RUNNING', FACE_NOT_DETECTED: 'FACE_NOT_DETECTED', STOPPING: 'STOPPING',
        STOPPED: 'STOPPED', ERROR: 'ERROR'
    });

    class DriverPerceptionRuntime {
        constructor({ cameraManager, landmarkAdapter, scheduler, cancelScheduler } = {}) {
            this.cameraManager = cameraManager || new namespace.CameraManager();
            this.landmarkAdapter = landmarkAdapter || new namespace.FaceLandmarkAdapter();
            this.scheduler = scheduler || global.requestAnimationFrame.bind(global);
            this.cancelScheduler = cancelScheduler || global.cancelAnimationFrame.bind(global);
            this.state = States.IDLE;
            this.videoElement = null;
            this.frameRequest = null;
            this.runToken = 0;
            this.listeners = new Set();
            this.lastLandmarkFrame = null;
        }

        subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
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
            this.state = frame.faceDetected ? States.RUNNING : States.FACE_NOT_DETECTED;
            this._publish({ faceDetected: frame.faceDetected, frameStatus: frame.status, processingTimeMs: frame.processingTimeMs });
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
        const start = root.querySelector('[data-camera-start]');
        const stop = root.querySelector('[data-camera-stop]');
        const field = name => root.querySelector(`[data-perception-${name}]`);
        const render = snapshot => {
            if (field('permission')) field('permission').textContent = snapshot.permission;
            if (field('state')) field('state').textContent = snapshot.state;
            if (field('face')) field('face').textContent = snapshot.faceDetected === null || snapshot.faceDetected === undefined
                ? 'NOT EVALUATED' : (snapshot.faceDetected ? 'DETECTED' : 'NOT DETECTED');
            if (field('frame')) field('frame').textContent = snapshot.frameStatus || 'IDLE';
            start.disabled = [States.STARTING, States.RUNNING, States.FACE_NOT_DETECTED].includes(snapshot.state);
            stop.disabled = !start.disabled && snapshot.state !== States.ERROR;
        };
        runtime.subscribe(render);
        render({ state: States.IDLE, permission: runtime.cameraManager.permissionState });

        const refresh = async () => {
            try {
                const cameras = await runtime.cameraManager.enumerateDevices();
                select.replaceChildren(...cameras.map((camera, index) => {
                    const option = document.createElement('option');
                    option.value = camera.deviceId;
                    option.textContent = camera.label || `Camera ${index + 1}`;
                    return option;
                }));
            } catch (error) {
                select.replaceChildren(new Option('Camera enumeration unavailable', ''));
                render({ state: States.ERROR, permission: runtime.cameraManager.permissionState, frameStatus: error.message });
            }
        };
        refresh();
        start.addEventListener('click', async () => {
            try { await runtime.start({ deviceId: select.value, videoElement: video }); }
            catch (_) { /* Runtime state presents the error without creating observations. */ }
        });
        stop.addEventListener('click', () => runtime.stop());
        global.addEventListener('pagehide', () => runtime.stop(), { once: true });
        root.driverPerceptionRuntime = runtime;
        return runtime;
    }

    namespace.States = States;
    namespace.DriverPerceptionRuntime = DriverPerceptionRuntime;
    namespace.mountLiveCameraFoundation = mountLiveCameraFoundation;
    document.addEventListener('DOMContentLoaded', () => mountLiveCameraFoundation(document.querySelector('[data-driver-perception-root]')));
})(window);
