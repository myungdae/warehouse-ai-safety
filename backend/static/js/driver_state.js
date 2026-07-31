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

    function createDriverTargetId(vehicleId, driverId) {
        return `${normalizeIdentity(vehicleId, 'vehicleId')}|${normalizeIdentity(driverId, 'driverId')}`;
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
            this.targetId = createDriverTargetId(this.vehicleId, this.driverId);
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
            sampleWindowMs,
            algorithmVersion: requireNonEmptyString(input.algorithmVersion, 'algorithmVersion'),
            configurationVersion: requireNonEmptyString(input.configurationVersion, 'configurationVersion'),
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
            deterministic: new global.DriverSensorAdapters.DeterministicDriverTestAdapter()
        };
        const contextOutput = document.getElementById('vehicleContextOutput');
        const targetOutput = document.getElementById('driverTargetId');
        const observationOutput = document.getElementById('lastDriverObservation');
        const sequenceOutput = document.getElementById('driverSequenceStatus');
        const adapterOutput = document.getElementById('driverAdapterStatus');
        const sequenceRunState = {
            timerHandle: null,
            generation: 0,
            observationHistory: []
        };
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
                sensorBindings: { deterministic: adapters.deterministic.adapterId }
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
            sequenceRunState.observationHistory = [];
            const runGeneration = sequenceRunState.generation;
            const observationType = document.getElementById('driverObservationType').value;
            const observations = adapters.deterministic.createSequence({ context, observationType });
            sequenceOutput.textContent = observations.map(item => item.value).join(' → ');
            const renderObservation = index => {
                if (runGeneration !== sequenceRunState.generation) {
                    return;
                }
                const observationJson = observations[index].toJSON();
                sequenceRunState.observationHistory.push(observationJson);
                observationOutput.textContent = JSON.stringify(observationJson, null, 2);
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
            getSequenceRunState() {
                return {
                    timerHandle: sequenceRunState.timerHandle,
                    generation: sequenceRunState.generation,
                    observationHistory: cloneJsonValue(sequenceRunState.observationHistory)
                };
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
