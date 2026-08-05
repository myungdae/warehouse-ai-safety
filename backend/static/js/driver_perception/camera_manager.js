(function defineCameraManager(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    class CameraManager {
        constructor({ mediaDevices, cameraConfig, development = true } = {}) {
            this.mediaDevices = mediaDevices || global.navigator?.mediaDevices;
            this.cameraConfig = cameraConfig || namespace.Config?.camera || {};
            this.permissionState = 'UNKNOWN';
            this.streams = new Map();
            this.deviceRoles = new Map();
            this.pendingStarts = new Map();
            this.disconnectListeners = new Map();
            this.development = development === true;
            this.deviceLabels = new Map();
            this.cameraAudit = [];
            this.diagnostics = this._emptyDiagnostics();
        }

        _emptyDiagnostics() {
            return { cameraOpenState: 'IDLE', requestedConstraints: null, requestedDeviceId: null,
                openedDeviceId: null, cameraLabel: null, streamId: null, videoTrackState: null,
                trackEnabled: null, trackMuted: null, facingMode: null, width: null, height: null,
                frameRate: null, lastCameraError: null, trackStopVerification: [] };
        }

        _record(eventType, details = {}) {
            const entry = Object.freeze({ timestamp: new Date().toISOString(), eventType, ...details });
            this.cameraAudit.push(entry);
            global.console?.debug?.('[CameraManager]', eventType, details);
            return entry;
        }

        _errorDetails(error) {
            return Object.freeze({ name: error?.name || 'Error', message: error?.message || String(error),
                stack: this.development ? (error?.stack || null) : null,
                constraint: error?.constraint || null });
        }

        _requireMediaDevices(method) {
            if (!this.mediaDevices || typeof this.mediaDevices[method] !== 'function') {
                throw new Error(`MEDIA_DEVICES_${method.toUpperCase()}_UNAVAILABLE`);
            }
        }

        async enumerateDevices() {
            this._requireMediaDevices('enumerateDevices');
            const devices = await this.mediaDevices.enumerateDevices();
            const cameras = devices
                .filter(device => device.kind === 'videoinput')
                .map(device => ({
                    deviceId: device.deviceId,
                    groupId: device.groupId || '',
                    label: device.label || 'Camera permission required'
                }));
            cameras.forEach(camera => this.deviceLabels.set(camera.deviceId, camera.label));
            return cameras;
        }

        async start({ role = 'primary', deviceId = '', videoElement = null } = {}) {
            if (this.isActive(role)) {
                const stream = this.streams.get(role);
                this.diagnostics = { ...this.diagnostics, cameraOpenState: 'STREAM_ALREADY_OPEN',
                    streamId: stream?.id || null };
                this._record('STREAM_ALREADY_OPEN', { role, streamId: stream?.id || null });
                return stream;
            }
            if (this.pendingStarts.has(role)) return this.pendingStarts.get(role);
            if (deviceId && this.deviceRoles.has(deviceId) && this.deviceRoles.get(deviceId) !== role) {
                throw new Error(`CAMERA_DEVICE_ALREADY_ACTIVE: ${deviceId}`);
            }
            this._requireMediaDevices('getUserMedia');

            const startPromise = this._startStream({ role, deviceId, videoElement });
            this.pendingStarts.set(role, startPromise);
            try {
                return await startPromise;
            } finally {
                this.pendingStarts.delete(role);
            }
        }

        async _startStream({ role, deviceId, videoElement }) {
            const video = {
                width: { ideal: this.cameraConfig.width || 640 },
                height: { ideal: this.cameraConfig.height || 480 },
                frameRate: { ideal: this.cameraConfig.frameRate || 30 }
            };
            if (deviceId) video.deviceId = { exact: deviceId };
            const constraints = { video, audio: false };
            const stopVerification = await this._stopExistingTracksBeforeOpen();
            this.diagnostics = { ...this._emptyDiagnostics(), cameraOpenState: 'REQUESTING',
                requestedConstraints: JSON.parse(JSON.stringify(constraints)), requestedDeviceId: deviceId || null,
                cameraLabel: this.deviceLabels.get(deviceId) || null, trackStopVerification: stopVerification };
            this._record('GET_USER_MEDIA_REQUESTED', { role, selectedDeviceId: deviceId || null,
                cameraLabel: this.deviceLabels.get(deviceId) || null, constraints: this.diagnostics.requestedConstraints,
                trackStopVerification: stopVerification });

            try {
                const stream = await this.mediaDevices.getUserMedia(constraints);
                this.permissionState = 'GRANTED';
                const track = stream.getVideoTracks?.()[0] || null;
                const settings = track?.getSettings?.() || {};
                const actualDeviceId = settings.deviceId || deviceId;
                if (actualDeviceId && this.deviceRoles.has(actualDeviceId) && this.deviceRoles.get(actualDeviceId) !== role) {
                    stream.getTracks().forEach(track => track.stop());
                    throw new Error(`CAMERA_DEVICE_ALREADY_ACTIVE: ${actualDeviceId}`);
                }
                this.streams.set(role, stream);
                if (actualDeviceId) this.deviceRoles.set(actualDeviceId, role);
                this._watchForDisconnect(role, stream);
                this.diagnostics = { ...this.diagnostics, cameraOpenState: 'OPEN', openedDeviceId: actualDeviceId || null,
                    cameraLabel: track?.label || this.deviceLabels.get(actualDeviceId) || this.deviceLabels.get(deviceId) || null,
                    streamId: stream.id || null, videoTrackState: track?.readyState || null,
                    trackEnabled: typeof track?.enabled === 'boolean' ? track.enabled : null,
                    trackMuted: typeof track?.muted === 'boolean' ? track.muted : null,
                    facingMode: settings.facingMode || null, width: settings.width || null,
                    height: settings.height || null, frameRate: settings.frameRate || null, lastCameraError: null };
                this._record('GET_USER_MEDIA_OPENED', { role, selectedDeviceId: deviceId || null,
                    actualDeviceId: actualDeviceId || null, cameraLabel: this.diagnostics.cameraLabel,
                    facingMode: this.diagnostics.facingMode, width: this.diagnostics.width,
                    height: this.diagnostics.height, frameRate: this.diagnostics.frameRate,
                    streamId: this.diagnostics.streamId });
                if (videoElement) {
                    videoElement.srcObject = stream;
                    if (typeof videoElement.play === 'function') await videoElement.play();
                }
                return stream;
            } catch (error) {
                this.permissionState = ['NotAllowedError', 'SecurityError'].includes(error?.name)
                    ? 'DENIED'
                    : 'ERROR';
                const details = this._errorDetails(error);
                this.diagnostics = { ...this.diagnostics, cameraOpenState: 'ERROR', lastCameraError: details };
                this._record('GET_USER_MEDIA_FAILED', { role, selectedDeviceId: deviceId || null, error: details });
                throw error;
            }
        }

        async _stopExistingTracksBeforeOpen() {
            const verification = [];
            for (const [existingRole, stream] of this.streams.entries()) {
                for (const track of stream.getTracks?.() || []) {
                    const before = track.readyState || null;
                    track.stop();
                    const after = track.readyState || null;
                    verification.push(Object.freeze({ role: existingRole, trackId: track.id || null, before, after }));
                }
                this.streams.delete(existingRole);
            }
            this.deviceRoles.clear();
            this.disconnectListeners.clear();
            if (verification.length) this._record('EXISTING_TRACKS_STOPPED', { tracks: verification });
            return verification;
        }

        _watchForDisconnect(role, stream) {
            const onEnded = () => {
                if (this.streams.get(role) !== stream) return;
                this.streams.delete(role);
                for (const [deviceId, assignedRole] of this.deviceRoles.entries()) {
                    if (assignedRole === role) this.deviceRoles.delete(deviceId);
                }
            };
            this.disconnectListeners.set(role, { stream, onEnded });
            stream.getTracks().forEach(track => track.addEventListener?.('ended', onEnded, { once: true }));
        }

        isActive(role = 'primary') {
            const stream = this.streams.get(role);
            return Boolean(stream && stream.getTracks().some(track => track.readyState !== 'ended'));
        }

        async stop(role = 'primary', videoElement = null) {
            const stream = this.streams.get(role);
            if (!stream) {
                if (videoElement) videoElement.srcObject = null;
                return 0;
            }
            const tracks = stream.getTracks();
            const verification = tracks.map(track => { const before = track.readyState || null; track.stop();
                return Object.freeze({ role, trackId: track.id || null, before, after: track.readyState || null }); });
            this.streams.delete(role);
            for (const [deviceId, assignedRole] of this.deviceRoles.entries()) {
                if (assignedRole === role) this.deviceRoles.delete(deviceId);
            }
            this.disconnectListeners.delete(role);
            if (videoElement?.srcObject === stream) videoElement.srcObject = null;
            this.diagnostics = { ...this.diagnostics, cameraOpenState: 'STOPPED',
                videoTrackState: verification[0]?.after || 'ended', trackStopVerification: verification };
            this._record('STREAM_STOPPED', { role, tracks: verification });
            return tracks.length;
        }

        async stopAll(videoElements = {}) {
            const roles = Array.from(this.streams.keys());
            const stopped = await Promise.all(roles.map(role => this.stop(role, videoElements[role] || null)));
            return stopped.reduce((total, count) => total + count, 0);
        }

        getState() {
            return Object.freeze({
                permission: this.permissionState,
                activeRoles: Array.from(this.streams.keys()).filter(role => this.isActive(role)),
                pendingRoles: Array.from(this.pendingStarts.keys())
            });
        }

        getLiveReadiness({ role = 'primary', videoElement = null } = {}) {
            const managedStream = this.streams.get(role) || null;
            const attachedStream = videoElement?.srcObject || null;
            const diagnosticStreamId = this.diagnostics.streamId || null;
            const attachedIsAuthoritative = Boolean(attachedStream && (!diagnosticStreamId || attachedStream.id === diagnosticStreamId));
            const stream = managedStream || (attachedIsAuthoritative ? attachedStream : null);
            const track = stream?.getVideoTracks?.()[0] || null;
            const streamPresent = Boolean(stream);
            const videoTrackState = track?.readyState || null;
            const trackEnabled = typeof track?.enabled === 'boolean' ? track.enabled : null;
            const trackMuted = typeof track?.muted === 'boolean' ? track.muted : null;
            return Object.freeze({
                permission: this.permissionState,
                cameraOpenState: this.diagnostics.cameraOpenState,
                streamPresent,
                streamSource: managedStream ? 'CAMERA_MANAGER_PRIMARY_STREAM' : (attachedIsAuthoritative ? 'VIDEO_ELEMENT_SRC_OBJECT' : 'NONE'),
                streamId: stream?.id || null,
                managedStreamPresent: Boolean(managedStream),
                attachedStreamPresent: Boolean(attachedStream),
                videoTrackState,
                trackEnabled,
                trackMuted,
                cameraReady: this.permissionState === 'GRANTED' && streamPresent && videoTrackState === 'live' && trackEnabled === true
            });
        }

        getDiagnostics() {
            return Object.freeze({ ...this.diagnostics,
                requestedConstraints: this.diagnostics.requestedConstraints
                    ? JSON.parse(JSON.stringify(this.diagnostics.requestedConstraints)) : null,
                lastCameraError: this.diagnostics.lastCameraError ? { ...this.diagnostics.lastCameraError } : null,
                trackStopVerification: this.diagnostics.trackStopVerification.map(item => ({ ...item })),
                audit: this.cameraAudit.map(item => ({ ...item })) });
        }
    }

    namespace.CameraManager = CameraManager;
})(window);
