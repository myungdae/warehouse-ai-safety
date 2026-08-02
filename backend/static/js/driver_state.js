(function initializeDriverState(global) {
    'use strict';

    if (!global.SafetyObservation) {
        throw new Error('DriverState requires SafetyObservation');
    }
    if (!global.DriverStateConfig) {
        throw new Error('DriverState requires DriverStateConfig');
    }

    const { ObservationType, SensorObservation } = global.SafetyObservation;
    const VehicleType = Object.freeze({
        FORKLIFT: 'FORKLIFT',
        BOX_TRUCK: 'BOX_TRUCK',
        CARGO_TRUCK: 'CARGO_TRUCK',
        BUS: 'BUS',
        SPECIAL_VEHICLE: 'SPECIAL_VEHICLE'
    });
    const DriverObservationTypes = Object.freeze([
        ObservationType.DROWSINESS,
        ObservationType.INCAPACITATION,
        ObservationType.ALCOHOL_LEVEL
    ]);

    function requireNonEmptyString(value, fieldName) {
        if (typeof value !== 'string' || value.trim() === '') {
            throw new TypeError(`${fieldName} must be a non-empty string`);
        }
        return value.trim();
    }

    function cloneJsonValue(value, path = 'value', seen = new Set()) {
        if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite numbers`);
            return value;
        }
        if (typeof value !== 'object') {
            throw new TypeError(`${path} must be JSON-serializable`);
        }
        if (seen.has(value)) throw new TypeError(`${path} must not contain circular references`);
        seen.add(value);
        const clone = Array.isArray(value) ? [] : {};
        Object.keys(value).forEach(key => {
            clone[key] = cloneJsonValue(value[key], `${path}.${key}`, seen);
        });
        seen.delete(value);
        return clone;
    }

    function normalizeIdentity(value, fieldName) {
        const normalized = requireNonEmptyString(value, fieldName).replace(/[^a-zA-Z0-9]/g, '');
        if (!normalized) throw new TypeError(`${fieldName} must contain letters or numbers`);
        return normalized;
    }

    function createDriverTargetId(vehicleId, driverId, driverAssignmentId) {
        return [
            normalizeIdentity(vehicleId, 'vehicleId'),
            normalizeIdentity(driverId, 'driverId'),
            normalizeIdentity(driverAssignmentId, 'driverAssignmentId')
        ].join('|');
    }

    class VehicleContext {
        constructor(input) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
                throw new TypeError('VehicleContext input must be an object');
            }
            this.vehicleId = requireNonEmptyString(input.vehicleId, 'vehicleId');
            this.vehicleType = requireNonEmptyString(input.vehicleType, 'vehicleType');
            if (!Object.values(VehicleType).includes(this.vehicleType)) {
                throw new RangeError(`Unsupported vehicleType: ${this.vehicleType}`);
            }
            this.driverId = requireNonEmptyString(input.driverId, 'driverId');
            this.driverAssignmentId = requireNonEmptyString(input.driverAssignmentId, 'driverAssignmentId');
            this.capabilities = cloneJsonValue(input.capabilities || {}, 'capabilities');
            this.sensorBindings = cloneJsonValue(input.sensorBindings || {}, 'sensorBindings');
            this.targetId = createDriverTargetId(
                this.vehicleId,
                this.driverId,
                this.driverAssignmentId
            );
        }

        toJSON() {
            return cloneJsonValue({
                vehicleId: this.vehicleId,
                vehicleType: this.vehicleType,
                driverId: this.driverId,
                driverAssignmentId: this.driverAssignmentId,
                capabilities: this.capabilities,
                sensorBindings: this.sensorBindings,
                targetId: this.targetId
            });
        }
    }

    function createDriverObservationMetadata(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('Driver observation metadata input must be an object');
        }
        const context = input.context instanceof VehicleContext
            ? input.context
            : new VehicleContext(input.context);
        const sensorId = requireNonEmptyString(input.sensorId, 'sensorId');
        const sensorType = requireNonEmptyString(input.sensorType, 'sensorType');
        const source = requireNonEmptyString(input.source, 'source');
        const measurementStatus = requireNonEmptyString(input.measurementStatus, 'measurementStatus');
        const sampleWindowMs = Number(input.sampleWindowMs);
        if (!Number.isFinite(sampleWindowMs) || sampleWindowMs < 0) {
            throw new RangeError('sampleWindowMs must be a non-negative finite number');
        }
        if (typeof input.simulation !== 'boolean' || typeof input.sensorConnected !== 'boolean') {
            throw new TypeError('simulation and sensorConnected must be boolean');
        }

        return cloneJsonValue({
            vehicleType: context.vehicleType,
            vehicleId: context.vehicleId,
            driverId: context.driverId,
            driverAssignmentId: context.driverAssignmentId,
            cameraId: input.cameraId || null,
            sensorId,
            sensorType,
            source,
            simulation: input.simulation,
            sensorConnected: input.sensorConnected,
            measurementStatus,
            measurementMode: input.measurementMode || null,
            sampleId: input.sampleId || null,
            attemptNumber: input.attemptNumber ?? null,
            identityVerified: input.identityVerified ?? null,
            sampleQuality: input.sampleQuality ?? null,
            calibrationStatus: input.calibrationStatus || null,
            bypassSuspected: input.bypassSuspected ?? null,
            sampleWindowMs,
            algorithmVersion: requireNonEmptyString(input.algorithmVersion, 'algorithmVersion'),
            configurationVersion: requireNonEmptyString(input.configurationVersion, 'configurationVersion'),
            policyVersion: input.policyVersion || null,
            operationalUseAllowed: input.operationalUseAllowed ?? null,
            metrics: input.metrics || {},
            quality: input.quality || {},
            policy: input.policy || {}
        }, 'metadata');
    }

    let observationSequence = 0;
    function createDriverObservation(input) {
        const context = input.context instanceof VehicleContext
            ? input.context
            : new VehicleContext(input.context);
        if (!DriverObservationTypes.includes(input.observationType)) {
            throw new RangeError(`Unsupported driver observationType: ${input.observationType}`);
        }
        observationSequence += 1;
        const observedAt = input.observedAt || new Date();
        const metadata = createDriverObservationMetadata({ ...input.metadata, context });
        return new SensorObservation({
            observationId: `driver-${context.targetId}-${Date.parse(observedAt)}-${observationSequence}`,
            observationType: input.observationType,
            sensorId: metadata.sensorId,
            targetId: context.targetId,
            value: cloneJsonValue(input.value, 'observation.value'),
            unit: requireNonEmptyString(input.unit, 'unit'),
            confidence: input.confidence,
            observedAt,
            metadata
        });
    }

    function initializeDriverStatePage() {
        const form = document.getElementById('driverStateTestForm');
        if (!form || !global.DriverSensorAdapters) return;

        const adapters = {
            camera: new global.DriverSensorAdapters.DriverCameraAdapter(),
            alcohol: new global.DriverSensorAdapters.AlcoholSensorAdapter(),
            controls: new global.DriverSensorAdapters.VehicleControlInputAdapter(),
            deterministic: new global.DriverSensorAdapters.DeterministicDriverTestAdapter(),
            deterministicAlcohol: new global.DriverSensorAdapters.DeterministicAlcoholTestAdapter()
        };
        const contextOutput = document.getElementById('vehicleContextOutput');
        const targetOutput = document.getElementById('driverTargetId');
        const observationOutput = document.getElementById('lastDriverObservation');
        const sequenceOutput = document.getElementById('driverSequenceStatus');
        const adapterOutput = document.getElementById('driverAdapterStatus');
        const riskOutput = document.getElementById('lastDriverRiskSignal');
        const eventOutput = document.getElementById('driverRiskEventHistory');
        const currentEventIdOutput = document.getElementById('driverCurrentEventId');
        const currentEventStateOutput = document.getElementById('driverCurrentEventState');
        const compositeCountOutput = document.getElementById('driverCompositeSignalCount');
        const qualityValidOutput = document.getElementById('driverQualityValid');
        const vehicleMovingOutput = document.getElementById('driverVehicleMoving');
        const alcoholModeOutput = document.getElementById('driverAlcoholMeasurementMode');
        const alcoholStatusOutput = document.getElementById('driverAlcoholMeasurementStatus');
        const alcoholRawValueOutput = document.getElementById('driverAlcoholRawValue');
        const alcoholUnitOutput = document.getElementById('driverAlcoholUnit');
        const alcoholPolicyOutput = document.getElementById('driverAlcoholPolicyDecision');
        const alcoholRetryOutput = document.getElementById('driverAlcoholRetryCount');
        const alcoholIdentityOutput = document.getElementById('driverAlcoholIdentityVerified');
        const alcoholCalibrationOutput = document.getElementById('driverAlcoholCalibrationStatus');
        const alcoholQualityOutput = document.getElementById('driverAlcoholSampleQuality');
        const riskEventStateMachine = global.DriverRiskRuntime
            ? new global.DriverRiskRuntime.RiskEventStateMachine()
            : null;
        const sequenceRunState = {
            timerHandle: null,
            generation: 0,
            runId: null,
            targetId: null,
            observationType: null,
            observationHistory: [],
            eventIds: new Set()
        };
        const cancellationAuditHistory = [];
        adapterOutput.textContent = Object.entries(adapters)
            .map(([name, adapter]) => `${name}: ${adapter.isConnected() ? 'CONNECTED' : 'DISCONNECTED'}`)
            .join('\n');

        function readContext() {
            return new VehicleContext({
                vehicleType: document.getElementById('driverVehicleType').value,
                vehicleId: document.getElementById('driverVehicleId').value,
                driverId: document.getElementById('driverId').value,
                driverAssignmentId: document.getElementById('driverAssignmentId').value,
                capabilities: {},
                sensorBindings: {
                    deterministic: adapters.deterministic.adapterId,
                    deterministicAlcohol: adapters.deterministicAlcohol.adapterId
                }
            });
        }

        function renderContext() {
            try {
                const context = readContext();
                contextOutput.textContent = JSON.stringify(context.toJSON(), null, 2);
                targetOutput.textContent = context.targetId;
                return context;
            } catch (error) {
                targetOutput.textContent = error.message;
                contextOutput.textContent = '{}';
                return null;
            }
        }

        form.addEventListener('input', renderContext);
        form.addEventListener('submit', event => {
            event.preventDefault();
            const context = renderContext();
            if (!context) return;
            if (sequenceRunState.timerHandle !== null) {
                global.clearTimeout(sequenceRunState.timerHandle);
                sequenceRunState.timerHandle = null;
            }
            sequenceRunState.generation += 1;
            sequenceRunState.runId = `driver-run-${Date.now()}-${sequenceRunState.generation}`;
            sequenceRunState.observationHistory = [];
            sequenceRunState.eventIds = new Set();
            const runGeneration = sequenceRunState.generation;
            const submitter = event.submitter;
            const observationType = submitter && submitter.id === 'drowsinessTestButton'
                ? ObservationType.DROWSINESS
                : (submitter && submitter.id === 'incapacitationTestButton'
                    ? ObservationType.INCAPACITATION
                    : (submitter && submitter.id === 'alcoholTestButton'
                        ? ObservationType.ALCOHOL_LEVEL
                        : document.getElementById('driverObservationType').value));
            const previousEventType = sequenceRunState.observationType === ObservationType.DROWSINESS
                ? 'DROWSINESS'
                : (sequenceRunState.observationType === ObservationType.INCAPACITATION
                    ? 'DRIVER_INCAPACITATION'
                    : (sequenceRunState.observationType === ObservationType.ALCOHOL_LEVEL
                        ? 'ALCOHOL_POLICY_VIOLATION'
                        : null));
            if (
                previousEventType &&
                sequenceRunState.targetId &&
                riskEventStateMachine
            ) {
                riskEventStateMachine.clear(previousEventType, sequenceRunState.targetId, new Date());
                if (sequenceRunState.observationType === ObservationType.DROWSINESS) {
                    global.DriverRiskRuntime.resetDrowsinessRiskState(sequenceRunState.targetId);
                } else if (sequenceRunState.observationType === ObservationType.INCAPACITATION) {
                    global.DriverRiskRuntime.resetIncapacitationRiskState(sequenceRunState.targetId);
                } else {
                    global.DriverRiskRuntime.resetAlcoholRiskState(sequenceRunState.targetId);
                }
            }
            sequenceRunState.targetId = context.targetId;
            sequenceRunState.observationType = observationType;
            if (observationType === ObservationType.DROWSINESS && global.DriverRiskRuntime) {
                global.DriverRiskRuntime.resetDrowsinessRiskState(context.targetId);
            } else if (observationType === ObservationType.INCAPACITATION && global.DriverRiskRuntime) {
                global.DriverRiskRuntime.resetIncapacitationRiskState(context.targetId);
            } else if (observationType === ObservationType.ALCOHOL_LEVEL && global.DriverRiskRuntime) {
                global.DriverRiskRuntime.resetAlcoholRiskState(context.targetId);
            }
            riskOutput.textContent = '현재 실행의 RiskSignal 대기 중';
            eventOutput.textContent = '[]';
            currentEventIdOutput.textContent = '-';
            currentEventStateOutput.textContent = 'NORMAL';
            compositeCountOutput.textContent = '-';
            qualityValidOutput.textContent = '-';
            vehicleMovingOutput.textContent = '-';
            [
                alcoholModeOutput, alcoholStatusOutput, alcoholRawValueOutput, alcoholUnitOutput,
                alcoholPolicyOutput, alcoholRetryOutput, alcoholIdentityOutput,
                alcoholCalibrationOutput, alcoholQualityOutput
            ].forEach(output => { if (output) output.textContent = '-'; });
            sequenceOutput.textContent = 'STARTING';
            const deterministicAdapter = observationType === ObservationType.ALCOHOL_LEVEL
                ? adapters.deterministicAlcohol
                : adapters.deterministic;
            const observations = deterministicAdapter.createSequence({
                context,
                observationType,
                runId: sequenceRunState.runId
            });
            const renderObservation = index => {
                if (runGeneration !== sequenceRunState.generation) {
                    return;
                }
                const observationJson = observations[index].toJSON();
                sequenceRunState.observationHistory.push(observationJson);
                observationOutput.textContent = JSON.stringify(observationJson, null, 2);
                sequenceOutput.textContent = observationJson.metadata.metrics.sequenceState;
                if (observationType === ObservationType.INCAPACITATION) {
                    compositeCountOutput.textContent = String(observationJson.metadata.metrics.compositeSignalCount);
                    qualityValidOutput.textContent = String(observationJson.value.qualityValid);
                    vehicleMovingOutput.textContent = String(observationJson.value.vehicleMoving);
                }
                if (observationType === ObservationType.ALCOHOL_LEVEL) {
                    alcoholModeOutput.textContent = observationJson.value.measurementMode;
                    alcoholStatusOutput.textContent = observationJson.value.measurementStatus;
                    alcoholRawValueOutput.textContent = String(observationJson.value.rawValue);
                    alcoholUnitOutput.textContent = observationJson.value.unit;
                    alcoholRetryOutput.textContent = String(observationJson.value.retryCount);
                    alcoholIdentityOutput.textContent = String(observationJson.value.identityVerified);
                    alcoholCalibrationOutput.textContent = observationJson.value.calibrationStatus;
                    alcoholQualityOutput.textContent = String(observationJson.value.sampleQuality);
                }
                if (
                    [
                        ObservationType.DROWSINESS,
                        ObservationType.INCAPACITATION,
                        ObservationType.ALCOHOL_LEVEL
                    ].includes(observationType) &&
                    riskEventStateMachine
                ) {
                    const riskSignal = global.DriverRiskRuntime.observationToRiskSignal(observations[index]);
                    riskOutput.textContent = JSON.stringify(riskSignal, null, 2);
                    if (observationType === ObservationType.ALCOHOL_LEVEL) {
                        alcoholPolicyOutput.textContent = riskSignal.policyDecision || 'NO_DECISION';
                    }
                    let riskEvent = null;
                    if (riskSignal.shouldCreateRisk) {
                        riskEvent = riskEventStateMachine.observe(riskSignal.eventInput, observations[index].observedAt);
                        sequenceRunState.eventIds.add(riskEvent.eventId);
                        if (riskEvent.state === global.DriverRiskRuntime.EventState.ACTIVE) {
                            riskEventStateMachine.acknowledge(riskEvent.eventId, observations[index].observedAt);
                        }
                    } else if (riskSignal.shouldClearRisk) {
                        const eventType = observationType === ObservationType.DROWSINESS
                            ? 'DROWSINESS'
                            : (observationType === ObservationType.INCAPACITATION
                                ? 'DRIVER_INCAPACITATION'
                                : 'ALCOHOL_POLICY_VIOLATION');
                        riskEvent = riskEventStateMachine.clear(
                            eventType,
                            observations[index].targetId,
                            observations[index].observedAt
                        );
                    }
                    if (riskEvent) {
                        currentEventIdOutput.textContent = riskEvent.eventId;
                        currentEventStateOutput.textContent = riskEvent.state;
                    }
                    const currentRunHistory = riskEventStateMachine.toJSON()
                        .filter(item => sequenceRunState.eventIds.has(item.eventId));
                    eventOutput.textContent = JSON.stringify(currentRunHistory, null, 2);
                }
                if (index === observations.length - 1) {
                    sequenceRunState.timerHandle = null;
                    return;
                }
                sequenceRunState.timerHandle = global.setTimeout(
                    () => renderObservation(index + 1),
                    global.DriverStateConfig.simulation.sequenceIntervalMs
                );
            };
            renderObservation(0);
        });
        renderContext();
        return Object.freeze({
            cancelDeterministicRun(options = {}) {
                const targetId = requireNonEmptyString(options.targetId, 'targetId');
                const observationType = options.observationType || ObservationType.DROWSINESS;
                const matches = sequenceRunState.targetId === targetId &&
                    sequenceRunState.observationType === observationType;
                const active = matches && sequenceRunState.timerHandle !== null;
                if (active) {
                    global.clearTimeout(sequenceRunState.timerHandle);
                    sequenceRunState.timerHandle = null;
                    sequenceRunState.generation += 1;
                    sequenceOutput.textContent = 'CANCELLED';
                }
                const result = Object.freeze({
                    cancelled: active,
                    targetId,
                    generation: sequenceRunState.generation,
                    reason: options.reason || 'EXPLICIT_CANCEL'
                });
                if (active) cancellationAuditHistory.push({ ...result, timestamp: new Date().toISOString() });
                return result;
            },
            getDeterministicRunState(targetId) {
                if (targetId && sequenceRunState.targetId !== targetId) return null;
                return {
                    timerHandle: sequenceRunState.timerHandle,
                    generation: sequenceRunState.generation,
                    runId: sequenceRunState.runId,
                    targetId: sequenceRunState.targetId,
                    observationType: sequenceRunState.observationType,
                    active: sequenceRunState.timerHandle !== null,
                    observationHistory: cloneJsonValue(sequenceRunState.observationHistory),
                    cancellationAuditHistory: cloneJsonValue(cancellationAuditHistory)
                };
            },
            isDeterministicRunActive(targetId) {
                return sequenceRunState.targetId === targetId && sequenceRunState.timerHandle !== null;
            },
            getRiskEventStateMachine() { return riskEventStateMachine; },
            readContext,
            getSequenceRunState() {
                return {
                    timerHandle: sequenceRunState.timerHandle,
                    generation: sequenceRunState.generation,
                    runId: sequenceRunState.runId,
                    targetId: sequenceRunState.targetId,
                    observationType: sequenceRunState.observationType,
                    observationHistory: cloneJsonValue(sequenceRunState.observationHistory)
                };
            },
            getRiskEventHistory() {
                return riskEventStateMachine ? riskEventStateMachine.toJSON() : [];
            }
        });
    }

    global.DriverState = Object.freeze({
        VehicleType,
        DriverObservationTypes,
        VehicleContext,
        createDriverTargetId,
        createDriverObservationMetadata,
        createDriverObservation,
        cloneJsonValue,
        initializeDriverStatePage
    });
}(window));
