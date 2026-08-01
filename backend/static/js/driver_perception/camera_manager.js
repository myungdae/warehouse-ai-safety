(function defineCameraManager(global) {
    'use strict';

    const namespace = global.DriverPerception = global.DriverPerception || {};

    class CameraManager {
        constructor({ mediaDevices, cameraConfig } = {}) {
            this.mediaDevices = mediaDevices || global.navigator?.mediaDevices;
            this.cameraConfig = cameraConfig || namespace.Config?.camera || {};
            this.permissionState = 'UNKNOWN';
            this.streams = new Map();
            this.deviceRoles = new Map();
            this.pendingStarts = new Map();
            this.disconnectListeners = new Map();
        }

        _requireMediaDevices(method) {
            if (!this.mediaDevices || typeof this.mediaDevices[method] !== 'function') {
                throw new Error(`MEDIA_DEVICES_${method.toUpperCase()}_UNAVAILABLE`);
            }
        }

        async enumerateDevices() {
            this._requireMediaDevices('enumerateDevices');
            const devices = await this.mediaDevices.enumerateDevices();
            return devices
                .filter(device => device.kind === 'videoinput')
                .map(device => ({
                    deviceId: device.deviceId,
                    groupId: device.groupId || '',
                    label: device.label || 'Camera permission required'
                }));
        }

        async start({ role = 'primary', deviceId = '', videoElement = null } = {}) {
            if (this.streams.has(role)) return this.streams.get(role);
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

            try {
                const stream = await this.mediaDevices.getUserMedia({ video, audio: false });
                this.permissionState = 'GRANTED';
                const actualDeviceId = stream.getVideoTracks?.()[0]?.getSettings?.().deviceId || deviceId;
                if (actualDeviceId && this.deviceRoles.has(actualDeviceId) && this.deviceRoles.get(actualDeviceId) !== role) {
                    stream.getTracks().forEach(track => track.stop());
                    throw new Error(`CAMERA_DEVICE_ALREADY_ACTIVE: ${actualDeviceId}`);
                }
                this.streams.set(role, stream);
                if (actualDeviceId) this.deviceRoles.set(actualDeviceId, role);
                this._watchForDisconnect(role, stream);
                if (videoElement) {
                    videoElement.srcObject = stream;
                    if (typeof videoElement.play === 'function') await videoElement.play();
                }
                return stream;
            } catch (error) {
                this.permissionState = ['NotAllowedError', 'SecurityError'].includes(error?.name)
                    ? 'DENIED'
                    : 'ERROR';
                throw error;
            }
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
            tracks.forEach(track => track.stop());
            this.streams.delete(role);
            for (const [deviceId, assignedRole] of this.deviceRoles.entries()) {
                if (assignedRole === role) this.deviceRoles.delete(deviceId);
            }
            this.disconnectListeners.delete(role);
            if (videoElement?.srcObject === stream) videoElement.srcObject = null;
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
    }

    namespace.CameraManager = CameraManager;
})(window);
