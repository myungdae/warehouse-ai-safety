(function (global) {
    'use strict';

    const VERSION = 'CUSTOMER_DEMO_PRESENTATION_PATH-v3';
    const SOURCE = 'LIVE_CAMERA_DEMO';
    const EYE_SUSTAIN_MS = 1000;
    const YAWN_SUSTAIN_MS = 1200;
    const EYE_JOIN_MS = 250;
    const DEMO_EYE_CLOSE_EAR = 0.18;
    const DEMO_EYE_REOPEN_EAR = 0.23;
    const DEMO_YAWN_OPEN_MAR = 0.40;
    const HISTORY_LIMIT = 128;
    const CUSTOMER_EYE_MESSAGE = Object.freeze({ messageCode: 'CUSTOMER_DEMO_EYE_WARNING', shortTextKo: '잠 깨세요. 전방을 확인하세요.', tonePattern: 'SINGLE_CHIME', operationalUseAllowed: false });
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const finite = Number.isFinite;

    class CustomerDemoSimpleWarningRuntime {
        constructor({ audioAdapter = null, now = () => Date.now() } = {}) {
            this.audio = audioAdapter;
            this.now = now;
            this.history = [];
            this.sequence = 0;
            this.reset();
        }

        _contract() {
            return { version: VERSION, purpose: 'CUSTOMER_PRESENTATION', demonstration: true, validated: false, operationalUseAllowed: false, authoritative: false, sourceEvidenceType: SOURCE };
        }

        _record(eventType, data = {}) {
            const row = Object.freeze({ eventId: `customer-demo-${++this.sequence}`, timestamp: new Date(this.now()).toISOString(), eventType, ...this._contract(), ...clone(data) });
            this.history.push(row);
            while (this.history.length > HISTORY_LIMIT) this.history.shift();
            return row;
        }

        _channel(kind) {
            return { kind, state: 'ARMED', armed: true, candidate: false, qualified: false, startedAt: null, durationMs: 0,
                warningPlayed: false, warningPlayedForEpisode: false, playbackActive: false, playbackState: 'IDLE',
                rearmRequired: false, recoveryDetected: false, episodeId: null, lastRejectReason: null,
                leftCloseEvidence: false, rightCloseEvidence: false, firstEyeClosedAt: null, interEyeDelayMs: null,
                joinWindowRemainingMs: 0, bilateralJoined: false, winkRejectionPending: false, winkRejectionConfirmed: false,
                leftReopenEvidence: false, rightReopenEvidence: false };
        }

        async enable() {
            const state = this.audio?.getState?.() || {};
            if (state.enabled !== true || state.unlocked !== true) await this.audio?.enable?.();
            if (this.audio?.getState?.().unlocked !== true) return this._reject('AUDIO_USER_GESTURE_REQUIRED');
            this.enabled = true;
            this.lastRejectReason = null;
            this._record('DEMO_ENABLED');
            return this.getState();
        }

        disable() {
            this.enabled = false;
            this.eye = this._channel('eye');
            this.yawn = this._channel('yawn');
            this.lastRejectReason = 'DEMO_OFF';
            this._record('DEMO_DISABLED');
            return this.getState();
        }

        _reject(reason, kind = null) {
            if (kind) this[kind].lastRejectReason = reason;
            else this.lastRejectReason = reason;
            return this._record('CANDIDATE_REJECTED', { kind, reason });
        }

        _clear(kind, reason = null) {
            const fresh = this._channel(kind);
            fresh.lastRejectReason = reason;
            if (kind === 'eye') fresh.winkRejectionConfirmed = reason === 'WINK_REJECTED';
            this[kind] = fresh;
            if (reason) this._reject(reason, kind);
        }

        async _play(kind, messageCode, snapshot) {
            const channel = this[kind];
            if (channel.warningPlayedForEpisode || channel.playbackActive) return null;
            const message = messageCode === CUSTOMER_EYE_MESSAGE.messageCode ? CUSTOMER_EYE_MESSAGE : global.VoiceMessageCatalog?.get?.(messageCode);
            if (!message) return this._reject('MESSAGE_UNAVAILABLE', kind);
            channel.warningPlayedForEpisode = true;
            channel.rearmRequired = true;
            channel.armed = false;
            channel.candidate = false;
            channel.state = 'WARNING_PLAYED_WAITING_FOR_REOPEN';
            channel.playbackActive = true;
            channel.playbackState = 'REQUESTED';
            this.playbackActive = true;
            this.selectedMessageCode = messageCode;
            this._record('WARNING_SELECTED', { kind, messageCode, snapshotId: snapshot?.driverMetricSnapshotId || null });
            let result;
            try { result = await this.audio?.deliver?.(message, { decisionId: `customer-demo-${kind}-${this.sequence}` }); }
            finally { channel.playbackActive = false; this.playbackActive = false; }
            channel.warningPlayed = result?.deliveryState === 'PLAYED';
            channel.playbackState = result?.deliveryState || 'UNAVAILABLE';
            this._record(channel.warningPlayed ? 'WARNING_PLAYED' : 'WARNING_NOT_PLAYED', { kind, messageCode, deliveryState: channel.playbackState });
            return result;
        }

        _timestamp(snapshot) {
            const parsed = Date.parse(snapshot?.runtime?.frameTimestamp || snapshot?.timestamp);
            return finite(parsed) ? parsed : this.now();
        }

        async ingest(snapshot) {
            if (!this.enabled || !snapshot) return this.getState();
            const at = this._timestamp(snapshot), metrics = snapshot.metrics || {}, quality = snapshot.quality || {};
            const leftEAR = metrics.leftEAR, rightEAR = metrics.rightEAR;
            const eyeValid = snapshot.faceDetected === true && finite(leftEAR) && finite(rightEAR);
            const leftClosed = eyeValid && leftEAR <= DEMO_EYE_CLOSE_EAR, rightClosed = eyeValid && rightEAR <= DEMO_EYE_CLOSE_EAR;
            const bothClosed = leftClosed && rightClosed;
            const bothOpen = eyeValid && leftEAR >= DEMO_EYE_REOPEN_EAR && rightEAR >= DEMO_EYE_REOPEN_EAR;
            this.liveMetrics = { snapshotId: snapshot.driverMetricSnapshotId || null, timestamp: snapshot.timestamp || null,
                leftEAR, rightEAR, eyeMetricsValid: eyeValid, demoEyeCloseEAR: DEMO_EYE_CLOSE_EAR, demoEyeReopenEAR: DEMO_EYE_REOPEN_EAR,
                marRaw: metrics.marRaw, marSmoothed: metrics.marSmoothed, mar: finite(metrics.marSmoothed) ? metrics.marSmoothed : metrics.marRaw };

            const eye = this.eye;
            if (eye.rearmRequired) {
                eye.leftReopenEvidence = bothOpen;
                eye.rightReopenEvidence = bothOpen;
                if (bothOpen) {
                    const episodeId = eye.episodeId;
                    this.eye = this._channel('eye');
                    this.eye.recoveryDetected = true;
                    this._record('EYE_REARMED_IMMEDIATELY', { episodeId });
                }
            } else if (!eyeValid) this._clear('eye', 'EYE_METRICS_INVALID');
            else if (bothClosed) {
                if (!eye.candidate) {
                    eye.candidate = true;
                    eye.state = 'BILATERAL_CLOSURE';
                    eye.startedAt = at;
                    eye.episodeId = `customer-eye-${++this.eyeEpisodeSequence}`;
                    eye.leftCloseEvidence = eye.rightCloseEvidence = eye.bilateralJoined = true;
                    eye.firstEyeClosedAt = at;
                    eye.interEyeDelayMs = 0;
                    eye.winkRejectionPending = false;
                    this._record('BILATERAL_EYE_CANDIDATE', { episodeId: eye.episodeId });
                }
                eye.durationMs = at - eye.startedAt;
                if (eye.durationMs >= EYE_SUSTAIN_MS) await this._play('eye', CUSTOMER_EYE_MESSAGE.messageCode, snapshot);
            } else if (leftClosed !== rightClosed) {
                if (eye.firstEyeClosedAt == null) eye.firstEyeClosedAt = at;
                eye.leftCloseEvidence = leftClosed;
                eye.rightCloseEvidence = rightClosed;
                eye.joinWindowRemainingMs = Math.max(0, EYE_JOIN_MS - (at - eye.firstEyeClosedAt));
                eye.winkRejectionPending = eye.joinWindowRemainingMs > 0;
                if (at - eye.firstEyeClosedAt >= EYE_JOIN_MS) this._clear('eye', 'WINK_REJECTED');
            } else if (eye.candidate) this._clear('eye', 'EYE_CLOSURE_TOO_SHORT');
            else if (bothOpen && eye.firstEyeClosedAt != null) this._clear('eye', at - eye.firstEyeClosedAt >= EYE_JOIN_MS ? 'WINK_REJECTED' : null);

            const yawn = this.yawn;
            const mar = this.liveMetrics.mar;
            const mouthValid = snapshot.faceDetected === true && finite(mar);
            const mouthOpen = mouthValid && mar >= DEMO_YAWN_OPEN_MAR;
            this.liveMetrics.mouthOpenThreshold = DEMO_YAWN_OPEN_MAR;
            this.liveMetrics.mouthOpen = mouthOpen;
            if (yawn.rearmRequired) {
                if (mouthValid && !mouthOpen) {
                    this.yawn = this._channel('yawn');
                    this.yawn.recoveryDetected = true;
                    this._record('YAWN_REARMED_IMMEDIATELY');
                }
            } else if (!mouthValid) {
                const reason = snapshot.diagnostics?.mouth?.marInvalidReason || '';
                this._clear('yawn', /TALK/i.test(reason) ? 'TALKING_REJECTED' : /SMILE/i.test(reason) ? 'SMILE_REJECTED' : 'MOUTH_METRICS_INVALID');
            } else if (mouthOpen) {
                if (!yawn.candidate) {
                    yawn.candidate = true;
                    yawn.state = 'YAWN_OPEN';
                    yawn.startedAt = at;
                    this._record('YAWN_CANDIDATE');
                }
                yawn.durationMs = at - yawn.startedAt;
                if (yawn.durationMs >= YAWN_SUSTAIN_MS) await this._play('yawn', 'WEB_DEMO_YAWN_WARNING', snapshot);
            } else if (yawn.candidate) this._clear('yawn', 'MOUTH_OPEN_TOO_SHORT');
            return this.getState();
        }

        reset() {
            this.enabled = false;
            this.playbackActive = false;
            this.selectedMessageCode = null;
            this.lastRejectReason = 'DEMO_OFF';
            this.eyeEpisodeSequence = 0;
            this.liveMetrics = {};
            this.eye = this._channel('eye');
            this.yawn = this._channel('yawn');
            return this.getState();
        }

        getState() {
            return clone({ ...this._contract(), enabled: this.enabled, eyeClosureDurationMs: this.eye.durationMs, yawnOpenDurationMs: this.yawn.durationMs,
                eye: this.eye, armed: { eye: this.eye.armed, yawn: this.yawn.armed }, rearmRequired: { eye: this.eye.rearmRequired, yawn: this.yawn.rearmRequired },
                warningPlayed: { eye: this.eye.warningPlayed, yawn: this.yawn.warningPlayed }, cooldownMs: 0, eyeCooldownRemainingMs: 0,
                selectedMessageCode: this.selectedMessageCode, playbackState: this.playbackActive ? 'PLAYING' : (this.audio?.getState?.().playbackState || 'IDLE'),
                liveMetrics: this.liveMetrics, channelRejectReasons: { eye: this.eye.lastRejectReason, yawn: this.yawn.lastRejectReason }, lastRejectReason: this.lastRejectReason });
        }
    }

    function mount(panel) {
        if (!panel || panel.dataset.mounted) return null;
        const audio = global.VoiceInteractionPage?.audio;
        if (!audio) return null;
        const runtime = new CustomerDemoSimpleWarningRuntime({ audioAdapter: audio });
        const field = name => panel.querySelector(`[data-customer-demo-${name}]`);
        const render = () => {
            const state = runtime.getState(), metric = value => finite(value) ? Number(value).toFixed(3) : '-';
            const values = { mode: state.enabled ? 'ON' : 'OFF', eye: `${Math.round(state.eyeClosureDurationMs)} ms · L ${metric(state.liveMetrics.leftEAR)} / R ${metric(state.liveMetrics.rightEAR)}`, yawn: `${Math.round(state.yawnOpenDurationMs)} ms · MAR ${metric(state.liveMetrics.mar)}`,
                armed: `EYE ${state.armed.eye ? 'ARMED' : 'REOPEN'} / YAWN ${state.armed.yawn ? 'ARMED' : 'RECOVER'}`, played: `EYE ${state.warningPlayed.eye ? 'YES' : 'NO'} / YAWN ${state.warningPlayed.yawn ? 'YES' : 'NO'}`, cooldown: '0 s', reject: `EYE ${state.channelRejectReasons.eye || 'NONE'} / YAWN ${state.channelRejectReasons.yawn || 'NONE'}`,
                'eye-state': state.eye.state, 'eye-episode': state.eye.episodeId || '-', 'eye-playback-active': state.eye.playbackActive ? 'YES' : 'NO', 'eye-reopen': state.eye.leftReopenEvidence && state.eye.rightReopenEvidence ? 'YES' : 'NO', 'eye-recovery': state.eye.recoveryDetected ? 'YES' : 'NO',
                'eye-armed': state.eye.armed ? 'YES' : 'NO', 'eye-left-close': state.eye.leftCloseEvidence ? 'YES' : 'NO', 'eye-right-close': state.eye.rightCloseEvidence ? 'YES' : 'NO', 'eye-inter-delay': finite(state.eye.interEyeDelayMs) ? `${state.eye.interEyeDelayMs} ms` : '-',
                'eye-join-remaining': `${Math.max(0, Math.round(state.eye.joinWindowRemainingMs))} ms`, 'eye-bilateral-joined': state.eye.bilateralJoined ? 'YES' : 'NO', 'eye-wink-pending': state.eye.winkRejectionPending ? 'YES' : 'NO', 'eye-wink-confirmed': state.eye.winkRejectionConfirmed ? 'YES' : 'NO' };
            Object.entries(values).forEach(([name, value]) => { if (field(name)) field(name).textContent = value; });
        };
        panel.addEventListener('click', async event => { if (event.target.dataset.customerDemoAction === 'toggle') runtime.getState().enabled ? runtime.disable() : await runtime.enable(); render(); });
        const root = document.querySelector('[data-driver-perception-root]');
        let boundRuntime = null, unsubscribe = null;
        const acceptSnapshot = snapshot => runtime.ingest(snapshot).finally(render);
        const bind = () => { const current = root?.driverPerceptionRuntime; if (!current || current === boundRuntime || typeof current.onMetricSnapshot !== 'function') return false; unsubscribe?.(); boundRuntime = current; unsubscribe = current.onMetricSnapshot(acceptSnapshot); const latest = current.getLatestMetricSnapshot?.(); if (latest) acceptSnapshot(latest); return true; };
        bind();
        const observer = new MutationObserver(() => { if (bind()) observer.disconnect(); });
        if (!boundRuntime && root) observer.observe(root, { childList: true, subtree: true, attributes: true });
        const teardown = () => { unsubscribe?.(); observer.disconnect(); };
        global.addEventListener('pagehide', teardown, { once: true });
        panel.customerDemoUnmount = teardown;
        audio.subscribe?.(render);
        panel.dataset.mounted = 'true';
        render();
        global.CustomerDemoSimpleWarningPage = Object.freeze({ runtime, render, bind, teardown, getAuthoritativeRuntime: () => boundRuntime });
        return runtime;
    }

    global.CustomerDemoSimpleWarning = Object.freeze({ CustomerDemoSimpleWarningRuntime, mount, VERSION, SOURCE, EYE_SUSTAIN_MS, YAWN_SUSTAIN_MS, EYE_JOIN_MS, DEMO_EYE_CLOSE_EAR, DEMO_EYE_REOPEN_EAR, DEMO_YAWN_OPEN_MAR });
    document.addEventListener('DOMContentLoaded', () => mount(document.getElementById('customerDemoSimpleWarningPanel')));
})(window);
