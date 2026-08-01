(function configureDriverPerception(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    namespace.Config = Object.freeze({
        configurationVersion: 'driver-perception-foundation-v1',
        operationalUseAllowed: false,
        processingLocation: 'BROWSER_LOCAL',
        imageStorageAllowed: false,
        imageTransmissionAllowed: false,
        mediaPipe: Object.freeze({
            dependencyMode: 'DEVELOPMENT_ONLY_CDN',
            // Preserved exactly from the smart source. These URLs are intentionally
            // unversioned and must be replaced by reviewed, pinned local assets
            // before operational or offline Edge deployment.
            cameraUtilsUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
            faceMeshUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
            assetBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/',
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.4,
            minTrackingConfidence: 0.4
        }),
        camera: Object.freeze({
            width: 640,
            height: 480,
            frameRate: 30
        })
    });
})(window);
