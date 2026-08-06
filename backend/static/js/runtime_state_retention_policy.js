(function (global) {
    'use strict';
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    class BoundedRuntimeStore {
        constructor({ storeCode, maximumEntries, maximumAgeMs, now = () => Date.now(), isPinned = item => item?.active === true } = {}) {
            if (!storeCode || !Number.isInteger(maximumEntries) || maximumEntries < 1 || !Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) throw new TypeError('Valid retention configuration required');
            this.storeCode = storeCode; this.maximumEntries = maximumEntries; this.maximumAgeMs = maximumAgeMs; this.now = now; this.isPinned = isPinned;
            this.entries = []; this.droppedCount = 0; this.lastCompactedAt = null; this.audit = [];
        }
        add(item) { this.entries.push(clone(item)); this.compact(); return clone(item); }
        compact() {
            const now = this.now(), timestamp = item => { const value = Date.parse(item?.timestamp || item?.createdAt || item?.updatedAt); return Number.isFinite(value) ? value : -Infinity; };
            const pinned = this.entries.filter(this.isPinned), removable = this.entries.filter(item => !this.isPinned(item)).sort((a, b) => timestamp(a) - timestamp(b));
            const kept = removable.filter(item => now - timestamp(item) <= this.maximumAgeMs); let dropped = removable.length - kept.length;
            while (pinned.length + kept.length > this.maximumEntries && kept.length) { kept.shift(); dropped++; }
            this.entries = [...pinned, ...kept].sort((a, b) => timestamp(a) - timestamp(b)); this.droppedCount += dropped; this.lastCompactedAt = new Date(now).toISOString();
            if (dropped) this.audit.push({ eventType: 'RETENTION_COMPACTED', storeCode: this.storeCode, dropped, droppedCount: this.droppedCount, timestamp: this.lastCompactedAt, operationalUseAllowed: false });
            return this.getState();
        }
        reset() { this.entries = []; this.audit = []; this.droppedCount = 0; this.lastCompactedAt = new Date(this.now()).toISOString(); }
        values() { return clone(this.entries); }
        getState() { const ratio = this.entries.length / this.maximumEntries; return { storeCode: this.storeCode, maximumEntries: this.maximumEntries, maximumAgeMs: this.maximumAgeMs,
            compactionMode: 'AGE_THEN_COMPLETED_FIFO', evictionOrder: 'OLDEST_COMPLETED_FIRST', pinnedActiveEntries: this.entries.filter(this.isPinned).length, count: this.entries.length,
            droppedCount: this.droppedCount, lastCompactedAt: this.lastCompactedAt, state: ratio >= 1 ? 'DEGRADED' : ratio >= .8 ? 'NEAR_LIMIT' : 'BOUNDED', operationalUseAllowed: false }; }
    }
    global.RuntimeStateRetentionPolicy = Object.freeze({ BoundedRuntimeStore, create: options => new BoundedRuntimeStore(options) });
}(window));
