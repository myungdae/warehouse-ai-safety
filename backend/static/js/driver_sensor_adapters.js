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
        NEW: 'NEW',
        ACTIVE: 'ACTIVE',
        RISK_CONFIRMED: 'RISK_CONFIRMED',
        RISK_MAINTAINED: 'RISK_MAINTAINED',
        ACKNOWLEDGED: 'ACKNOWLEDGED',
        RECOVERY_PENDING: 'RECOVERY_PENDING',
        CLEAR_PENDING: 'CLEAR_PENDING',
        CLEAR: 'CLEAR',
        READY: 'READY',
        WARMING_UP: 'WARMING_UP',
        MEASURING: 'MEASURING',
        VALID_OVER_THRESHOLD: 'VALID_OVER_THRESHOLD',
        VALID_CLEAR: 'VALID_CLEAR',
        CLEARED: 'CLEARED',
        FAILED: 'FAILED',
        IDENTITY_UNVERIFIED: 'IDENTITY_UNVERIFIED',
        BYPASS_SUSPECTED: 'BYPASS_SUSPECTED',
        IN_OPERATION_OVER_THRESHOLD: 'IN_OPERATION_OVER_THRESHOLD'
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
    const AlcoholSequence = Object.freeze([
        DeterministicSequenceState.READY,
        DeterministicSequenceState.WARMING_UP,
        DeterministicSequenceState.MEASURING,
        DeterministicSequenceState.VALID_OVER_THRESHOLD,
        DeterministicSequenceState.NEW,
        DeterministicSequenceState.ACTIVE,
        DeterministicSequenceState.ACKNOWLEDGED,
        DeterministicSequenceState.VALID_CLEAR,
        DeterministicSequenceState.CLEARED
    ]);
    const AlcoholObservationStates = Object.freeze([
        ...AlcoholSequence,
        DeterministicSequenceState.FAILED,
        DeterministicSequenceState.IDENTITY_UNVERIFIED,
        DeterministicSequenceState.BYPASS_SUSPECTED,
        DeterministicSequenceState.IN_OPERATION_OVER_THRESHOLD
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
                : (observationType === 'ALCOHOL_LEVEL' ? AlcoholObservationStates : DrowsinessSequence);
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
            const alcoholRule = global.DriverStateConfig.alcohol;
            const alcoholHighStates = [
                DeterministicSequenceState.VALID_OVER_THRESHOLD,
                DeterministicSequenceState.NEW,
                DeterministicSequenceState.ACTIVE,
                DeterministicSequenceState.ACKNOWLEDGED
            ];
            const alcoholStatus = [
                DeterministicSequenceState.VALID_OVER_THRESHOLD,
                DeterministicSequenceState.NEW,
                DeterministicSequenceState.ACTIVE,
                DeterministicSequenceState.ACKNOWLEDGED,
                DeterministicSequenceState.VALID_CLEAR,
                DeterministicSequenceState.CLEARED,
                DeterministicSequenceState.IDENTITY_UNVERIFIED,
                DeterministicSequenceState.BYPASS_SUSPECTED,
                DeterministicSequenceState.IN_OPERATION_OVER_THRESHOLD
            ].includes(sequenceState) ? 'VALID' : sequenceState;
            const alcoholValue = {
                rawValue: alcoholHighStates.includes(sequenceState) || sequenceState === DeterministicSequenceState.IN_OPERATION_OVER_THRESHOLD
                    ? alcoholRule.entryThreshold
                    : 0,
                unit: alcoholRule.unit,
                measurementMode: sequenceState === DeterministicSequenceState.IN_OPERATION_OVER_THRESHOLD
                    ? 'IN_OPERATION'
                    : 'PRE_START',
                measurementStatus: alcoholStatus,
                sampleId: `deterministic-alcohol-${runId || 'standalone'}-${sequenceIndex}`,
                attemptNumber: 1,
                retryCount: 0,
                identityVerified: sequenceState !== DeterministicSequenceState.IDENTITY_UNVERIFIED,
                sampleQuality: 1,
                calibrationStatus: 'VALID',
                bypassSuspected: sequenceState === DeterministicSequenceState.BYPASS_SUSPECTED
            };
            const value = observationType === 'DROWSINESS'
                ? drowsinessState
                : (observationType === 'INCAPACITATION'
                    ? incapacitationValue
                    : (observationType === 'ALCOHOL_LEVEL' ? alcoholValue : sequenceState));
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
                    measurementStatus: observationType === 'ALCOHOL_LEVEL' ? alcoholStatus : sequenceState,
                    measurementMode: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.measurementMode : null,
                    sampleId: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.sampleId : null,
                    attemptNumber: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.attemptNumber : null,
                    identityVerified: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.identityVerified : null,
                    sampleQuality: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.sampleQuality : null,
                    calibrationStatus: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.calibrationStatus : null,
                    bypassSuspected: observationType === 'ALCOHOL_LEVEL' ? alcoholValue.bypassSuspected : null,
                    sampleWindowMs: 0,
                    algorithmVersion: 'deterministic-sequence-v1',
                    configurationVersion: global.DriverStateConfig.configurationVersion,
                    policyVersion: observationType === 'ALCOHOL_LEVEL' ? alcoholRule.policyVersion : null,
                    operationalUseAllowed: false,
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
                : (observationType === 'ALCOHOL_LEVEL' ? AlcoholSequence : DrowsinessSequence);
            const incapacitationOffsets = [0, 250, 500, 1000, 1250, 1500, 1750, 2250];
            const alcoholOffsets = [0, 100, 200, 300, 600, 750, 900, 1050, 1350];
            return sequence.map((sequenceState, index) => this.createObservation({
                context,
                observationType,
                sequenceState,
                observedAt: new Date(startedAt + (
                    observationType === 'INCAPACITATION'
                        ? incapacitationOffsets[index]
                        : (observationType === 'ALCOHOL_LEVEL' ? alcoholOffsets[index] : (index * interval))
                )),
                runId
            }));
        }
    }

    class DeterministicAlcoholTestAdapter extends DeterministicDriverTestAdapter {
        constructor() {
            super();
            this.adapterId = 'deterministic-alcohol-test';
            this.sensorType = 'DETERMINISTIC_ALCOHOL_TEST';
        }

        createObservation(input) {
            if (input.observationType !== 'ALCOHOL_LEVEL') {
                throw new RangeError('DeterministicAlcoholTestAdapter only supports ALCOHOL_LEVEL');
            }
            return super.createObservation(input);
        }
    }

    global.DriverSensorAdapters = Object.freeze({
        DriverCameraAdapter,
        AlcoholSensorAdapter,
        VehicleControlInputAdapter,
        DeterministicDriverTestAdapter,
        DeterministicAlcoholTestAdapter,
        DeterministicSequenceState,
        DeterministicSequence,
        DrowsinessSequence,
        IncapacitationSequence,
        AlcoholSequence,
        AlcoholObservationStates
    });
}(window));
