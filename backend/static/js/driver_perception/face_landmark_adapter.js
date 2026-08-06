(function defineFaceLandmarkAdapter(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    class FaceLandmarkAdapter {
        constructor({ config, faceMeshFactory, scriptLoader, clock, monotonicClock, timeOrigin } = {}) {
            this.config = config || namespace.Config?.mediaPipe;
            this.faceMeshFactory = faceMeshFactory || null;
            this.scriptLoader = scriptLoader || FaceLandmarkAdapter.loadScript;
            this.clock = clock || (() => Date.now());
            this.monotonicClock = monotonicClock || (() => global.performance?.now?.() ?? Date.now());
            this.timeOrigin = Number.isFinite(timeOrigin) ? timeOrigin
                : (Number.isFinite(global.performance?.timeOrigin) ? global.performance.timeOrigin : Date.now() - this.monotonicClock());
            this.faceMesh = null;
            this.initialized = false;
            this.generation = 0;
            this.pendingFrame = null;
            this.callback = null;
            this.cameraId = null;
            this.imageSize = { width: 0, height: 0 };
            this.loaderState = 'NOT_STARTED';
            this.missingAssetFilename = null;
            this.initializationError = null;
            this.frameSequence = 0;
            this.resultSequence = 0;
            this.duplicateResultCount = 0;
            this.droppedResultEstimate = 0;
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
            this.loaderState = 'LOADING_LOCAL_ASSETS';
            this.missingAssetFilename = null;
            this.initializationError = null;
            try {
            if (!this.faceMeshFactory) {
                await this._preflightLocalAssets();
                await this.scriptLoader(this.config.cameraUtilsUrl);
                await this.scriptLoader(this.config.faceMeshUrl);
                if (typeof global.FaceMesh !== 'function') throw new Error('MEDIAPIPE_FACEMESH_UNAVAILABLE');
                this.faceMeshFactory = options => new global.FaceMesh(options);
            }

            this.faceMesh = this.faceMeshFactory({ locateFile: file => this.locateFile(file) });
            this.faceMesh.setOptions({
                maxNumFaces: this.config.maxNumFaces,
                refineLandmarks: this.config.refineLandmarks,
                minDetectionConfidence: this.config.minDetectionConfidence,
                minTrackingConfidence: this.config.minTrackingConfidence
            });
            this.faceMesh.onResults(results => this._handleResults(results));
            if (typeof this.faceMesh.initialize === 'function') await this.faceMesh.initialize();
            this.initialized = true;
            this.loaderState = 'READY';
            } catch (error) {
                this.loaderState = this.missingAssetFilename ? 'LOCAL_ASSET_MISSING' : 'ERROR';
                this.initializationError = error?.message || String(error);
                throw error;
            }
        }

        locateFile(file) {
            const allowed = new Set(this.config.requiredAssets || []);
            if (!allowed.has(file)) {
                this.missingAssetFilename = file;
                throw new Error(`LOCAL_ASSET_MISSING:${file}`);
            }
            return `${this.config.assetBaseUrl}${file}`;
        }

        async _preflightLocalAssets() {
            if (this.config.source !== 'LOCAL') throw new Error('MEDIAPIPE_LOCAL_SOURCE_REQUIRED');
            const urls = [this.config.cameraUtilsUrl, this.config.faceMeshUrl,
                ...(this.config.requiredAssets || []).map(file => `${this.config.assetBaseUrl}${file}`)];
            if (urls.some(url => !String(url).startsWith('/static/vendor/mediapipe/'))) throw new Error('MEDIAPIPE_EXTERNAL_URL_REJECTED');
            for (const url of urls) {
                const response = await global.fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
                if (!response.ok) {
                    this.missingAssetFilename = url.split('/').pop();
                    throw new Error(`LOCAL_ASSET_MISSING:${this.missingAssetFilename}`);
                }
            }
        }

        getLoaderDiagnostics() {
            return Object.freeze({ source: this.config?.source || 'UNKNOWN',
                version: this.config?.packages?.faceMesh?.version || null, loaderState: this.loaderState,
                missingAssetFilename: this.missingAssetFilename, initializationError: this.initializationError });
        }

        start({ cameraId, imageWidth, imageHeight, onLandmarkFrame }) {
            if (!this.initialized) throw new Error('MEDIAPIPE_NOT_INITIALIZED');
            this.generation += 1;
            this.cameraId = cameraId || 'primary';
            this.imageSize = { width: Number(imageWidth) || 0, height: Number(imageHeight) || 0 };
            this.callback = typeof onLandmarkFrame === 'function' ? onLandmarkFrame : null;
            return this.generation;
        }

        async process(videoElement, videoFrameMetadata = null) {
            if (!this.callback || !this.faceMesh) return false;
            const generation = this.generation;
            const submissionTimestampMs = this.monotonicClock();
            const metadataTimestamp = Number(videoFrameMetadata?.expectedDisplayTime);
            const captureTimestampMs = Number.isFinite(metadataTimestamp) ? metadataTimestamp : submissionTimestampMs;
            const timestampSource = Number.isFinite(metadataTimestamp)
                ? 'VIDEO_FRAME_EXPECTED_DISPLAY_TIME' : 'PERFORMANCE_NOW_AT_SUBMISSION';
            if (this.pendingFrame) this.droppedResultEstimate += 1;
            this.pendingFrame = { generation, captureTimestampMs, submissionTimestampMs, timestampSource,
                frameSequence: ++this.frameSequence, mediaTimeMs: Number.isFinite(videoFrameMetadata?.mediaTime) ? videoFrameMetadata.mediaTime * 1000 : null };
            await this.faceMesh.send({ image: videoElement });
            return generation === this.generation;
        }

        _handleResults(results) {
            const pending = this.pendingFrame;
            const resultCallbackTimestampMs = this.monotonicClock();
            if (!pending || pending.generation !== this.generation || !this.callback) {
                this.duplicateResultCount += 1;
                return;
            }
            this.pendingFrame = null;
            this.resultSequence += 1;
            const faces = Array.isArray(results?.multiFaceLandmarks) ? results.multiFaceLandmarks : [];
            const landmarks = faces.length > 0 ? faces[0] : null;
            this.callback(Object.freeze({
                timestamp: new Date(this.timeOrigin + pending.captureTimestampMs).toISOString(),
                captureTimestampMs: pending.captureTimestampMs,
                submissionTimestampMs: pending.submissionTimestampMs,
                resultCallbackTimestampMs,
                timestampSource: pending.timestampSource,
                callbackLatencyMs: Math.max(0, resultCallbackTimestampMs - pending.submissionTimestampMs),
                frameSequence: pending.frameSequence,
                mediaTimeMs: pending.mediaTimeMs,
                duplicateResult: false,
                duplicateResultCount: this.duplicateResultCount,
                droppedResultEstimate: this.droppedResultEstimate,
                cameraId: this.cameraId,
                faceDetected: Boolean(landmarks),
                landmarks: landmarks || null,
                imageWidth: this.imageSize.width,
                imageHeight: this.imageSize.height,
                processingTimeMs: Math.max(0, resultCallbackTimestampMs - pending.submissionTimestampMs),
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
