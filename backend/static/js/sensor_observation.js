(function initializeSensorObservation(global) {
    'use strict';

    const ObservationType = Object.freeze({
        SPEED: 'SPEED',
        ACCELERATION: 'ACCELERATION',
        BRAKING: 'BRAKING',
        TURN_RATE: 'TURN_RATE',
        TILT: 'TILT',
        HUMAN_PROXIMITY: 'HUMAN_PROXIMITY',
        PEDESTRIAN_PROXIMITY: 'PEDESTRIAN_PROXIMITY',
        PEDESTRIAN_DISTANCE: 'PEDESTRIAN_DISTANCE',
        COLLISION_DISTANCE: 'COLLISION_DISTANCE',
        DROWSINESS: 'DROWSINESS',
        INCAPACITATION: 'INCAPACITATION',
        ALCOHOL_LEVEL: 'ALCOHOL_LEVEL'
    });

    class SensorObservation {
        constructor(input) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
                throw new TypeError('SensorObservation input must be an object');
            }

            const requiredFields = [
                'observationId', 'observationType', 'sensorId', 'targetId', 'value',
                'unit', 'confidence', 'observedAt', 'metadata'
            ];
            requiredFields.forEach(field => {
                if (!Object.prototype.hasOwnProperty.call(input, field) || input[field] === undefined) {
                    throw new TypeError(`SensorObservation.${field} is required`);
                }
            });

            ['observationId', 'sensorId', 'targetId', 'unit'].forEach(field => {
                if (typeof input[field] !== 'string' || input[field].trim() === '') {
                    throw new TypeError(`SensorObservation.${field} must be a non-empty string`);
                }
            });

            if (!Object.values(ObservationType).includes(input.observationType)) {
                throw new RangeError(`Unsupported observationType: ${input.observationType}`);
            }
            if (input.confidence !== null && (
                typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) ||
                input.confidence < 0 || input.confidence > 1
            )) {
                throw new RangeError('SensorObservation.confidence must be null or between 0 and 1');
            }
            if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
                throw new TypeError('SensorObservation.metadata must be an object');
            }
            if (input.confidence === null && input.metadata.quality?.confidenceAvailable !== false) {
                throw new TypeError('SensorObservation with null confidence requires metadata.quality.confidenceAvailable=false');
            }

            const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
            if (
                !(input.observedAt instanceof Date) &&
                (typeof input.observedAt !== 'string' || !isoTimestampPattern.test(input.observedAt))
            ) {
                throw new RangeError('SensorObservation.observedAt must be a valid ISO 8601 timestamp');
            }
            const observedDate = input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
            if (Number.isNaN(observedDate.getTime())) {
                throw new RangeError('SensorObservation.observedAt must be a valid ISO 8601 timestamp');
            }

            this.observationId = input.observationId;
            this.observationType = input.observationType;
            this.sensorId = input.sensorId;
            this.targetId = input.targetId;
            this.value = input.value;
            this.unit = input.unit;
            this.confidence = input.confidence;
            this.observedAt = observedDate.toISOString();
            this.metadata = input.metadata;
        }

        toJSON() {
            return {
                observationId: this.observationId,
                observationType: this.observationType,
                sensorId: this.sensorId,
                targetId: this.targetId,
                value: this.value,
                unit: this.unit,
                confidence: this.confidence,
                observedAt: this.observedAt,
                metadata: this.metadata
            };
        }
    }

    global.SafetyObservation = Object.freeze({ ObservationType, SensorObservation });
}(window));
