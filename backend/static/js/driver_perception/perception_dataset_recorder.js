(function definePerceptionDatasetRecorder(global) {
    'use strict';
    const ns = global.DriverPerception = global.DriverPerception || {};
    const State = Object.freeze({ IDLE:'IDLE', ARMED:'ARMED', RECORDING:'RECORDING', PAUSED:'PAUSED', STOPPED:'STOPPED', EXPORTING:'EXPORTING', ERROR:'ERROR' });
    const SamplingMode = Object.freeze({ FIXED_INTERVAL:'FIXED_INTERVAL', EVENT_AWARE:'EVENT_AWARE', HYBRID:'HYBRID' });
    const scenarios = Object.freeze(['BASELINE','NATURAL_BLINK','EYE_CLOSURE','TALKING','SHORT_MOUTH_OPEN','YAWN_SIMULATION','NATURAL_YAWN','HEAD_POSE','FREE_OBSERVATION']);
    const markerTypes = Object.freeze(['NORMAL','BLINK','EYE_CLOSURE','TALKING','SHORT_MOUTH_OPEN','YAWN','HEAD_DOWN','QUALITY_ISSUE']);
    const enums = Object.freeze({ glassesMode:['UNKNOWN','WITH_GLASSES','WITHOUT_GLASSES'], lightingMode:['UNKNOWN','BRIGHT','NORMAL','DIM','NIGHT'], postureMode:['UNKNOWN','CENTER','SLIGHT_DOWN','SLIGHT_UP','LEFT','RIGHT'] });
    const forbiddenKeys = new Set(['landmarks','rawlandmarks','frame','video','canvas','image','imagedata','base64','blob','faceembedding','biometrictemplate','devicelabel','drivername','email','phone','address']);
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const finite = value => Number.isFinite(value) ? value : null;
    const iso = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : null; };

    function findForbidden(value, path='root', seen=new Set()) {
        if (!value || typeof value !== 'object') return null;
        if (seen.has(value)) return `${path}:CIRCULAR_REFERENCE`;
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
            if (forbiddenKeys.has(key.toLowerCase())) return `${path}.${key}`;
            const nested = findForbidden(child, `${path}.${key}`, seen); if (nested) return nested;
        }
        seen.delete(value); return null;
    }
    const safeCode = (value, name) => {
        const text = String(value || '').trim().toUpperCase();
        if (text && !/^[A-Z0-9_-]{1,16}$/.test(text)) throw new TypeError(`${name} must be an anonymous code`);
        return text || null;
    };
    const enumValue = (value, allowed, fallback='UNKNOWN') => allowed.includes(value) ? value : fallback;
    const sessionId = (now, sequence) => `PDR-${new Date(now).toISOString().replace(/[-:.Z]/g,'').slice(0,15)}-${String(sequence).padStart(3,'0')}`;
    const csvEscape = value => { if (value == null) return ''; const text=typeof value==='object'?JSON.stringify(value):String(value); return /[",\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text; };

    class PerceptionDatasetRecorder {
        constructor({ runtime=null, runtimeStateProvider=()=>null, now=()=>Date.now(), downloader=null, config=null }={}) {
            this.runtime=runtime; this.runtimeStateProvider=runtimeStateProvider; this.now=now;
            this.config={...(ns.Config?.recorder||{}),...(config||{})}; this.downloader=downloader||this._download.bind(this);
            this.state=State.IDLE; this.rows=[]; this.session=null; this.sequence=0; this.sessionSequence=0;
            this.lastRecordedAt=null; this.lastSignature=null; this.unsubscribe=null; this.stopReason=null; this.audit=[];
        }
        start(options={}) {
            if (![State.IDLE,State.STOPPED].includes(this.state)) throw new Error('INVALID_TRANSITION');
            const now=this.now(), samplingMode=Object.values(SamplingMode).includes(options.samplingMode)?options.samplingMode:this.config.defaultSamplingMode;
            this.reset(); this.sessionSequence+=1; this.session={sessionId:sessionId(now,this.sessionSequence),startedAt:new Date(now).toISOString(),stoppedAt:null,samplingMode,
                participantCode:safeCode(options.participantCode,'participantCode'),environmentCode:safeCode(options.environmentCode,'environmentCode'),deviceProfileCode:safeCode(options.deviceProfileCode,'deviceProfileCode'),
                glassesMode:enumValue(options.glassesMode,enums.glassesMode),lightingMode:enumValue(options.lightingMode,enums.lightingMode),postureMode:enumValue(options.postureMode,enums.postureMode),
                scenarioLabel:scenarios.includes(options.scenarioLabel)?options.scenarioLabel:'FREE_OBSERVATION'};
            this.state=State.RECORDING; this.stopReason=null;
            if (this.runtime?.onMetricSnapshot && !this.unsubscribe) this.unsubscribe=this.runtime.onMetricSnapshot(snapshot=>{try{this.recordSnapshot(snapshot);}catch(error){this._error(error);}});
            this._audit('STARTED'); return this.getState();
        }
        pause(){if(this.state!==State.RECORDING)throw Error('INVALID_TRANSITION');this.state=State.PAUSED;this._audit('PAUSED');return this.getState();}
        resume(){if(this.state!==State.PAUSED)throw Error('INVALID_TRANSITION');this.state=State.RECORDING;this._audit('RESUMED');return this.getState();}
        stop(reason='USER_STOPPED'){if(![State.RECORDING,State.PAUSED].includes(this.state))throw Error('INVALID_TRANSITION');this.state=State.STOPPED;this.stopReason=reason;if(this.session)this.session.stoppedAt=new Date(this.now()).toISOString();this._audit(reason);return this.getState();}
        reset(){this.unsubscribe?.();this.unsubscribe=null;this.rows=[];this.session=null;this.sequence=0;this.lastRecordedAt=null;this.lastSignature=null;this.stopReason=null;this.state=State.IDLE;return this.getState();}
        _signature(snapshot){const d=snapshot.diagnostics||{},m=snapshot.metrics||{};return JSON.stringify([snapshot.faceDetected,snapshot.quality?.landmarkAvailable,d.mouth?.marInvalidReason,d.eye?.blinkRejectReason,m.blinkCandidate,m.yawnCandidate,m.yawnConfirmed,this.runtimeStateProvider()?.riskState]);}
        _shouldRecord(snapshot, now){const active=snapshot.metrics?.blinkCandidate||snapshot.metrics?.yawnCandidate||snapshot.metrics?.yawnConfirmed||snapshot.calibrationState==='COLLECTING';const signature=this._signature(snapshot),changed=signature!==this.lastSignature;const interval=active?this.config.activeEpisodeIntervalMs:this.config.baseSamplingIntervalMs;if(this.session.samplingMode===SamplingMode.EVENT_AWARE)return changed;if(this.session.samplingMode===SamplingMode.FIXED_INTERVAL)return this.lastRecordedAt===null||now-this.lastRecordedAt>=this.config.baseSamplingIntervalMs;return changed||this.lastRecordedAt===null||now-this.lastRecordedAt>=interval;}
        recordSnapshot(snapshot){
            if(this.state!==State.RECORDING)return null;const now=this.now();if(now-Date.parse(this.session.startedAt)>=this.config.maximumSessionDurationMs){this.stop('SESSION_LIMIT_REACHED');return null;}
            const violation=findForbidden(snapshot);if(violation){this._error(new Error(`PRIVACY_VIOLATION:${violation}`));return null;}if(!this._shouldRecord(snapshot,now))return null;
            const row=this._buildRow(snapshot,now);const rowViolation=findForbidden(row);if(rowViolation){this._error(new Error(`PRIVACY_VIOLATION:${rowViolation}`));return null;}
            this.rows.push(Object.freeze(row));this.lastRecordedAt=now;this.lastSignature=this._signature(snapshot);if(this.rows.length>=this.config.maximumRowsPerSession)this.stop('SESSION_LIMIT_REACHED');return clone(row);
        }
        _buildRow(s,now){const m=s.metrics||{},q=s.quality||{},d=s.diagnostics||{},eye=d.eye||{},mouth=d.mouth||{},quality=d.quality||{},r=this.runtimeStateProvider?.()||{};this.sequence+=1;return {
            recordType:'METRIC',schemaVersion:this.config.schemaVersion,recorderVersion:this.config.recorderVersion,sessionId:this.session.sessionId,rowSequence:this.sequence,recordedAt:new Date(now).toISOString(),snapshotTimestamp:iso(s.timestamp),snapshotId:s.driverMetricSnapshotId||null,elapsedMs:now-Date.parse(this.session.startedAt),scenarioLabel:this.session.scenarioLabel,labelSource:'USER_SELECTED',
            perceptionRuntimeState:this.runtime?.state||null,cameraPermissionState:this.runtime?.cameraManager?.permissionState||null,faceDetected:s.faceDetected===true,landmarkAvailable:q.landmarkAvailable===true,frameProcessingStatus:s.status||s.runtime?.status||null,sampleAgeMs:finite(q.sampleAgeMs),processingTimeMs:finite(s.runtime?.processingTimeMs),frameDeltaMs:finite(eye.frameDeltaMs),
            calibrationState:s.calibrationState||null,calibrated:s.calibrated===true,earSampleCount:Number.isInteger(s.calibration?.sampleCount)?s.calibration.sampleCount:null,earBaseline:finite(m.earBaseline),earThreshold:finite(m.earThreshold),mouthCalibrationState:mouth.calibrationState||null,mouthCalibrationAvailable:q.mouthCalibrationAvailable===true,mouthSampleAccepted:mouth.calibrationAccepted??null,mouthSampleRejected:mouth.calibrationRejected??null,mouthBaseline:finite(m.mouthBaseline),mouthOpenThreshold:finite(m.mouthOpenThreshold),mouthCalibrationLastRejectReason:mouth.lastCalibrationRejectReason||null,
            leftEARRaw:finite(eye.leftEARRaw),rightEARRaw:finite(eye.rightEARRaw),leftEAR:finite(m.leftEAR),rightEAR:finite(m.rightEAR),earRaw:finite(eye.rawEAR),earSmoothed:finite(m.ear),earValid:q.earValid===true,eyeState:m.eyeState||null,eyeClosed:m.eyeClosed,eyeClosureDurationMs:finite(m.eyeClosureDurationMs),blinkCandidate:eye.blinkCandidate===true,blinkAccepted:eye.blinkAccepted===true,blinkCount:Number.isInteger(m.blinkCount)?m.blinkCount:null,blinkRate:finite(m.blinkRate),lastBlinkDurationMs:finite(m.lastBlinkDurationMs),blinkRejectReason:eye.blinkRejectReason||null,validFrameCountDuringClosure:eye.validFrameCountDuringClosure??null,invalidFrameCountDuringClosure:eye.invalidFrameCountDuringClosure??null,perclos:finite(m.perclos),perclosValid:q.perclosValid===true,validEyeTimeMs:finite(eye.validEyeTimeMs),closedEyeTimeMs:finite(eye.closedEyeTimeMs),
            marRaw:finite(m.marRaw),marSmoothed:finite(m.marSmoothed),marValid:q.marValid===true,marInvalidReason:mouth.marInvalidReason||null,mouthWidth:finite(mouth.mouthWidth),mouthVerticalDistance1:finite(mouth.verticalDistances?.[0]),mouthVerticalDistance2:finite(mouth.verticalDistances?.[1]),mouthVerticalDistance3:finite(mouth.verticalDistances?.[2]),mouthState:m.mouthState||null,mouthOpen:m.mouthOpen,mouthOpenDurationMs:finite(m.mouthOpenDurationMs),yawnState:m.yawnState||null,yawnCandidate:m.yawnCandidate===true,yawnConfirmed:m.yawnConfirmed===true,yawnCount:Number.isInteger(m.yawnCount)?m.yawnCount:null,lastYawnDurationMs:finite(m.lastYawnDurationMs),yawnMetricAvailable:q.yawnMetricAvailable===true,
            pitch:finite(m.pitch),roll:finite(m.roll),yaw:finite(m.yaw),headPoseState:m.headPoseState||null,headPoseValid:q.headPoseValid===true,headPoseAllowsEyeMetric:eye.headPoseAllowsEyeMetric===true,headPoseAllowsMouthMetric:mouth.headPoseAllowsMouthMetric===true,eyeQualityStatus:quality.eyeQualityStatus||null,mouthQualityStatus:quality.mouthQualityStatus||null,qualityGateStatus:quality.qualityGateStatus||null,rejectionDomain:mouth.marInvalidReason?'MOUTH':(eye.blinkRejectReason?'EYE':null),rejectionReason:mouth.marInvalidReason||eye.blinkRejectReason||null,diagnosticFlags:[mouth.marInvalidReason,eye.blinkRejectReason].filter(Boolean),
            liveBridgeEnabled:r.bridgeStatus!=null,inputMode:r.inputMode||null,bridgeStatus:r.bridgeStatus||null,riskSignal:r.riskSignal||null,riskState:r.riskState||null,policyStage:r.policyStage||null,latestActionType:r.latestActionType||null,observationSimulation:r.observationSimulation??null,actionExecutionSimulation:r.actionExecutionSimulation??null,
            imageStored:false,imageTransmitted:false,rawLandmarksStored:false,biometricTemplateCreated:false,browserLocalProcessing:true,operationalUseAllowed:false
        };}
        addMarker(markerType){if(this.state!==State.RECORDING)throw Error('INVALID_TRANSITION');if(!markerTypes.includes(markerType))throw Error('INVALID_MARKER');const now=this.now();if(now-Date.parse(this.session.startedAt)>=this.config.maximumSessionDurationMs||this.rows.length>=this.config.maximumRowsPerSession){this.stop('SESSION_LIMIT_REACHED');return null;}this.sequence+=1;const row=Object.freeze({recordType:'MARKER',schemaVersion:this.config.schemaVersion,recorderVersion:this.config.recorderVersion,sessionId:this.session.sessionId,rowSequence:this.sequence,recordedAt:new Date(now).toISOString(),elapsedMs:now-Date.parse(this.session.startedAt),scenarioLabel:this.session.scenarioLabel,labelSource:'USER_SELECTED',markerType,markerTimestamp:new Date(now).toISOString(),markerNoteCode:null,imageStored:false,imageTransmitted:false,rawLandmarksStored:false,biometricTemplateCreated:false,browserLocalProcessing:true,operationalUseAllowed:false});this.rows.push(row);if(this.rows.length>=this.config.maximumRowsPerSession)this.stop('SESSION_LIMIT_REACHED');return clone(row);}
        getRows(){return clone(this.rows);} getState(){return clone({state:this.state,sessionId:this.session?.sessionId||null,rowCount:this.rows.length,lastRecordTimestamp:this.lastRecordedAt?new Date(this.lastRecordedAt).toISOString():null,stopReason:this.stopReason,error:this.error||null});}
        getSessionSummary(){const metricRowCount=this.rows.filter(r=>r.recordType==='METRIC').length,markerCount=this.rows.length-metricRowCount;return clone({...this.session,durationMs:this.session?((this.session.stoppedAt?Date.parse(this.session.stoppedAt):this.now())-Date.parse(this.session.startedAt)):0,rowCount:this.rows.length,metricRowCount,markerCount,memoryUsageEstimateBytes:new TextEncoder().encode(JSON.stringify(this.rows)).length});}
        _manifest(){return {schemaVersion:this.config.schemaVersion,exportedAt:new Date(this.now()).toISOString(),session:this.getSessionSummary(),configuration:{perceptionConfigVersion:ns.Config?.configurationVersion||null,earConfig:clone(ns.Config?.metrics?.blink||{}),marConfig:clone(ns.Config?.yawn||{}),recorderConfig:clone(this.config)},privacy:{containsImages:false,containsRawLandmarks:false,containsBiometricTemplates:false,uploaded:false,browserLocalOnly:true},rows:this.getRows()};}
        exportCSV(){if(!this.rows.length)throw Error('NO_ROWS');this.state=State.EXPORTING;try{const headers=[...new Set(this.rows.flatMap(Object.keys))];const text='\uFEFF'+headers.join(',')+'\r\n'+this.rows.map(row=>headers.map(h=>csvEscape(row[h])).join(',')).join('\r\n');this.downloader(text,`perception-dataset-${this.session.sessionId}.csv`,'text/csv;charset=utf-8');return text;}finally{this.state=State.STOPPED;}}
        exportJSON(){if(!this.rows.length)throw Error('NO_ROWS');this.state=State.EXPORTING;try{const text=JSON.stringify(this._manifest(),null,2);this.downloader(text,`perception-dataset-${this.session.sessionId}.json`,'application/json;charset=utf-8');return text;}finally{this.state=State.STOPPED;}}
        _download(text,filename,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
        _error(error){this.state=State.ERROR;this.error=error.message;this._audit('ERROR');}
        _audit(type){this.audit.push({type,timestamp:new Date(this.now()).toISOString()});}
    }
    ns.PerceptionDatasetRecorderState=State;ns.PerceptionDatasetSamplingMode=SamplingMode;ns.PerceptionDatasetRecorder=PerceptionDatasetRecorder;ns.PerceptionDatasetScenarios=scenarios;ns.PerceptionDatasetMarkers=markerTypes;
})(window);
