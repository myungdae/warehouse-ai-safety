(function initializeDriverSensorAdapters(global) {
    'use strict';

    if (!global.DriverState || !global.DriverStateConfig || !global.SafetyObservation) {
        throw new Error('Driver adapters require DriverState, DriverStateConfig, and SafetyObservation');
    }

    const { createDriverObservation, DriverObservationTypes } = global.DriverState;
    const DeterministicSequenceState = Object.freeze({
        NORMAL: 'NORMAL',
        QUALITY_VALID: 'QUALITY_VALID',
        COMPOSITE_PENDING: 'COMPOSITE_PENDING',
        ENTRY_PENDING: 'ENTRY_PENDING',
        RISK_CONFIRMED: 'RISK_CONFIRMED',
        RISK_MAINTAINED: 'RISK_MAINTAINED',
        ACKNOWLEDGED: 'ACKNOWLEDGED',
        RECOVERY_PENDING: 'RECOVERY_PENDING',
        CLEAR_PENDING: 'CLEAR_PENDING',
        CLEAR: 'CLEAR'
    });
    const DrowsinessSequence = Object.freeze([
        DeterministicSequenceState.NORMAL,
        DeterministicSequenceState.ENTRY_PENDING,
        DeterministicSequenceState.RISK_CONFIRMED,
        DeterministicSequenceState.RISK_MAINTAINED,
        DeterministicSequenceState.CLEAR_PENDING,
        DeterministicSequenceState.CLEAR
    ]);
    const IncapacitationSequence = Object.freeze([
        DeterministicSequenceState.NORMAL,
        DeterministicSequenceState.QUALITY_VALID,
        DeterministicSequenceState.COMPOSITE_PENDING,
        DeterministicSequenceState.RISK_CONFIRMED,
        DeterministicSequenceState.RISK_MAINTAINED,
        DeterministicSequenceState.ACKNOWLEDGED,
        DeterministicSequenceState.RECOVERY_PENDING,
        DeterministicSequenceState.CLEAR
    ]);
    const DeterministicSequence = DrowsinessSequence;

    class DisconnectedDriverAdapter {
        constructor({ adapterId, sensorType }) {
            this.adapterId = adapterId;
            this.sensorType = sensorType;
            this.connected = false;
        }
        async connect() { this.connected = false; return false; }
        async disconnect() { this.connected = false; return true; }
        isConnected() { return this.connected; }
        createObservation() {
            throw new Error(`${this.constructor.name} is not connected; no measurement is available`);
        }
    }

    class DriverCameraAdapter extends DisconnectedDriverAdapter {
        constructor() { super({ adapterId: 'driver-camera-unconfigured', sensorType: 'DRIVER_CAMERA' }); }
    }
    class AlcoholSensorAdapter extends DisconnectedDriverAdapter {
        constructor() { super({ adapterId: 'alcohol-sensor-unconfigured', sensorType: 'ALCOHOL_SENSOR' }); }
    }
    class VehicleControlInputAdapter extends DisconnectedDriverAdapter {
        constructor() { super({ adapterId: 'vehicle-control-unconfigured', sensorType: 'VEHICLE_CONTROL_INPUT' }); }
    }

    class DeterministicDriverTestAdapter extends DisconnectedDriverAdapter {
        constructor() {
            super({ adapterId: 'deterministic-driver-test', sensorType: 'DETERMINISTIC_TEST' });
            this.sequence = DeterministicSequence;
        }

        createObservation({ context, observationType, sequenceState, observedAt = new Date(), runId = null }) {
            if (!DriverObservationTypes.includes(observationType)) {
                throw new RangeError(`Unsupported deterministic observationType: ${observationType}`);
            }
            const sequence = observationType === 'INCAPACITATION'
                ? IncapacitationSequence
                : DrowsinessSequence;
            if (!sequence.includes(sequenceState)) {
                throw new RangeError(`Unsupported deterministic sequence state: ${sequenceState}`);
            }
            const sequenceIndex = sequence.indexOf(sequenceState);
            const drowsinessState = (
                sequenceState === DeterministicSequenceState.ENTRY_PENDING ||
                sequenceState === DeterministicSequenceState.RISK_CONFIRMED ||
                sequenceState === DeterministicSequenceState.RISK_MAINTAINED
            ) ? 'DROWSY' : 'NORMAL';
            const incapacitationRiskState = [
                DeterministicSequenceState.COMPOSITE_PENDING,
                DeterministicSequenceState.RISK_CONFIRMED,
                DeterministicSequenceState.RISK_MAINTAINED,
                DeterministicSequenceState.ACKNOWLEDGED
            ].includes(sequenceState);
            const incapacitationValue = {
                prolongedEyeClosure: incapacitationRiskState,
                headDrop: incapacitationRiskState,
                upperBodyCollapse: incapacitationRiskState,
                noResponse: incapacitationRiskState,
                noVehicleControlInput: false,
                vehicleMoving: true,
                qualityValid: sequenceState !== DeterministicSequenceState.NORMAL
            };
            const value = observationType === 'DROWSINESS'
                ? drowsinessState
                : (observationType === 'INCAPACITATION' ? incapacitationValue : sequenceState);
            return createDriverObservation({
                context,
                observationType,
                value,
                unit: observationType === 'INCAPACITATION' ? 'composite-driver-state' : (
                    observationType === 'DROWSINESS' ? 'driver-state' : 'sequence-state'
                ),
                confidence: 1,
                observedAt,
                metadata: {
                    cameraId: null,
                    sensorId: this.adapterId,
                    sensorType: this.sensorType,
                    source: 'deterministic-test',
                    simulation: true,
                    sensorConnected: false,
                    measurementStatus: sequenceState,
                    sampleWindowMs: 0,
                    algorithmVersion: 'deterministic-sequence-v1',
                    configurationVersion: global.DriverStateConfig.configurationVersion,
                    metrics: {
                        sequenceState,
                        sequenceIndex,
                        drowsinessState,
                        compositeSignalCount: observationType === 'INCAPACITATION'
                            ? Object.keys(incapacitationValue).filter(key => (
                                !['vehicleMoving', 'qualityValid'].includes(key) && incapacitationValue[key]
                            )).length
                            : null,
                        runId
                    },
                    quality: { deterministic: true },
                    policy: {
                        operationalUseAllowed: false,
                        notice: 'NOT_FOR_OPERATIONAL_DECISION'
                    }
                }
            });
        }

        createSequence({ context, observationType, startedAt = Date.now(), runId = null }) {
            const interval = global.DriverStateConfig.simulation.sequenceIntervalMs;
            const sequence = observationType === 'INCAPACITATION'
                ? IncapacitationSequence
                : DrowsinessSequence;
            const incapacitationOffsets = [0, 250, 500, 1000, 1250, 1500, 1750, 2250];
            return sequence.map((sequenceState, index) => this.createObservation({
                context,
                observationType,
                sequenceState,
                observedAt: new Date(startedAt + (
                    observationType === 'INCAPACITATION'
                        ? incapacitationOffsets[index]
                        : (index * interval)
                )),
                runId
            }));
        }
    }

    global.DriverSensorAdapters = Object.freeze({
        DriverCameraAdapter,
        AlcoholSensorAdapter,
        VehicleControlInputAdapter,
        DeterministicDriverTestAdapter,
        DeterministicSequenceState,
        DeterministicSequence,
        DrowsinessSequence,
        IncapacitationSequence
    });
}(window));
