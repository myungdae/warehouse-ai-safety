(function defineDriverInputModeController(global) {
    'use strict';

    const Mode = Object.freeze({
        STOPPED: 'STOPPED',
        DETERMINISTIC_SIMULATION: 'DETERMINISTIC_SIMULATION',
        LIVE_WEBCAM: 'LIVE_WEBCAM'
    });
    const modes = Object.values(Mode);
    const requireText = (value, name) => {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required`);
        return value.trim();
    };

    class DriverInputModeController {
        constructor({ cancelDeterministicRun } = {}) {
            this.cancelDeterministicRun = cancelDeterministicRun || (() => ({ cancelled: false }));
            this.sources = new Map();
            this.ownership = new Map();
            this.auditHistory = [];
            this.sequence = 0;
        }

        key(observationType, targetId) { return `${observationType}|${targetId}`; }

        registerSource({ sourceId, mode, onRelease = null }) {
            sourceId = requireText(sourceId, 'sourceId');
            if (!modes.includes(mode) || mode === Mode.STOPPED) throw new RangeError('Source mode must be publishable');
            const registration = Object.freeze({ sourceId, mode, onRelease: typeof onRelease === 'function' ? onRelease : null });
            this.sources.set(sourceId, registration);
            return registration;
        }

        activateMode({ observationType, targetId, mode, sourceId, reason = 'MODE_ACTIVATED' }) {
            observationType = requireText(observationType, 'observationType');
            targetId = requireText(targetId, 'targetId');
            if (!modes.includes(mode) || mode === Mode.STOPPED) throw new RangeError('Unsupported active mode');
            const source = this.sources.get(requireText(sourceId, 'sourceId'));
            if (!source || source.mode !== mode) throw new RangeError('Source is not registered for requested mode');
            const key = this.key(observationType, targetId);
            const previous = this.ownership.get(key);
            if (previous && previous.sourceId === sourceId && previous.mode === mode) return Object.freeze({ ...previous });

            for (const [ownedKey, owned] of this.ownership.entries()) {
                if (owned.sourceId === sourceId && owned.observationType === observationType && ownedKey !== key) {
                    this.deactivateMode({ observationType: owned.observationType, targetId: owned.targetId,
                        sourceId, token: owned.token, reason: 'ASSIGNMENT_CHANGED' });
                }
            }
            if (previous) this._release(previous, 'MODE_REPLACED');
            if (mode === Mode.LIVE_WEBCAM) {
                this.cancelDeterministicRun({ targetId, observationType, reason: 'SWITCH_TO_LIVE', preserveAuditHistory: true });
            }
            this.sequence += 1;
            const ownership = {
                observationType, targetId, mode, sourceId,
                token: `driver-input-${this.sequence}-${Date.now()}`,
                activatedAt: new Date().toISOString()
            };
            this.ownership.set(key, ownership);
            this._audit('MODE_ACTIVATED', ownership, reason);
            return Object.freeze({ ...ownership });
        }

        _release(ownership, reason) {
            const source = this.sources.get(ownership.sourceId);
            source?.onRelease?.(Object.freeze({ ...ownership, reason }));
            this.ownership.delete(this.key(ownership.observationType, ownership.targetId));
            this._audit('MODE_DEACTIVATED', ownership, reason);
        }

        deactivateMode({ observationType, targetId, sourceId, token, reason = 'MODE_DEACTIVATED' }) {
            const ownership = this.ownership.get(this.key(observationType, targetId));
            if (!ownership || ownership.sourceId !== sourceId || ownership.token !== token) return false;
            this._release(ownership, reason);
            return true;
        }

        getMode(observationType, targetId) {
            return this.ownership.get(this.key(observationType, targetId))?.mode || Mode.STOPPED;
        }
        getOwnership(observationType, targetId) {
            const value = this.ownership.get(this.key(observationType, targetId));
            return value ? Object.freeze({ ...value }) : null;
        }
        canPublish({ observationType, targetId, sourceId, token }) {
            const value = this.ownership.get(this.key(observationType, targetId));
            return Boolean(value && value.sourceId === sourceId && value.token === token);
        }
        releaseTarget(targetId, reason = 'TARGET_RELEASED') {
            const released = [];
            for (const ownership of [...this.ownership.values()]) {
                if (ownership.targetId === targetId) { this._release(ownership, reason); released.push(ownership.token); }
            }
            return released;
        }
        resetTarget(targetId) { return this.releaseTarget(targetId, 'TARGET_RESET'); }
        getAuditHistory() { return this.auditHistory.map(item => ({ ...item })); }
        _audit(type, ownership, reason) {
            this.auditHistory.push({ type, reason, timestamp: new Date().toISOString(), ownership: { ...ownership } });
        }
    }

    global.DriverInputModeController = Object.freeze({ Mode, DriverInputModeController });
})(window);
