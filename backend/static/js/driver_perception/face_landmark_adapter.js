(function defineFaceLandmarkAdapter(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    class FaceLandmarkAdapter {
        constructor({ config, faceMeshFactory, scriptLoader, clock } = {}) {
            this.config = config || namespace.Config?.mediaPipe;
            this.faceMeshFactory = faceMeshFactory || null;
            this.scriptLoader = scriptLoader || FaceLandmarkAdapter.loadScript;
            this.clock = clock || (() => Date.now());
            this.faceMesh = null;
            this.initialized = false;
            this.generation = 0;
            this.pendingFrame = null;
            this.callback = null;
            this.cameraId = null;
            this.imageSize = { width: 0, height: 0 };
        }

        static loadScript(url) {
            return new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[data-driver-perception-src="${url}"]`);
                if (existing?.dataset.loaded === 'true') return resolve();
                const script = existing || document.createElement('script');
                script.dataset.driverPerceptionSrc = url;
                script.src = url;
                script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
                script.onerror = () => reject(new Error(`MEDIAPIPE_SCRIPT_LOAD_FAILED: ${url}`));
                if (!existing) document.head.appendChild(script);
            });
        }

        async initialize() {
            if (this.initialized) return;
            if (!this.config) throw new Error('MEDIAPIPE_CONFIG_REQUIRED');
            if (!this.faceMeshFactory) {
                await this.scriptLoader(this.config.cameraUtilsUrl);
                await this.scriptLoader(this.config.faceMeshUrl);
                if (typeof global.FaceMesh !== 'function') throw new Error('MEDIAPIPE_FACEMESH_UNAVAILABLE');
                this.faceMeshFactory = options => new global.FaceMesh(options);
            }

            this.faceMesh = this.faceMeshFactory({ locateFile: file => `${this.config.assetBaseUrl}${file}` });
            this.faceMesh.setOptions({
                maxNumFaces: this.config.maxNumFaces,
                refineLandmarks: this.config.refineLandmarks,
                minDetectionConfidence: this.config.minDetectionConfidence,
                minTrackingConfidence: this.config.minTrackingConfidence
            });
            this.faceMesh.onResults(results => this._handleResults(results));
            if (typeof this.faceMesh.initialize === 'function') await this.faceMesh.initialize();
            this.initialized = true;
        }

        start({ cameraId, imageWidth, imageHeight, onLandmarkFrame }) {
            if (!this.initialized) throw new Error('MEDIAPIPE_NOT_INITIALIZED');
            this.generation += 1;
            this.cameraId = cameraId || 'primary';
            this.imageSize = { width: Number(imageWidth) || 0, height: Number(imageHeight) || 0 };
            this.callback = typeof onLandmarkFrame === 'function' ? onLandmarkFrame : null;
            return this.generation;
        }

        async process(videoElement) {
            if (!this.callback || !this.faceMesh) return false;
            const generation = this.generation;
            const startedAt = this.clock();
            this.pendingFrame = { generation, startedAt };
            await this.faceMesh.send({ image: videoElement });
            return generation === this.generation;
        }

        _handleResults(results) {
            const pending = this.pendingFrame;
            if (!pending || pending.generation !== this.generation || !this.callback) return;
            this.pendingFrame = null;
            const faces = Array.isArray(results?.multiFaceLandmarks) ? results.multiFaceLandmarks : [];
            const landmarks = faces.length > 0 ? faces[0] : null;
            this.callback(Object.freeze({
                timestamp: new Date(this.clock()).toISOString(),
                cameraId: this.cameraId,
                faceDetected: Boolean(landmarks),
                landmarks: landmarks || null,
                imageWidth: this.imageSize.width,
                imageHeight: this.imageSize.height,
                processingTimeMs: Math.max(0, this.clock() - pending.startedAt),
                status: landmarks ? 'LANDMARKS_AVAILABLE' : 'FACE_NOT_DETECTED'
            }));
        }

        stop() {
            this.generation += 1;
            this.pendingFrame = null;
            this.callback = null;
            this.cameraId = null;
        }

        async close() {
            this.stop();
            if (typeof this.faceMesh?.close === 'function') await this.faceMesh.close();
            this.faceMesh = null;
            this.initialized = false;
        }
    }

    namespace.FaceLandmarkAdapter = FaceLandmarkAdapter;
})(window);
