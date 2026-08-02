(function defineMultiHazardFusionConfig(global) {
    'use strict';
    global.MultiHazardFusionConfig = Object.freeze({
        configurationVersion: 'multi-hazard-fusion-config-v1',
        validationStatus: 'UNVALIDATED_DETERMINISTIC_FUSION_CANDIDATE',
        contextVersion: 'operational-context-v1',
        simulation: true, operationalUseAllowed: false,
        contextWindowMs: 10000, conditionTtlMs: 5000, clearedRiskRetentionMs: 3000,
        staleContextMs: 30000, fusionReevaluationMs: 250,
        bands: Object.freeze({ NORMAL:[0,19], CAUTION:[20,39], WARNING:[40,59], HIGH:[60,79], CRITICAL:[80,100] }),
        baseScores: Object.freeze({
            DROWSINESS: 42, DRIVER_INCAPACITATION: 78, ALCOHOL_POLICY_VIOLATION: 58,
            HUMAN_PROXIMITY: 55, DANGEROUS_TILT: 65, HARD_ACCELERATION: 38,
            HARD_BRAKING: 48, SHARP_TURN: 50, TURN_RATE: 50, VEHICLE_PROXIMITY: 62
        }),
        severityRank: Object.freeze({ LOW:1, MEDIUM:2, HIGH:3, CRITICAL:4 }),
        conditionMultipliers: Object.freeze({ VEHICLE_MOVING:1.20, REVERSING:1.15, CRITICAL_DISTANCE:1.15, SENSOR_QUALITY_DEGRADED:0.85 }),
        recoveryModifier: Object.freeze({ DRIVER_ACKNOWLEDGED:4 }),
        synergyRules: Object.freeze([
            Object.freeze({ id:'SYNERGY-DROWSY-PERSON', risks:['DROWSINESS','HUMAN_PROXIMITY'], conditions:[], bonus:18, minimumBand:'HIGH' }),
            Object.freeze({ id:'SYNERGY-DROWSY-REVERSE-PERSON', risks:['DROWSINESS','HUMAN_PROXIMITY'], conditions:['REVERSING'], bonus:24, minimumBand:'CRITICAL' }),
            Object.freeze({ id:'SYNERGY-TILT-PERSON', risks:['DANGEROUS_TILT','HUMAN_PROXIMITY'], conditions:[], bonus:22, minimumBand:'CRITICAL' }),
            Object.freeze({ id:'SYNERGY-BRAKE-PERSON', risks:['HARD_BRAKING','HUMAN_PROXIMITY'], conditions:[], bonus:12, minimumBand:'HIGH' }),
            Object.freeze({ id:'SYNERGY-TURN-PERSON', risks:['SHARP_TURN','HUMAN_PROXIMITY'], conditions:[], bonus:20, minimumBand:'CRITICAL' }),
            Object.freeze({ id:'SYNERGY-TURNRATE-PERSON', risks:['TURN_RATE','HUMAN_PROXIMITY'], conditions:[], bonus:20, minimumBand:'CRITICAL' })
            ,Object.freeze({ id:'SYNERGY-DROWSY-VEHICLE', risks:['DROWSINESS','VEHICLE_PROXIMITY'], conditions:[], bonus:16, minimumBand:'HIGH' })
            ,Object.freeze({ id:'SYNERGY-INCAP-VEHICLE', risks:['DRIVER_INCAPACITATION','VEHICLE_PROXIMITY'], conditions:[], bonus:20, minimumBand:'CRITICAL' })
            ,Object.freeze({ id:'SYNERGY-BRAKE-VEHICLE', risks:['HARD_BRAKING','VEHICLE_PROXIMITY'], conditions:[], bonus:12, minimumBand:'HIGH' })
            ,Object.freeze({ id:'SYNERGY-TURN-VEHICLE', risks:['SHARP_TURN','VEHICLE_PROXIMITY'], conditions:['VEHICLE_PROXIMITY_RELATED'], bonus:14, minimumBand:'HIGH' })
            ,Object.freeze({ id:'SYNERGY-HUMAN-VEHICLE-RELATED', risks:['HUMAN_PROXIMITY','VEHICLE_PROXIMITY'], conditions:['RELATED_HAZARD_FIXTURE'], bonus:10, minimumBand:'HIGH' })
        ]),
        overrideRules: Object.freeze([
            Object.freeze({ id:'OVERRIDE-INCAP-MOVING', risks:['DRIVER_INCAPACITATION'], conditions:['VEHICLE_MOVING'], score:100, policy:'EMERGENCY_RESPONSE_REQUEST', actions:['EMERGENCY_RESPONSE_REQUEST','SAFE_STOP_REQUEST'] }),
            Object.freeze({ id:'OVERRIDE-ALCOHOL-PRESTART', risks:['ALCOHOL_POLICY_VIOLATION'], conditions:['PRE_START'], score:85, policy:'BLOCK_START_REQUEST', actions:['BLOCK_START_REQUEST'] }),
            Object.freeze({ id:'OVERRIDE-ALCOHOL-MOVING', risks:['ALCOHOL_POLICY_VIOLATION'], conditions:['VEHICLE_MOVING'], score:90, policy:'SAFE_STOP_REQUEST', actions:['SAFE_STOP_REQUEST','SUPERVISOR_NOTIFICATION_REQUEST'] }),
            Object.freeze({ id:'OVERRIDE-TILT-MOVING', risks:['DANGEROUS_TILT'], conditions:['VEHICLE_MOVING'], score:88, policy:'SAFE_STOP_REQUEST', actions:['SAFE_STOP_REQUEST','BEACON_REQUEST'] }),
            Object.freeze({ id:'OVERRIDE-PERSON-REVERSE-CRITICAL', risks:['HUMAN_PROXIMITY'], conditions:['REVERSING','CRITICAL_DISTANCE'], score:95, policy:'SAFE_STOP_REQUEST', actions:['VOICE_WARNING','BEACON_REQUEST','SAFE_STOP_REQUEST'] })
        ]),
        actionsByBand: Object.freeze({
            NORMAL:[], CAUTION:['VISUAL_WARNING'], WARNING:['VOICE_WARNING','VISUAL_WARNING'],
            HIGH:['VOICE_WARNING','SEAT_VIBRATION_REQUEST','BEACON_REQUEST','SUPERVISOR_NOTIFICATION_REQUEST'],
            CRITICAL:['VOICE_WARNING','BEACON_REQUEST','SUPERVISOR_NOTIFICATION_REQUEST','SAFE_STOP_REQUEST']
        })
    });
})(window);
