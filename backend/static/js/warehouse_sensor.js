// Warehouse Sensor Monitoring Dashboard

// Sample Sensor Data
const sensorData = {
    cctv: [
        { id: 'CCTV-01', location: 'Aisle-A 입구', status: 'online', fps: 30, resolution: '1080p' },
        { id: 'CCTV-02', location: '교차로 X-1', status: 'online', fps: 30, resolution: '1080p' },
        { id: 'CCTV-03', location: 'Aisle-A 출구', status: 'offline', fps: 0, resolution: '-' },
        { id: 'CCTV-04', location: 'Aisle-D 입구', status: 'online', fps: 30, resolution: '1080p' },
        { id: 'CCTV-05', location: '교차로 X-2', status: 'online', fps: 30, resolution: '1080p' },
        { id: 'CCTV-06', location: 'Aisle-D 출구', status: 'degraded', fps: 15, resolution: '720p' },
        { id: 'CCTV-07', location: '보행자 구역', status: 'online', fps: 30, resolution: '1080p' },
        { id: 'CCTV-08', location: '출입구', status: 'online', fps: 30, resolution: '1080p' }
    ],
    lidar: [
        { id: 'LIDAR-01', location: '교차로 X-1', status: 'online', range: 30, accuracy: 0.1 },
        { id: 'LIDAR-02', location: '교차로 X-2', status: 'online', range: 30, accuracy: 0.1 },
        { id: 'LIDAR-03', location: '교차로 X-3', status: 'online', range: 30, accuracy: 0.1 },
        { id: 'LIDAR-04', location: '교차로 X-4', status: 'online', range: 30, accuracy: 0.1 },
        { id: 'LIDAR-05', location: '교차로 X-5', status: 'offline', range: 0, accuracy: 0 },
        { id: 'LIDAR-06', location: '교차로 X-6', status: 'online', range: 30, accuracy: 0.1 }
    ],
    uwb: [
        { id: 'UWB-GW-01', location: 'Aisle-A 북서', status: 'online', coverage: 200, tags: 8 },
        { id: 'UWB-GW-02', location: 'Aisle-A 북동', status: 'online', coverage: 200, tags: 6 },
        { id: 'UWB-GW-03', location: 'Aisle-A 남서', status: 'online', coverage: 200, tags: 5 },
        { id: 'UWB-GW-04', location: 'Aisle-D 북서', status: 'online', coverage: 200, tags: 7 },
        { id: 'UWB-GW-05', location: 'Aisle-D 북동', status: 'online', coverage: 200, tags: 9 },
        { id: 'UWB-GW-06', location: 'Aisle-D 남동', status: 'online', coverage: 200, tags: 4 }
    ],
    imu: [
        { id: 'IMU-F07', forklift: 'F-07', location: '지게차 F-07', status: 'online', accelX: 0.2, accelY: 0.1, accelZ: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, tilt: 0 },
        { id: 'IMU-F12', forklift: 'F-12', location: '지게차 F-12', status: 'online', accelX: 0.1, accelY: 0.0, accelZ: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, tilt: 0 },
        { id: 'IMU-F03', forklift: 'F-03', location: '지게차 F-03', status: 'online', accelX: 0.0, accelY: 0.2, accelZ: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, tilt: 0 },
        { id: 'IMU-F15', forklift: 'F-15', location: '지게차 F-15', status: 'online', accelX: 0.1, accelY: 0.1, accelZ: 9.8, gyroX: 0, gyroY: 0, gyroZ: 0, tilt: 0 }
    ]
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    updateClock();
    setInterval(updateClock, 1000);
    showSensorType('all');
});

// Toggle Menu
function toggleMenu(menuId) {
    const menu = document.getElementById(menuId);
    menu.classList.toggle('expanded');
}

// Show System Info
function showSystemInfo() {
    document.getElementById('pageTitle').textContent = '📊 시스템 정보';
    document.getElementById('pageSubtitle').textContent = 'Warehouse AI Safety System';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="system-info-box">
            <div class="info-section">
                <h3>🚛 실시간 지게차 추적</h3>
                <p>AI 기반 충돌 위험 예측 및 실시간 위치 모니터링</p>
            </div>
            <div class="info-section">
                <h3>🔊 3채널 음성 명령</h3>
                <p>지게차 스피커 • 구역 스피커 • 웨어러블 기기</p>
            </div>
            <div class="info-section">
                <h3>📡 센서 융합</h3>
                <p>CCTV 8대 • LiDAR 6대 • UWB 6대 • IMU 4대 통합 모니터링</p>
            </div>
            <div class="info-section" style="background: rgba(245, 158, 11, 0.1); padding: 15px; border-radius: 8px; border-left: 3px solid #f59e0b;">
                <h3>⚠️ Human-in-the-loop</h3>
                <p style="font-size: 0.95rem;">시스템은 조언만 제공하며, 최종 결정은 운전자가 합니다.</p>
            </div>
        </div>
    `;
}

// Show Sensor Type
function showSensorType(type) {
    let title, subtitle, sensors;
    
    if (type === 'all') {
        title = '📊 전체 센서 모니터링';
        subtitle = '모든 센서 상태 확인';
        sensors = [...sensorData.cctv, ...sensorData.lidar, ...sensorData.uwb, ...sensorData.imu];
    } else if (type === 'cctv') {
        title = '📹 CCTV 모니터링';
        subtitle = '영상 감시 센서 (8대)';
        sensors = sensorData.cctv;
    } else if (type === 'lidar') {
        title = '📡 LiDAR 모니터링';
        subtitle = '3D 스캔 센서 (6대)';
        sensors = sensorData.lidar;
    } else if (type === 'uwb') {
        title = '📍 UWB 모니터링';
        subtitle = '정밀 위치 추적 센서 (6대)';
        sensors = sensorData.uwb;
    } else if (type === 'imu') {
        title = '📳 IMU 모니터링';
        subtitle = '관성 측정 센서 (4대)';
        sensors = sensorData.imu;
    }
    
    document.getElementById('pageTitle').innerHTML = title;
    document.getElementById('pageSubtitle').textContent = subtitle;
    
    renderSensorCards(sensors, type);
}

// Render Sensor Cards
function renderSensorCards(sensors, type) {
    const content = document.getElementById('dashboardContent');
    
    let html = '<div class="sensor-grid">';
    
    sensors.forEach(sensor => {
        const icon = getIcon(sensor.id);
        const metrics = getMetrics(sensor, type);
        
        html += `
            <div class="sensor-card" onclick="showSensorDetail('${sensor.id}')">
                <div class="sensor-card-header">
                    <span class="sensor-icon">${icon}</span>
                    <div class="sensor-status">
                        <span class="status-dot ${sensor.status}"></span>
                        <span>${getStatusText(sensor.status)}</span>
                    </div>
                </div>
                <div class="sensor-card-body">
                    <div class="sensor-id">${sensor.id}</div>
                    <div class="sensor-location">${sensor.location}</div>
                </div>
                <div class="sensor-card-footer">
                    ${metrics}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    content.innerHTML = html;
}

// Get Icon
function getIcon(id) {
    if (id.startsWith('CCTV')) return '📹';
    if (id.startsWith('LIDAR')) return '📡';
    if (id.startsWith('UWB')) return '📍';
    return '📊';
}

// Get Status Text
function getStatusText(status) {
    if (status === 'online') return '정상';
    if (status === 'offline') return '오프라인';
    if (status === 'degraded') return '불안정';
    return '알 수 없음';
}

// Get Metrics
function getMetrics(sensor, type) {
    let html = '';
    
    if (sensor.id.startsWith('CCTV')) {
        html += `
            <div class="sensor-metric">
                <div class="metric-label">FPS</div>
                <div class="metric-value">${sensor.fps}</div>
            </div>
            <div class="sensor-metric">
                <div class="metric-label">해상도</div>
                <div class="metric-value">${sensor.resolution}</div>
            </div>
        `;
    } else if (sensor.id.startsWith('LIDAR')) {
        html += `
            <div class="sensor-metric">
                <div class="metric-label">범위(m)</div>
                <div class="metric-value">${sensor.range}</div>
            </div>
            <div class="sensor-metric">
                <div class="metric-label">정확도(m)</div>
                <div class="metric-value">${sensor.accuracy}</div>
            </div>
        `;
    } else if (sensor.id.startsWith('UWB')) {
        html += `
            <div class="sensor-metric">
                <div class="metric-label">커버리지</div>
                <div class="metric-value">${sensor.coverage}m</div>
            </div>
            <div class="sensor-metric">
                <div class="metric-label">태그</div>
                <div class="metric-value">${sensor.tags}개</div>
            </div>
        `;
    } else if (sensor.id.startsWith('IMU')) {
        const accel = Math.sqrt(sensor.accelX**2 + sensor.accelY**2 + sensor.accelZ**2).toFixed(1);
        const gyro = Math.sqrt(sensor.gyroX**2 + sensor.gyroY**2 + sensor.gyroZ**2).toFixed(1);
        html += `
            <div class="sensor-metric">
                <div class="metric-label">가속도(m/s²)</div>
                <div class="metric-value">${accel}</div>
            </div>
            <div class="sensor-metric">
                <div class="metric-label">회전(°/s)</div>
                <div class="metric-value">${gyro}</div>
            </div>
            <div class="sensor-metric">
                <div class="metric-label">기울기(°)</div>
                <div class="metric-value">${sensor.tilt}</div>
            </div>
        `;
    }
    
    return html;
}

// Show Digital Twin
function showDigitalTwin() {
    document.getElementById('pageTitle').innerHTML = '🗺️ 디지털 트윈';
    document.getElementById('pageSubtitle').textContent = '실시간 물류센터 지도';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="dashboard-grid-fullmap">
            <!-- Full Width Warehouse Map -->
            <div class="warehouse-map-full">
                <div class="panel-header-inline">
                    <h3>🗺️ 물류센터 실시간 지도</h3>
                    <div class="map-controls">
                        <button class="btn-control" onclick="resetDigitalTwinView()">🔄 뷰 리셋</button>
                        <button class="btn-control" onclick="toggleDigitalTwinLabels()">🏷️ 라벨</button>
                        <button class="btn-control btn-danger" onclick="triggerScenario1()">📍 시나리오 1</button>
                        <button class="btn-control btn-warning" onclick="triggerScenario2()">📍 시나리오 2</button>
                        <button class="btn-control btn-info" onclick="triggerScenario3()">📍 시나리오 3</button>
                        <button class="btn-control btn-imu" onclick="triggerScenario4()">📍 시나리오 4</button>
                        <button class="btn-control btn-imu" onclick="triggerAccelerationTest()">⚡ 급가속 테스트</button>
                        <button class="btn-control btn-danger" onclick="triggerBrakingTest()">🛑 급제동 테스트</button>
                        <button class="btn-control btn-info" onclick="triggerTurnRateTest()">🔄 급회전 테스트</button>
                    </div>
                </div>
                <div class="map-canvas-large" id="digitalTwinMap">
                    <svg id="digitalTwinSvg" width="100%" height="100%" viewBox="0 0 1000 600" style="background: #f5f5f5;">
                        <defs>
                            <pattern id="dtGrid" width="50" height="50" patternUnits="userSpaceOnUse">
                                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e0e0e0" stroke-width="0.5"/>
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#dtGrid)" />
                        <g id="dtLayout"></g>
                        <g id="dtForklifts"></g>
                        <g id="dtSensors"></g>
                    </svg>
                </div>
                <div class="map-legend-bottom">
                    <div class="legend-item"><span class="legend-dot" style="background:#2196F3;"></span> CCTV (8)</div>
                    <div class="legend-item"><span class="legend-dot" style="background:#FF9800;"></span> LiDAR (6)</div>
                    <div class="legend-item"><span class="legend-dot" style="background:#9C27B0;"></span> UWB (6)</div>
                    <div class="legend-item"><span class="legend-dot" style="background:#E91E63;"></span> IMU (4)</div>
                    <div class="legend-item"><span class="legend-dot" style="background:#4CAF50;"></span> 지게차 (4)</div>
                </div>
            </div>
        </div>
    `;
    
    // Initialize the digital twin map with animation
    setTimeout(() => {
        initializeFullDigitalTwin();
    }, 100);
}

// Show Sensor Detail (placeholder)
function showSensorDetail(id) {
    console.log('Sensor detail:', id);
    // TODO: 센서 상세 정보 모달 구현
}

// Show Forklift Tracking
function showForkliftTracking() {
    document.getElementById('pageTitle').innerHTML = '🚛 지게차 실시간 추적';
    document.getElementById('pageSubtitle').textContent = '4대 운행 중';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="forklift-grid">
            <div class="forklift-card">
                <div class="forklift-header">
                    <span class="forklift-icon">🚛</span>
                    <span class="forklift-id">F-07</span>
                    <span class="status-badge-small online">운행 중</span>
                </div>
                <div class="forklift-info">
                    <div class="info-row">
                        <span class="info-label">위치</span>
                        <span class="info-value">Aisle-A</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">속도</span>
                        <span class="info-value">12 km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">운전자</span>
                        <span class="info-value">김철수</span>
                    </div>
                </div>
            </div>
            
            <div class="forklift-card">
                <div class="forklift-header">
                    <span class="forklift-icon">🚛</span>
                    <span class="forklift-id">F-12</span>
                    <span class="status-badge-small online">운행 중</span>
                </div>
                <div class="forklift-info">
                    <div class="info-row">
                        <span class="info-label">위치</span>
                        <span class="info-value">Aisle-A</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">속도</span>
                        <span class="info-value">8 km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">운전자</span>
                        <span class="info-value">이영희</span>
                    </div>
                </div>
            </div>
            
            <div class="forklift-card">
                <div class="forklift-header">
                    <span class="forklift-icon">🚛</span>
                    <span class="forklift-id">F-03</span>
                    <span class="status-badge-small online">운행 중</span>
                </div>
                <div class="forklift-info">
                    <div class="info-row">
                        <span class="info-label">위치</span>
                        <span class="info-value">Aisle-B</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">속도</span>
                        <span class="info-value">10 km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">운전자</span>
                        <span class="info-value">박민수</span>
                    </div>
                </div>
            </div>
            
            <div class="forklift-card">
                <div class="forklift-header">
                    <span class="forklift-icon">🚛</span>
                    <span class="forklift-id">F-15</span>
                    <span class="status-badge-small online">운행 중</span>
                </div>
                <div class="forklift-info">
                    <div class="info-row">
                        <span class="info-label">위치</span>
                        <span class="info-value">Aisle-C</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">속도</span>
                        <span class="info-value">6 km/h</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">운전자</span>
                        <span class="info-value">최지혜</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Show Risk Events
function showRiskEvents() {
    document.getElementById('pageTitle').innerHTML = '⚠️ 위험 이벤트';
    document.getElementById('pageSubtitle').textContent = '오늘 12건 감지';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="events-container">
            <div class="event-item high-risk">
                <div class="event-header">
                    <span class="event-icon">🔴</span>
                    <span class="event-title">고위험 충돌 경고</span>
                    <span class="event-time">5분 전</span>
                </div>
                <div class="event-body">
                    F-07 지게차와 보행자 간 거리 2m 미만 감지 (교차로 X-1)
                </div>
                <div class="event-action">
                    음성 명령 발령: "정지하세요! 보행자 접근 중"
                </div>
            </div>
            
            <div class="event-item medium-risk">
                <div class="event-header">
                    <span class="event-icon">🟠</span>
                    <span class="event-title">중위험 과속 감지</span>
                    <span class="event-time">12분 전</span>
                </div>
                <div class="event-body">
                    F-12 지게차 Aisle-A 구간 속도 18km/h (제한속도 15km/h)
                </div>
                <div class="event-action">
                    음성 명령 발령: "속도를 줄이세요"
                </div>
            </div>
            
            <div class="event-item low-risk">
                <div class="event-header">
                    <span class="event-icon">🟡</span>
                    <span class="event-title">저위험 근접 경고</span>
                    <span class="event-time">25분 전</span>
                </div>
                <div class="event-body">
                    F-03과 F-15 지게차 간 거리 5m 미만 (Aisle-C)
                </div>
                <div class="event-action">
                    음성 명령 발령: "전방 차량 주의"
                </div>
            </div>
            
            <div class="event-item medium-risk">
                <div class="event-header">
                    <span class="event-icon">🟠</span>
                    <span class="event-title">중위험 블라인드 구역</span>
                    <span class="event-time">38분 전</span>
                </div>
                <div class="event-body">
                    F-07 지게차 교차로 진입 시 사각지대 감지
                </div>
                <div class="event-action">
                    음성 명령 발령: "블라인드 구역, 서행하세요"
                </div>
            </div>
        </div>
    `;
}

// Show Voice Commands
function showVoiceCommands() {
    document.getElementById('pageTitle').innerHTML = '🎤 음성 명령';
    document.getElementById('pageSubtitle').textContent = '실시간 음성 제어 시스템';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="voice-control-panel">
            <!-- Voice Input Section -->
            <div class="voice-input-section">
                <div class="voice-input-card">
                    <div class="voice-header">
                        <h3>🎤 음성 명령 입력</h3>
                        <div class="voice-status" id="voiceStatus">
                            <span class="status-dot"></span>
                            <span class="status-text">준비</span>
                        </div>
                    </div>
                    
                    <div class="voice-controls">
                        <button class="btn-voice-start" id="startVoiceBtn" onclick="startVoiceRecognition()">
                            🎤 음성 인식 시작
                        </button>
                        <button class="btn-voice-stop" id="stopVoiceBtn" onclick="stopVoiceRecognition()" disabled>
                            ⏹️ 중지
                        </button>
                    </div>
                    
                    <div class="voice-transcript-box" id="transcriptBox">
                        <div class="transcript-placeholder">
                            음성 명령을 말해주세요...
                        </div>
                    </div>
                    
                    <div class="voice-commands-help">
                        <h4>📋 사용 가능한 명령어</h4>
                        <div class="command-examples">
                            <div class="example-item">🚛 "F-07 정지" - 지게차 F-07을 정지시킵니다</div>
                            <div class="example-item">⚠️ "위험 알림" - 위험 경고를 발생시킵니다</div>
                            <div class="example-item">🔄 "리셋" - 시스템을 초기화합니다</div>
                            <div class="example-item">📍 "시나리오 1" - 충돌 위험 시뮬레이션 실행</div>
                            <div class="example-item">🗺️ "지도 보기" - 디지털 트윈 지도로 이동</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Command History Section -->
            <div class="voice-history-section">
                <div class="voice-history-card">
                    <h3>📜 명령 이력</h3>
                    <div class="command-history" id="commandHistory">
                        <div class="command-item">
                            <div class="command-header">
                                <span class="command-icon">🔊</span>
                                <span class="command-target">Aisle-A → 구역 스피커</span>
                                <span class="command-time">8분 전</span>
                            </div>
                            <div class="command-body">
                                "Aisle-A 보행자 주의, 지게차 진입 중"
                            </div>
                            <div class="command-status delivered">✓ 전달 완료</div>
                        </div>
                        
                        <div class="command-item">
                            <div class="command-header">
                                <span class="command-icon">🔊</span>
                                <span class="command-target">F-12 → 지게차 스피커</span>
                                <span class="command-time">12분 전</span>
                            </div>
                            <div class="command-body">
                                "속도를 줄이세요. 현재 속도 18km/h"
                            </div>
                            <div class="command-status delivered">✓ 전달 완료</div>
                        </div>
                        
                        <div class="command-item">
                            <div class="command-header">
                                <span class="command-icon">🔊</span>
                                <span class="command-target">작업자-03 → 웨어러블</span>
                                <span class="command-time">15분 전</span>
                            </div>
                            <div class="command-body">
                                "지게차 접근 중, 안전 구역으로 이동하세요"
                            </div>
                            <div class="command-status delivered">✓ 전달 완료</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Initialize voice recognition
    initializeVoiceRecognition();
}

// Update Clock
function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('ko-KR');
}

// ========================================
// SENSOR OBSERVATION MODEL
// ========================================

const ObservationType = Object.freeze({
    SPEED: 'SPEED',
    ACCELERATION: 'ACCELERATION',
    BRAKING: 'BRAKING',
    TURN_RATE: 'TURN_RATE',
    TILT: 'TILT',
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
            'observationId',
            'observationType',
            'sensorId',
            'targetId',
            'value',
            'unit',
            'confidence',
            'observedAt',
            'metadata'
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
        if (
            typeof input.confidence !== 'number' ||
            !Number.isFinite(input.confidence) ||
            input.confidence < 0 ||
            input.confidence > 1
        ) {
            throw new RangeError('SensorObservation.confidence must be between 0 and 1');
        }
        if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
            throw new TypeError('SensorObservation.metadata must be an object');
        }

        const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
        if (
            !(input.observedAt instanceof Date) &&
            (typeof input.observedAt !== 'string' || !isoTimestampPattern.test(input.observedAt))
        ) {
            throw new RangeError('SensorObservation.observedAt must be a valid ISO 8601 timestamp');
        }
        const observedDate = input.observedAt instanceof Date
            ? input.observedAt
            : new Date(input.observedAt);
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

const TILT_RISK_RULE = Object.freeze({
    ENTRY_THRESHOLD_DEGREES: 20,
    CLEAR_THRESHOLD_DEGREES: 15,
    MINIMUM_DURATION_MS: 1500
});

const ACCELERATION_RISK_RULE = Object.freeze({
    ENTRY_THRESHOLD_MPS2: 3,
    CLEAR_THRESHOLD_MPS2: 1,
    MINIMUM_DURATION_MS: 150
});

const BRAKING_RISK_RULE = Object.freeze({
    ENTRY_THRESHOLD_MPS2: -3,
    CLEAR_THRESHOLD_MPS2: -1,
    MINIMUM_DURATION_MS: 150
});

const TURN_RATE_RISK_RULE = Object.freeze({
    ENTRY_THRESHOLD_DPS: 45,
    CLEAR_THRESHOLD_DPS: 30,
    MINIMUM_DURATION_MS: 150,
    MINIMUM_SPEED: 0.5
});

const tiltRiskStates = new Map();
const accelerationRiskStates = new Map();
const brakingRiskStates = new Map();
const turnRateRiskStates = new Map();

function observationToRiskSignal(observation) {
    if (!(observation instanceof SensorObservation)) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: null,
            reason: 'INVALID_OBSERVATION'
        };
    }

    if (observation.observationType === ObservationType.TILT) {
        return tiltObservationToRiskSignal(observation);
    }

    if (observation.observationType === ObservationType.ACCELERATION) {
        return accelerationObservationToRiskSignal(observation);
    }

    if (observation.observationType === ObservationType.BRAKING) {
        return brakingObservationToRiskSignal(observation);
    }

    if (observation.observationType === ObservationType.TURN_RATE) {
        return turnRateObservationToRiskSignal(observation);
    }

    return {
        shouldCreateRisk: false,
        shouldClearRisk: false,
        eventInput: null,
        observation: observation.toJSON(),
        reason: 'NO_RISK_RULE_CONFIGURED'
    };
}

function turnRateObservationToRiskSignal(observation) {
    const turnRateDps = Number(observation.value);
    const speed = Number(observation.metadata.speed);
    if (!Number.isFinite(turnRateDps) || !Number.isFinite(speed)) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'INVALID_TURN_RATE_VALUE'
        };
    }

    const observedAtMs = Date.parse(observation.observedAt);
    const absoluteTurnRate = Math.abs(turnRateDps);
    const targetState = turnRateRiskStates.get(observation.targetId) || {
        thresholdEnteredAt: null,
        riskActive: false
    };

    if (targetState.riskActive) {
        if (
            absoluteTurnRate <= TURN_RATE_RISK_RULE.CLEAR_THRESHOLD_DPS ||
            speed < TURN_RATE_RISK_RULE.MINIMUM_SPEED
        ) {
            turnRateRiskStates.delete(observation.targetId);
            return {
                shouldCreateRisk: false,
                shouldClearRisk: true,
                eventInput: null,
                observation: observation.toJSON(),
                reason: 'TURN_RATE_CLEARED'
            };
        }

        turnRateRiskStates.set(observation.targetId, targetState);
        return createTurnRateRiskSignal(observation, 'TURN_RATE_RISK_MAINTAINED');
    }

    if (
        absoluteTurnRate >= TURN_RATE_RISK_RULE.ENTRY_THRESHOLD_DPS &&
        speed >= TURN_RATE_RISK_RULE.MINIMUM_SPEED
    ) {
        if (targetState.thresholdEnteredAt === null || observedAtMs < targetState.thresholdEnteredAt) {
            targetState.thresholdEnteredAt = observedAtMs;
        }

        if (observedAtMs - targetState.thresholdEnteredAt >= TURN_RATE_RISK_RULE.MINIMUM_DURATION_MS) {
            targetState.riskActive = true;
            turnRateRiskStates.set(observation.targetId, targetState);
            return createTurnRateRiskSignal(observation, 'TURN_RATE_RISK_CONFIRMED');
        }

        turnRateRiskStates.set(observation.targetId, targetState);
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'TURN_RATE_MINIMUM_DURATION_PENDING'
        };
    }

    turnRateRiskStates.delete(observation.targetId);
    return {
        shouldCreateRisk: false,
        shouldClearRisk: false,
        eventInput: null,
        observation: observation.toJSON(),
        reason: 'TURN_RATE_BELOW_ENTRY_THRESHOLD'
    };
}

function createTurnRateRiskSignal(observation, reason) {
    return {
        shouldCreateRisk: true,
        shouldClearRisk: false,
        eventInput: {
            eventType: 'SHARP_TURN',
            targetId: observation.targetId,
            severity: 'MEDIUM'
        },
        observation: observation.toJSON(),
        reason
    };
}

function brakingObservationToRiskSignal(observation) {
    const accelerationMps2 = Number(observation.value);
    if (!Number.isFinite(accelerationMps2)) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'INVALID_BRAKING_VALUE'
        };
    }

    const observedAtMs = Date.parse(observation.observedAt);
    const targetState = brakingRiskStates.get(observation.targetId) || {
        thresholdEnteredAt: null,
        riskActive: false
    };

    if (targetState.riskActive) {
        if (accelerationMps2 > BRAKING_RISK_RULE.CLEAR_THRESHOLD_MPS2) {
            brakingRiskStates.delete(observation.targetId);
            return {
                shouldCreateRisk: false,
                shouldClearRisk: true,
                eventInput: null,
                observation: observation.toJSON(),
                reason: 'BRAKING_CLEARED'
            };
        }

        brakingRiskStates.set(observation.targetId, targetState);
        return createBrakingRiskSignal(observation, 'BRAKING_RISK_MAINTAINED');
    }

    if (accelerationMps2 <= BRAKING_RISK_RULE.ENTRY_THRESHOLD_MPS2) {
        if (targetState.thresholdEnteredAt === null || observedAtMs < targetState.thresholdEnteredAt) {
            targetState.thresholdEnteredAt = observedAtMs;
        }

        if (observedAtMs - targetState.thresholdEnteredAt >= BRAKING_RISK_RULE.MINIMUM_DURATION_MS) {
            targetState.riskActive = true;
            brakingRiskStates.set(observation.targetId, targetState);
            return createBrakingRiskSignal(observation, 'BRAKING_RISK_CONFIRMED');
        }

        brakingRiskStates.set(observation.targetId, targetState);
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'BRAKING_MINIMUM_DURATION_PENDING'
        };
    }

    brakingRiskStates.delete(observation.targetId);
    return {
        shouldCreateRisk: false,
        shouldClearRisk: false,
        eventInput: null,
        observation: observation.toJSON(),
        reason: 'BRAKING_BELOW_ENTRY_THRESHOLD'
    };
}

function createBrakingRiskSignal(observation, reason) {
    return {
        shouldCreateRisk: true,
        shouldClearRisk: false,
        eventInput: {
            eventType: 'HARD_BRAKING',
            targetId: observation.targetId,
            severity: 'HIGH'
        },
        observation: observation.toJSON(),
        reason
    };
}

function accelerationObservationToRiskSignal(observation) {
    const accelerationMps2 = Number(observation.value);
    if (!Number.isFinite(accelerationMps2)) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'INVALID_ACCELERATION_VALUE'
        };
    }

    const observedAtMs = Date.parse(observation.observedAt);
    const targetState = accelerationRiskStates.get(observation.targetId) || {
        thresholdEnteredAt: null,
        riskActive: false
    };

    if (targetState.riskActive) {
        if (accelerationMps2 <= ACCELERATION_RISK_RULE.CLEAR_THRESHOLD_MPS2) {
            accelerationRiskStates.delete(observation.targetId);
            return {
                shouldCreateRisk: false,
                shouldClearRisk: true,
                eventInput: null,
                observation: observation.toJSON(),
                reason: 'ACCELERATION_CLEARED'
            };
        }

        accelerationRiskStates.set(observation.targetId, targetState);
        return createAccelerationRiskSignal(observation, 'ACCELERATION_RISK_MAINTAINED');
    }

    if (accelerationMps2 >= ACCELERATION_RISK_RULE.ENTRY_THRESHOLD_MPS2) {
        if (targetState.thresholdEnteredAt === null || observedAtMs < targetState.thresholdEnteredAt) {
            targetState.thresholdEnteredAt = observedAtMs;
        }

        if (observedAtMs - targetState.thresholdEnteredAt >= ACCELERATION_RISK_RULE.MINIMUM_DURATION_MS) {
            targetState.riskActive = true;
            accelerationRiskStates.set(observation.targetId, targetState);
            return createAccelerationRiskSignal(observation, 'ACCELERATION_RISK_CONFIRMED');
        }

        accelerationRiskStates.set(observation.targetId, targetState);
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'ACCELERATION_MINIMUM_DURATION_PENDING'
        };
    }

    accelerationRiskStates.delete(observation.targetId);
    return {
        shouldCreateRisk: false,
        shouldClearRisk: false,
        eventInput: null,
        observation: observation.toJSON(),
        reason: 'ACCELERATION_BELOW_ENTRY_THRESHOLD'
    };
}

function createAccelerationRiskSignal(observation, reason) {
    return {
        shouldCreateRisk: true,
        shouldClearRisk: false,
        eventInput: {
            eventType: 'HARD_ACCELERATION',
            targetId: observation.targetId,
            severity: 'MEDIUM'
        },
        observation: observation.toJSON(),
        reason
    };
}

function tiltObservationToRiskSignal(observation) {
    const tiltDegrees = Number(observation.value);
    if (!Number.isFinite(tiltDegrees)) {
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'INVALID_TILT_VALUE'
        };
    }

    const observedAtMs = Date.parse(observation.observedAt);
    const targetState = tiltRiskStates.get(observation.targetId) || {
        thresholdEnteredAt: null,
        riskActive: false
    };

    if (targetState.riskActive) {
        if (tiltDegrees < TILT_RISK_RULE.CLEAR_THRESHOLD_DEGREES) {
            tiltRiskStates.delete(observation.targetId);
            return {
                shouldCreateRisk: false,
                shouldClearRisk: true,
                eventInput: null,
                observation: observation.toJSON(),
                reason: 'TILT_CLEARED'
            };
        }

        tiltRiskStates.set(observation.targetId, targetState);
        return createTiltRiskSignal(observation, 'TILT_RISK_MAINTAINED');
    }

    if (tiltDegrees >= TILT_RISK_RULE.ENTRY_THRESHOLD_DEGREES) {
        if (targetState.thresholdEnteredAt === null || observedAtMs < targetState.thresholdEnteredAt) {
            targetState.thresholdEnteredAt = observedAtMs;
        }

        if (observedAtMs - targetState.thresholdEnteredAt >= TILT_RISK_RULE.MINIMUM_DURATION_MS) {
            targetState.riskActive = true;
            tiltRiskStates.set(observation.targetId, targetState);
            return createTiltRiskSignal(observation, 'TILT_RISK_CONFIRMED');
        }

        tiltRiskStates.set(observation.targetId, targetState);
        return {
            shouldCreateRisk: false,
            shouldClearRisk: false,
            eventInput: null,
            observation: observation.toJSON(),
            reason: 'TILT_MINIMUM_DURATION_PENDING'
        };
    }

    tiltRiskStates.delete(observation.targetId);
    return {
        shouldCreateRisk: false,
        shouldClearRisk: false,
        eventInput: null,
        observation: observation.toJSON(),
        reason: 'TILT_BELOW_ENTRY_THRESHOLD'
    };
}

function createTiltRiskSignal(observation, reason) {
    return {
        shouldCreateRisk: true,
        shouldClearRisk: false,
        eventInput: {
            eventType: 'DANGEROUS_TILT',
            targetId: observation.targetId,
            severity: 'HIGH'
        },
        observation: observation.toJSON(),
        reason
    };
}

// ========================================
// RISK EVENT STATE MACHINE
// ========================================

const EventState = Object.freeze({
    NEW: 'NEW',
    ACTIVE: 'ACTIVE',
    ACKNOWLEDGED: 'ACKNOWLEDGED',
    CLEARED: 'CLEARED'
});

class RiskEvent {
    constructor({ eventId, eventType, targetId, severity, timestamp }) {
        this.eventId = eventId;
        this.eventType = eventType;
        this.targetId = targetId;
        this.createdTime = timestamp;
        this.updatedTime = timestamp;
        this.state = EventState.NEW;
        this.severity = severity;
        this.lastSpeechTime = null;
        this.acknowledgedTime = null;
        this.clearedTime = null;
    }

    toJSON() {
        return {
            eventId: this.eventId,
            eventType: this.eventType,
            targetId: this.targetId,
            createdTime: this.createdTime,
            updatedTime: this.updatedTime,
            state: this.state,
            severity: this.severity,
            lastSpeechTime: this.lastSpeechTime,
            acknowledgedTime: this.acknowledgedTime,
            clearedTime: this.clearedTime
        };
    }
}

class EventStateMachine {
    constructor({ activeSpeechInterval = 10000, maxHistorySize = 1000 } = {}) {
        this.activeSpeechInterval = activeSpeechInterval;
        this.maxHistorySize = maxHistorySize;
        this.activeEvents = new Map();
        this.eventHistory = [];
        this.speechMetadata = new Map();
        this.sequence = 0;
    }

    createEventId(eventType, targetId, now) {
        this.sequence += 1;
        const safeType = String(eventType).replace(/[^a-zA-Z0-9_-]/g, '-');
        const safeTarget = String(targetId).replace(/[^a-zA-Z0-9_-]/g, '-');
        return `${safeType}-${safeTarget}-${now}-${this.sequence}`;
    }

    getEventKey(eventType, targetId) {
        return `${eventType}::${targetId}`;
    }

    observe({ eventType, targetId, severity, speechMessage, speechPriority = 'high' }) {
        const now = Date.now();
        const timestamp = new Date(now).toISOString();
        const key = this.getEventKey(eventType, targetId);
        let event = this.activeEvents.get(key);

        if (!event) {
            event = new RiskEvent({
                eventId: this.createEventId(eventType, targetId, now),
                eventType,
                targetId,
                severity,
                timestamp
            });
            this.activeEvents.set(key, event);
            this.eventHistory.push(event);
            this.trimHistory();
            this.speechMetadata.set(event.eventId, {
                message: speechMessage,
                priority: speechPriority
            });
            return {
                event,
                didSpeak: this.speakForEvent(event, now)
            };
        }

        event.updatedTime = timestamp;
        event.severity = severity;
        this.speechMetadata.set(event.eventId, {
            message: speechMessage,
            priority: speechPriority
        });

        if (event.state === EventState.NEW) {
            event.state = EventState.ACTIVE;
        }

        let didSpeak = false;
        if (
            event.state === EventState.ACTIVE &&
            now - this.getTimestamp(event.lastSpeechTime) >= this.activeSpeechInterval
        ) {
            didSpeak = this.speakForEvent(event, now);
        }

        return { event, didSpeak };
    }

    acknowledge(eventId) {
        const event = this.eventHistory.find(item => item.eventId === eventId);
        if (!event || event.state === EventState.CLEARED) return null;

        const timestamp = new Date().toISOString();
        event.state = EventState.ACKNOWLEDGED;
        event.updatedTime = timestamp;
        event.acknowledgedTime = timestamp;

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        return event;
    }

    clear(eventType, targetId) {
        const key = this.getEventKey(eventType, targetId);
        const event = this.activeEvents.get(key);
        if (!event) return null;

        const timestamp = new Date().toISOString();
        event.state = EventState.CLEARED;
        event.updatedTime = timestamp;
        event.clearedTime = timestamp;
        this.activeEvents.delete(key);
        this.speechMetadata.delete(event.eventId);
        this.trimHistory();
        return event;
    }

    trimHistory() {
        while (this.eventHistory.length > this.maxHistorySize) {
            const removableIndex = this.eventHistory.findIndex(event => {
                const key = this.getEventKey(event.eventType, event.targetId);
                return this.activeEvents.get(key) !== event;
            });

            if (removableIndex === -1) {
                break;
            }

            this.eventHistory.splice(removableIndex, 1);
        }
    }

    clearUnobserved(eventType, observedTargetIds) {
        const targets = new Set(observedTargetIds);
        Array.from(this.activeEvents.values()).forEach(event => {
            if (event.eventType === eventType && !targets.has(event.targetId)) {
                this.clear(event.eventType, event.targetId);
            }
        });
    }

    clearAll() {
        Array.from(this.activeEvents.values()).forEach(event => {
            this.clear(event.eventType, event.targetId);
        });
    }

    speakForEvent(event, now) {
        if (event.state === EventState.ACKNOWLEDGED || event.state === EventState.CLEARED) {
            return false;
        }

        const speech = this.speechMetadata.get(event.eventId);
        if (!speech || !speech.message) return false;

        speak(speech.message, speech.priority);
        event.lastSpeechTime = new Date(now).toISOString();
        return true;
    }

    getTimestamp(timestamp) {
        if (!timestamp) return 0;
        const value = Date.parse(timestamp);
        return Number.isNaN(value) ? 0 : value;
    }

    toJSON() {
        return this.eventHistory.map(event => event.toJSON());
    }
}

const riskEventStateMachine = new EventStateMachine({
    activeSpeechInterval: 10000,
    maxHistorySize: 1000
});

function acknowledgeRiskEvent(eventId) {
    return riskEventStateMachine.acknowledge(eventId);
}

function getActiveRiskEvents() {
    return Array.from(riskEventStateMachine.activeEvents.values())
        .filter(event => event.state !== EventState.CLEARED)
        .map(event => event.toJSON());
}

function getRiskEventHistory() {
    return riskEventStateMachine.toJSON();
}

function getRiskEvents() {
    return getRiskEventHistory();
}

// ========================================
// DIGITAL TWIN ANIMATION SYSTEM
// ========================================

// Global Animation State
const animationState = {
    forklifts: [],
    running: false,
    intervalId: null,
    labelsVisible: true
};

// Initialize Full Digital Twin with Animation
function initializeFullDigitalTwin() {
    const layout = document.getElementById('dtLayout');
    if (!layout) return;
    
    // Draw 4 aisles
    const aisles = [
        {x: 100, y: 50, w: 800, h: 100, color: '#3b82f6', label: 'Aisle-A'},
        {x: 100, y: 180, w: 800, h: 100, color: '#10b981', label: 'Aisle-B'},
        {x: 100, y: 310, w: 800, h: 100, color: '#f59e0b', label: 'Aisle-C'},
        {x: 100, y: 440, w: 800, h: 100, color: '#8b5cf6', label: 'Aisle-D'}
    ];
    
    aisles.forEach(aisle => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <rect x="${aisle.x}" y="${aisle.y}" width="${aisle.w}" height="${aisle.h}" 
                  fill="${aisle.color}15" stroke="${aisle.color}" stroke-width="2" rx="5"/>
            <text x="${aisle.x + aisle.w/2}" y="${aisle.y + aisle.h/2}" 
                  text-anchor="middle" fill="${aisle.color}" font-size="18" font-weight="600" class="dt-label">${aisle.label}</text>
        `;
        layout.appendChild(g);
    });
    
    // Add sensors with interactive elements
    const sensorsGroup = document.getElementById('dtSensors');
    
    // CCTV with coverage
    const cctvs = [
        {x:150,y:30},{x:500,y:30},{x:850,y:30},
        {x:150,y:560},{x:500,y:560},{x:850,y:560},
        {x:50,y:300},{x:950,y:300}
    ];
    cctvs.forEach((c, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'sensor-interactive');
        g.innerHTML = `
            <circle cx="${c.x}" cy="${c.y}" r="20" fill="#2196F330" stroke="#2196F3" stroke-width="1" stroke-dasharray="3,2">
                <animate attributeName="r" values="20;25;20" dur="2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.3;0.1;0.3" dur="2s" repeatCount="indefinite"/>
            </circle>
            <circle cx="${c.x}" cy="${c.y}" r="8" fill="#2196F3" stroke="#fff" stroke-width="2" style="cursor:pointer;"/>
            <text x="${c.x}" y="${c.y-12}" text-anchor="middle" fill="#2196F3" font-size="10" class="dt-label">CCTV-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // LiDAR with scanning animation
    const lidars = [
        {x:300,y:100},{x:500,y:100},{x:700,y:100},
        {x:300,y:380},{x:500,y:380},{x:700,y:380}
    ];
    lidars.forEach((l, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'sensor-interactive');
        g.innerHTML = `
            <circle cx="${l.x}" cy="${l.y}" r="30" fill="none" stroke="#FF9800" stroke-width="1" stroke-dasharray="5,5">
                <animateTransform attributeName="transform" type="rotate" from="0 ${l.x} ${l.y}" 
                    to="360 ${l.x} ${l.y}" dur="3s" repeatCount="indefinite"/>
            </circle>
            <circle cx="${l.x}" cy="${l.y}" r="6" fill="#FF9800" stroke="#fff" stroke-width="2" style="cursor:pointer;"/>
            <text x="${l.x}" y="${l.y+20}" text-anchor="middle" fill="#FF9800" font-size="10" class="dt-label">LIDAR-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // UWB with signal waves
    const uwbs = [
        {x:100,y:50},{x:500,y:50},{x:900,y:50},
        {x:100,y:550},{x:500,y:550},{x:900,y:550}
    ];
    uwbs.forEach((u, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'sensor-interactive');
        g.innerHTML = `
            <circle cx="${u.x}" cy="${u.y}" r="15" fill="none" stroke="#9C27B0" stroke-width="1" opacity="0.5">
                <animate attributeName="r" values="15;25;35" dur="2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.5;0.2;0" dur="2s" repeatCount="indefinite"/>
            </circle>
            <polygon points="${u.x},${u.y-6} ${u.x-5},${u.y+6} ${u.x+5},${u.y+6}" 
                fill="#9C27B0" stroke="#fff" stroke-width="2" style="cursor:pointer;"/>
            <text x="${u.x}" y="${u.y+20}" text-anchor="middle" fill="#9C27B0" font-size="10" class="dt-label">UWB-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // Initialize animated forklifts
    initializeAnimatedForklifts();
    
    // Start animation
    startAnimation();
}

// Initialize Animated Forklifts
function initializeAnimatedForklifts() {
    animationState.forklifts = [
        {id:'F-07', x:200, y:100, direction:0, speed:1.5, color:'#4CAF50', 
         prevSpeed:1.5, accel:0, gyro:0, tilt:0, lastAccelTime:Date.now()},
        {id:'F-12', x:600, y:100, direction:180, speed:1.2, color:'#4CAF50',
         prevSpeed:1.2, accel:0, gyro:0, tilt:0, lastAccelTime:Date.now()},
        {id:'F-03', x:400, y:230, direction:90, speed:1.0, color:'#4CAF50',
         prevSpeed:1.0, accel:0, gyro:0, tilt:0, lastAccelTime:Date.now()},
        {id:'F-15', x:750, y:360, direction:270, speed:1.3, color:'#4CAF50',
         prevSpeed:1.3, accel:0, gyro:0, tilt:0, lastAccelTime:Date.now()}
    ];
    
    const forkliftsGroup = document.getElementById('dtForklifts');
    forkliftsGroup.innerHTML = ''; // Clear existing
    
    animationState.forklifts.forEach(f => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('id', `forklift-${f.id}`);
        g.setAttribute('class', 'forklift-animated');
        g.setAttribute('transform', `translate(${f.x}, ${f.y}) rotate(${f.direction})`);
        
        // Forklift body with trail effect
        g.innerHTML = `
            <ellipse cx="0" cy="0" rx="25" ry="15" fill="${f.color}20" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1s" repeatCount="indefinite"/>
            </ellipse>
            <rect x="-12" y="-8" width="24" height="16" fill="${f.color}" stroke="#fff" stroke-width="2" rx="3"/>
            <polygon points="12,0 17,3 17,-3" fill="#FFF" opacity="0.8"/>
            <text x="0" y="-18" text-anchor="middle" fill="${f.color}" font-size="12" 
                font-weight="600" class="dt-label">${f.id}</text>
        `;
        forkliftsGroup.appendChild(g);
        f.element = g;
    });
}

// Start Animation
function startAnimation() {
    if (animationState.running) return;
    
    animationState.running = true;
    animationState.intervalId = setInterval(() => {
        moveForklifts();
    }, 50); // 50ms = ~20 FPS
}

// Stop Animation
function stopAnimation() {
    if (animationState.intervalId) {
        clearInterval(animationState.intervalId);
        animationState.intervalId = null;
        animationState.running = false;
    }
}

// Move Forklifts
function moveForklifts() {
    animationState.forklifts.forEach(f => {
        // Calculate movement
        const radians = (f.direction * Math.PI) / 180;
        const dx = Math.cos(radians) * f.speed;
        const dy = Math.sin(radians) * f.speed;
        
        f.x += dx;
        f.y += dy;
        
        // Boundary check and bounce
        if (f.x < 100 || f.x > 900) {
            f.direction = 180 - f.direction;
            f.x = Math.max(100, Math.min(900, f.x));
        }
        if (f.y < 50 || f.y > 550) {
            f.direction = 360 - f.direction;
            f.y = Math.max(50, Math.min(550, f.y));
        }
        
        // Random direction changes
        if (Math.random() < 0.01) {
            f.direction += (Math.random() > 0.5 ? 90 : -90);
            f.direction = (f.direction + 360) % 360;
        }
        
        // Update SVG
        if (f.element) {
            f.element.setAttribute('transform', 
                `translate(${f.x}, ${f.y}) rotate(${f.direction})`);
        }
    });
    
    // Update IMU data
    updateIMUData();
    
    // Check for collisions and show warnings
    detectCollisions();
}

// Detect Collisions
function detectCollisions() {
    const observedCollisions = new Set();

    for (let i = 0; i < animationState.forklifts.length; i++) {
        for (let j = i + 1; j < animationState.forklifts.length; j++) {
            const f1 = animationState.forklifts[i];
            const f2 = animationState.forklifts[j];
            
            const distance = Math.sqrt(
                Math.pow(f1.x - f2.x, 2) + Math.pow(f1.y - f2.y, 2)
            );
            
            // Show danger zone and voice warning
            if (distance < 80) {
                const collisionTargetId = getCollisionTargetId(f1.id, f2.id);
                observedCollisions.add(collisionTargetId);
                showDangerZone(f1, f2, distance);
                // Automatic voice warning
                speakCollisionWarning(f1, f2);
            }
        }
    }
    riskEventStateMachine.clearUnobserved('COLLISION_RISK', observedCollisions);
    
    // Check pedestrian proximity
    const pedestrian = document.getElementById('pedestrian-P02');
    const observedPedestrianRisks = new Set();
    if (pedestrian) {
        animationState.forklifts.forEach(f => {
            const dist = Math.sqrt(Math.pow(f.x - 520, 2) + Math.pow(f.y - 230, 2));
            if (dist < 100) {
                observedPedestrianRisks.add(f.id);
                speakPedestrianWarning(f.id);
            }
        });
    }
    riskEventStateMachine.clearUnobserved('PEDESTRIAN_PROXIMITY', observedPedestrianRisks);
    
    // Check speed violations in pedestrian zone
    const observedSpeedRisks = new Set();
    animationState.forklifts.forEach(f => {
        if (f.x >= 50 && f.x <= 150 && f.y >= 250 && f.y <= 350 && f.speed > 2.0) {
            observedSpeedRisks.add(f.id);
            speakSpeedWarning(f.id, '보행자 구역');
        }
    });
    riskEventStateMachine.clearUnobserved('SPEED_VIOLATION', observedSpeedRisks);
}

// Show Danger Zone
function showDangerZone(f1, f2, distance) {
    const svg = document.getElementById('digitalTwinSvg');
    const existingZone = document.getElementById('danger-zone');
    
    if (existingZone) {
        existingZone.remove();
    }
    
    const midX = (f1.x + f2.x) / 2;
    const midY = (f1.y + f2.y) / 2;
    
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'danger-zone');
    g.innerHTML = `
        <circle cx="${midX}" cy="${midY}" r="50" fill="#ff000020" stroke="#ff0000" stroke-width="2">
            <animate attributeName="opacity" values="0.5;0.2;0.5" dur="0.5s" repeatCount="indefinite"/>
        </circle>
        <text x="${midX}" y="${midY}" text-anchor="middle" fill="#ff0000" font-size="14" font-weight="bold">⚠ 충돌 위험</text>
    `;
    svg.appendChild(g);
    
    // Remove after 2 seconds
    setTimeout(() => {
        const zone = document.getElementById('danger-zone');
        if (zone) zone.remove();
    }, 2000);
}

// Reset Digital Twin View
function resetDigitalTwinView() {
    // Reset forklift positions
    stopAnimation();
    riskEventStateMachine.clearAll();
    initializeAnimatedForklifts();
    startAnimation();
}

// Toggle Digital Twin Labels
function toggleDigitalTwinLabels() {
    animationState.labelsVisible = !animationState.labelsVisible;
    const labels = document.querySelectorAll('.dt-label');
    labels.forEach(label => {
        label.style.display = animationState.labelsVisible ? 'block' : 'none';
    });
}

// ========================================
// DEMO SCENARIO SIMULATIONS
// ========================================

// Scenario 1: Collision Risk
function triggerScenario1() {
    console.log('🔴 Triggering Scenario 1: Collision Risk');
    
    stopAnimation();
    
    // Position F-07 and F-12 for collision
    const f07 = animationState.forklifts.find(f => f.id === 'F-07');
    const f12 = animationState.forklifts.find(f => f.id === 'F-12');
    
    if (f07 && f12) {
        f07.x = 450;
        f07.y = 90;
        f07.direction = 0; // Right
        f07.speed = 2.5; // Fast
        
        f12.x = 500;
        f12.y = 30;
        f12.direction = 90; // Down
        f12.speed = 2.5; // Fast
    }
    
    // Voice announcement
    speakScenarioStart(1, '충돌 위험');
    
    // Show notification
    const content = document.getElementById('dashboardContent');
    const notification = document.createElement('div');
    notification.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);background:#ff0000;color:#fff;padding:20px 40px;border-radius:10px;font-size:18px;font-weight:bold;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:slideDown 0.5s ease;';
    notification.innerHTML = '🔴 시나리오 1: 충돌 위험 시뮬레이션 시작!';
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
    
    startAnimation();
}

// Scenario 2: Pedestrian Proximity
function triggerScenario2() {
    console.log('🟠 Triggering Scenario 2: Pedestrian Proximity');
    
    stopAnimation();
    
    // Add pedestrian
    const svg = document.getElementById('dtForklifts');
    const existingPed = document.getElementById('pedestrian-P02');
    if (existingPed) existingPed.remove();
    
    const pedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    pedGroup.setAttribute('id', 'pedestrian-P02');
    pedGroup.innerHTML = `
        <circle cx="520" cy="230" r="10" fill="#FF6B6B" stroke="#fff" stroke-width="2"/>
        <text x="520" y="215" text-anchor="middle" fill="#FF6B6B" font-size="10" font-weight="bold">작업자</text>
    `;
    svg.appendChild(pedGroup);
    
    // Position F-03 approaching pedestrian
    const f03 = animationState.forklifts.find(f => f.id === 'F-03');
    if (f03) {
        f03.x = 400;
        f03.y = 230;
        f03.direction = 0; // Right toward pedestrian
        f03.speed = 2.0;
    }
    
    // Voice announcement
    speakScenarioStart(2, '보행자 근접 경고');
    
    // Show notification
    const notification = document.createElement('div');
    notification.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);background:#FF9800;color:#fff;padding:20px 40px;border-radius:10px;font-size:18px;font-weight:bold;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    notification.innerHTML = '🟠 시나리오 2: 보행자 근접 시뮬레이션 시작!';
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
    
    startAnimation();
}

// Scenario 3: Speed Violation
function triggerScenario3() {
    console.log('🟡 Triggering Scenario 3: Speed Violation');
    
    stopAnimation();
    
    // Highlight pedestrian zone
    const layout = document.getElementById('dtLayout');
    const existingZone = document.getElementById('ped-zone-highlight');
    if (existingZone) existingZone.remove();
    
    const zoneHighlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    zoneHighlight.setAttribute('id', 'ped-zone-highlight');
    zoneHighlight.setAttribute('x', '50');
    zoneHighlight.setAttribute('y', '250');
    zoneHighlight.setAttribute('width', '100');
    zoneHighlight.setAttribute('height', '100');
    zoneHighlight.setAttribute('fill', '#4CAF5030');
    zoneHighlight.setAttribute('stroke', '#4CAF50');
    zoneHighlight.setAttribute('stroke-width', '3');
    zoneHighlight.setAttribute('stroke-dasharray', '10,5');
    layout.appendChild(zoneHighlight);
    
    // Position F-15 entering zone at high speed
    const f15 = animationState.forklifts.find(f => f.id === 'F-15');
    if (f15) {
        f15.x = 30;
        f15.y = 300;
        f15.direction = 0; // Right into zone
        f15.speed = 3.0; // Very fast
        f15.color = '#FF9800'; // Change color to orange
    }
    
    // Voice announcement
    speakScenarioStart(3, '과속 감지');
    
    // Show notification
    const notification = document.createElement('div');
    notification.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);background:#FFC107;color:#000;padding:20px 40px;border-radius:10px;font-size:18px;font-weight:bold;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    notification.innerHTML = '🟡 시나리오 3: 과속 감지 시뮬레이션 시작!';
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
    
    startAnimation();
}

// ========================================
// VOICE RECOGNITION SYSTEM
// ========================================

// Global Voice Recognition State
let voiceRecognition = null;
let isVoiceActive = false;

// Initialize Voice Recognition
function initializeVoiceRecognition() {
    // Check browser support
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.error('Speech Recognition not supported in this browser');
        document.getElementById('startVoiceBtn').disabled = true;
        document.getElementById('startVoiceBtn').textContent = '❌ 브라우저 미지원';
        return;
    }
    
    // Create Speech Recognition instance
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    voiceRecognition = new SpeechRecognition();
    
    // Configure recognition
    voiceRecognition.lang = 'ko-KR';
    voiceRecognition.continuous = true;
    voiceRecognition.interimResults = true;
    voiceRecognition.maxAlternatives = 1;
    
    // Event handlers
    voiceRecognition.onstart = onVoiceStart;
    voiceRecognition.onresult = onVoiceResult;
    voiceRecognition.onerror = onVoiceError;
    voiceRecognition.onend = onVoiceEnd;
}

// Start Voice Recognition
function startVoiceRecognition() {
    if (!voiceRecognition) {
        alert('음성 인식이 지원되지 않는 브라우저입니다.');
        return;
    }
    
    try {
        voiceRecognition.start();
        isVoiceActive = true;
        
        // Update UI
        document.getElementById('startVoiceBtn').disabled = true;
        document.getElementById('stopVoiceBtn').disabled = false;
        updateVoiceStatus('listening', '🎤 듣는 중...');
        
        // Clear transcript
        const transcriptBox = document.getElementById('transcriptBox');
        transcriptBox.innerHTML = '<div class="transcript-active">음성을 인식하고 있습니다...</div>';
        
    } catch (error) {
        console.error('Failed to start voice recognition:', error);
        alert('음성 인식을 시작할 수 없습니다: ' + error.message);
    }
}

// Stop Voice Recognition
function stopVoiceRecognition() {
    if (voiceRecognition && isVoiceActive) {
        voiceRecognition.stop();
        isVoiceActive = false;
        
        // Update UI
        document.getElementById('startVoiceBtn').disabled = false;
        document.getElementById('stopVoiceBtn').disabled = true;
        updateVoiceStatus('ready', '준비');
    }
}

// Voice Recognition Event Handlers
function onVoiceStart() {
    console.log('🎤 Voice recognition started');
    updateVoiceStatus('listening', '🎤 듣는 중...');
}

function onVoiceResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
        } else {
            interimTranscript += transcript;
        }
    }
    
    // Update transcript box
    const transcriptBox = document.getElementById('transcriptBox');
    transcriptBox.innerHTML = `
        <div class="transcript-final">${finalTranscript}</div>
        <div class="transcript-interim">${interimTranscript}</div>
    `;
    
    // Process final transcript
    if (finalTranscript) {
        processVoiceCommand(finalTranscript.trim());
    }
}

function onVoiceError(event) {
    console.error('Voice recognition error:', event.error);
    
    let errorMsg = '알 수 없는 오류';
    switch (event.error) {
        case 'no-speech':
            errorMsg = '음성이 감지되지 않았습니다';
            break;
        case 'audio-capture':
            errorMsg = '마이크를 찾을 수 없습니다';
            break;
        case 'not-allowed':
            errorMsg = '마이크 권한이 거부되었습니다';
            break;
        case 'network':
            errorMsg = '네트워크 오류';
            break;
    }
    
    updateVoiceStatus('error', '❌ ' + errorMsg);
    
    // Auto-restart if it wasn't a permission issue
    if (event.error !== 'not-allowed' && isVoiceActive) {
        setTimeout(() => {
            if (isVoiceActive) {
                voiceRecognition.start();
            }
        }, 1000);
    }
}

function onVoiceEnd() {
    console.log('🎤 Voice recognition ended');
    
    if (isVoiceActive) {
        // Auto-restart if still active
        setTimeout(() => {
            if (isVoiceActive) {
                voiceRecognition.start();
            }
        }, 300);
    } else {
        updateVoiceStatus('ready', '준비');
    }
}

// Update Voice Status UI
function updateVoiceStatus(state, text) {
    const statusEl = document.getElementById('voiceStatus');
    if (!statusEl) return;
    
    const statusDot = statusEl.querySelector('.status-dot');
    const statusText = statusEl.querySelector('.status-text');
    
    statusDot.className = 'status-dot';
    statusDot.classList.add('status-' + state);
    statusText.textContent = text;
}

// Process Voice Command
function processVoiceCommand(command) {
    console.log('🎤 Voice command:', command);
    
    const commandLower = command.toLowerCase();
    
    // Add to command history
    addCommandToHistory(command);
    
    // Command matching
    if (commandLower.includes('정지') || commandLower.includes('멈춰')) {
        handleStopCommand(command);
    } else if (commandLower.includes('시나리오 1') || commandLower.includes('시나리오 일')) {
        triggerScenario1();
        showNotificationPopup('✅ 시나리오 1 실행', 'success');
    } else if (commandLower.includes('시나리오 2') || commandLower.includes('시나리오 이')) {
        triggerScenario2();
        showNotificationPopup('✅ 시나리오 2 실행', 'success');
    } else if (commandLower.includes('시나리오 3') || commandLower.includes('시나리오 삼')) {
        triggerScenario3();
        showNotificationPopup('✅ 시나리오 3 실행', 'success');
    } else if (commandLower.includes('리셋') || commandLower.includes('초기화')) {
        resetDigitalTwinView();
        showNotificationPopup('✅ 시스템 초기화 완료', 'success');
    } else if (commandLower.includes('지도') || commandLower.includes('디지털 트윈')) {
        showDigitalTwin();
        showNotificationPopup('✅ 디지털 트윈으로 이동', 'success');
    } else if (commandLower.includes('센서')) {
        showSensorType('all');
        showNotificationPopup('✅ 센서 모니터링으로 이동', 'success');
    } else if (commandLower.includes('위험') || commandLower.includes('경고')) {
        showRiskEvents();
        showNotificationPopup('⚠️ 위험 알림 활성화', 'warning');
    } else {
        showNotificationPopup('❓ 알 수 없는 명령: ' + command, 'info');
    }
}

// Handle Stop Command
function handleStopCommand(command) {
    // Extract forklift ID if specified
    const match = command.match(/F-?\d+/i);
    
    if (match) {
        const forkliftId = match[0].toUpperCase();
        const forklift = animationState.forklifts.find(f => f.id === forkliftId);
        
        if (forklift) {
            forklift.speed = 0;
            forklift.status = 'stopped';
            
            const forkliftName = formatForkliftIdForSpeech(forkliftId);
            showNotificationPopup(`✅ ${forkliftId} 정지 명령 실행`, 'success');
            speak(`${forkliftName} 정지 명령을 실행합니다`, 'high');
        } else {
            showNotificationPopup(`❌ ${forkliftId}를 찾을 수 없습니다`, 'error');
        }
    } else {
        // Stop all forklifts
        animationState.forklifts.forEach(f => {
            f.speed = 0;
            f.status = 'stopped';
        });
        showNotificationPopup('✅ 모든 지게차 정지 명령 실행', 'success');
        speak('모든 지게차 정지 명령을 실행합니다', 'high');
    }
}

// Add Command to History
function addCommandToHistory(command) {
    const historyEl = document.getElementById('commandHistory');
    if (!historyEl) return;
    
    const now = new Date();
    const timeStr = '방금 전';
    
    const commandItem = document.createElement('div');
    commandItem.className = 'command-item';
    commandItem.innerHTML = `
        <div class="command-header">
            <span class="command-icon">🎤</span>
            <span class="command-target">음성 명령 → 시스템</span>
            <span class="command-time">${timeStr}</span>
        </div>
        <div class="command-body">
            "${command}"
        </div>
        <div class="command-status delivered">✓ 실행 완료</div>
    `;
    
    // Add to top of history
    historyEl.insertBefore(commandItem, historyEl.firstChild);
    
    // Keep only last 10 commands
    while (historyEl.children.length > 10) {
        historyEl.removeChild(historyEl.lastChild);
    }
}

// Show Notification Popup
function showNotificationPopup(message, type = 'info') {
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.info};
        color: #fff;
        padding: 15px 30px;
        border-radius: 10px;
        font-size: 16px;
        font-weight: 600;
        z-index: 9999;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        animation: slideDown 0.5s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
}

// ========================================
// TEXT-TO-SPEECH (TTS) SYSTEM
// ========================================

// Global TTS State
const ttsState = {
    enabled: true
};

// Initialize TTS
function initializeTTS() {
    if (!('speechSynthesis' in window)) {
        console.error('Text-to-Speech not supported in this browser');
        return false;
    }
    return true;
}

// Speak Text
function speak(text, priority = 'normal') {
    if (!ttsState.enabled || !window.speechSynthesis) return;
    
    // Cancel previous utterances if high priority
    if (priority === 'high') {
        window.speechSynthesis.cancel();
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    // Adjust voice settings based on priority
    if (priority === 'high') {
        utterance.volume = 1.0;
        utterance.rate = 1.2; // Faster for urgent messages
    } else {
        utterance.volume = 0.8;
    }
    
    console.log('🔊 TTS:', text);
    window.speechSynthesis.speak(utterance);
}

// Convert Forklift ID to natural speech
function formatForkliftIdForSpeech(id) {
    // Convert "F-07" to "에프공칠"
    // Convert "F-12" to "에프일이"
    
    const match = id.match(/F-?(\d+)/i);
    if (!match) return id;
    
    const number = match[1];
    const digits = {
        '0': '공',
        '1': '일',
        '2': '이',
        '3': '삼',
        '4': '사',
        '5': '오',
        '6': '육',
        '7': '칠',
        '8': '팔',
        '9': '구'
    };
    
    let spokenNumber = '';
    for (let digit of number) {
        spokenNumber += digits[digit] || digit;
    }
    
    return `에프${spokenNumber}`;
}

function getCollisionTargetId(forkliftId1, forkliftId2) {
    return [forkliftId1, forkliftId2].sort().join('|');
}

// Collision Warning Voice
function speakCollisionWarning(forklift1, forklift2) {
    const f1Name = formatForkliftIdForSpeech(forklift1.id);
    const f2Name = formatForkliftIdForSpeech(forklift2.id);
    const message = `경고! ${f1Name}과 ${f2Name} 충돌 위험! 속도를 줄이세요!`;
    const result = riskEventStateMachine.observe({
        eventType: 'COLLISION_RISK',
        targetId: getCollisionTargetId(forklift1.id, forklift2.id),
        severity: 'HIGH',
        speechMessage: message,
        speechPriority: 'high'
    });
    return result.didSpeak;
}

// Pedestrian Warning Voice
function speakPedestrianWarning(forkliftId) {
    const forkliftName = formatForkliftIdForSpeech(forkliftId);
    const message = `${forkliftName} 정지! 보행자 접근 중입니다!`;
    const result = riskEventStateMachine.observe({
        eventType: 'PEDESTRIAN_PROXIMITY',
        targetId: forkliftId,
        severity: 'CRITICAL',
        speechMessage: message,
        speechPriority: 'high'
    });
    return result.didSpeak;
}

// Speed Violation Warning Voice
function speakSpeedWarning(forkliftId, zone) {
    const forkliftName = formatForkliftIdForSpeech(forkliftId);
    const message = `${forkliftName} 과속! ${zone} 구역에서 속도를 줄이세요!`;
    const result = riskEventStateMachine.observe({
        eventType: 'SPEED_VIOLATION',
        targetId: forkliftId,
        severity: 'HIGH',
        speechMessage: message,
        speechPriority: 'high'
    });
    return result.didSpeak;
}

// Scenario Announcement
function speakScenarioStart(scenarioNum, description) {
    const message = `시나리오 ${scenarioNum} 시작. ${description}`;
    speak(message, 'normal');
}

// System Status
function speakSystemStatus(status) {
    speak(status, 'normal');
}

// Toggle TTS
function toggleTTS() {
    ttsState.enabled = !ttsState.enabled;
    const status = ttsState.enabled ? '음성 알림 활성화' : '음성 알림 비활성화';
    console.log(status);
    
    // Update button appearance
    const btn = document.getElementById('ttsToggleBtn');
    if (btn) {
        if (ttsState.enabled) {
            btn.classList.remove('disabled');
            btn.innerHTML = '🔊 음성 알림';
        } else {
            btn.classList.add('disabled');
            btn.innerHTML = '🔇 음성 알림';
        }
    }
    
    showNotificationPopup(status, 'info');
    
    if (ttsState.enabled) {
        speak('음성 알림이 활성화되었습니다');
    }
}

// Initialize TTS on load
document.addEventListener('DOMContentLoaded', function() {
    initializeTTS();
});

// ========================================
// IMU SENSOR SYSTEM
// ========================================

// IMU Detection Thresholds
const IMU_THRESHOLDS = {
    TILT_WARNING: 15      // ° - 기울기 경고
};

let imuObservationSequence = 0;
const accelerationTestStates = new Map();
const ACCELERATION_TEST_DURATION_MS = 300;
const ACCELERATION_TEST_VALUE_MPS2 = 3.5;
const brakingTestStates = new Map();
const BRAKING_TEST_DURATION_MS = 300;
const BRAKING_TEST_VALUE_MPS2 = -3.5;
const turnRateTestStates = new Map();
const TURN_RATE_TEST_DURATION_MS = 300;
const TURN_RATE_TEST_VALUE_DPS = 60;
const TURN_RATE_TEST_MINIMUM_SPEED = 1.2;

// Update IMU Data for Forklifts
function updateIMUData() {
    const now = Date.now();
    
    animationState.forklifts.forEach(f => {
        // Calculate acceleration (change in speed)
        const deltaTime = (now - f.lastAccelTime) / 1000; // seconds
        const deltaSpeed = f.speed - f.prevSpeed;
        f.accel = deltaSpeed / (deltaTime || 0.05); // m/s²

        const accelerationTestState = accelerationTestStates.get(f.id);
        if (accelerationTestState) {
            const elapsedMs = now - accelerationTestState.startedAt;
            f.accel = elapsedMs < ACCELERATION_TEST_DURATION_MS
                ? ACCELERATION_TEST_VALUE_MPS2
                : 0;
        }

        const brakingTestState = brakingTestStates.get(f.id);
        if (brakingTestState) {
            const elapsedMs = now - brakingTestState.startedAt;
            f.accel = elapsedMs < BRAKING_TEST_DURATION_MS
                ? BRAKING_TEST_VALUE_MPS2
                : 0;
        }
        
        // Update previous values
        f.prevSpeed = f.speed;
        f.lastAccelTime = now;
        
        calculateTurnRate(f, now);
        
        // Simulate tilt based on speed (higher speed = more tilt in turns)
        f.tilt = Math.min(Math.abs(f.speed) * 2, 20);
        
        const tiltObservation = createTiltObservation(f, now);
        const accelerationObservation = createAccelerationObservation(f, now);
        const brakingObservation = createBrakingObservation(f, now);
        const turnRateObservation = createTurnRateObservation(f, now);
        f.gyro = turnRateObservation.value;

        // Detect anomalies
        detectIMUAnomalies(
            f,
            tiltObservation,
            accelerationObservation,
            brakingObservation,
            turnRateObservation
        );
    });
}

function calculateTurnRate(forklift, observedAtMs = Date.now()) {
    const currentDirection = Number(forklift.direction);
    const previousDirection = Number(forklift.previousDirection);
    const previousTimestamp = Number(forklift.previousTurnTimestamp);

    forklift.turnRatePreviousDirection = Number.isFinite(previousDirection)
        ? previousDirection
        : currentDirection;

    if (
        !Number.isFinite(currentDirection) ||
        !Number.isFinite(previousDirection) ||
        !Number.isFinite(previousTimestamp)
    ) {
        forklift.calculatedTurnRate = 0;
    } else {
        const elapsedSeconds = (observedAtMs - previousTimestamp) / 1000;
        const rawDelta = currentDirection - previousDirection;
        const normalizedDelta = ((rawDelta + 540) % 360) - 180;
        forklift.calculatedTurnRate = elapsedSeconds >= 0.001
            ? normalizedDelta / elapsedSeconds
            : 0;
    }

    forklift.previousDirection = currentDirection;
    forklift.previousTurnTimestamp = observedAtMs;
    return forklift.calculatedTurnRate;
}

function createTiltObservation(forklift, observedAtMs = Date.now()) {
    imuObservationSequence += 1;
    const imuSensor = sensorData.imu.find(sensor => sensor.forklift === forklift.id);

    return new SensorObservation({
        observationId: `tilt-${forklift.id}-${observedAtMs}-${imuObservationSequence}`,
        observationType: ObservationType.TILT,
        sensorId: imuSensor ? imuSensor.id : `imu-sim-${forklift.id}`,
        targetId: forklift.id,
        value: forklift.tilt,
        unit: 'degree',
        confidence: 1,
        observedAt: new Date(observedAtMs).toISOString(),
        metadata: { source: 'imu-simulation' }
    });
}

function createAccelerationObservation(forklift, observedAtMs = Date.now()) {
    imuObservationSequence += 1;
    const imuSensor = sensorData.imu.find(sensor => sensor.forklift === forklift.id);

    return new SensorObservation({
        observationId: `acceleration-${forklift.id}-${observedAtMs}-${imuObservationSequence}`,
        observationType: ObservationType.ACCELERATION,
        sensorId: imuSensor ? imuSensor.id : `imu-sim-${forklift.id}`,
        targetId: forklift.id,
        value: forklift.accel,
        unit: 'm/s²',
        confidence: 1,
        observedAt: new Date(observedAtMs).toISOString(),
        metadata: { source: 'imu-simulation' }
    });
}

function createBrakingObservation(forklift, observedAtMs = Date.now()) {
    imuObservationSequence += 1;
    const imuSensor = sensorData.imu.find(sensor => sensor.forklift === forklift.id);

    return new SensorObservation({
        observationId: `braking-${forklift.id}-${observedAtMs}-${imuObservationSequence}`,
        observationType: ObservationType.BRAKING,
        sensorId: imuSensor ? imuSensor.id : `imu-sim-${forklift.id}`,
        targetId: forklift.id,
        value: forklift.accel,
        unit: 'm/s²',
        confidence: 1,
        observedAt: new Date(observedAtMs).toISOString(),
        metadata: { source: 'imu-simulation' }
    });
}

function createTurnRateObservation(forklift, observedAtMs = Date.now()) {
    imuObservationSequence += 1;
    const imuSensor = sensorData.imu.find(sensor => sensor.forklift === forklift.id);
    const testState = turnRateTestStates.get(forklift.id);
    const testElapsedMs = testState ? observedAtMs - testState.startedAt : 0;
    const turnRate = testState
        ? (testElapsedMs < TURN_RATE_TEST_DURATION_MS ? TURN_RATE_TEST_VALUE_DPS : 0)
        : forklift.calculatedTurnRate;
    const evaluationSpeed = testState && forklift.speed < TURN_RATE_RISK_RULE.MINIMUM_SPEED
        ? TURN_RATE_TEST_MINIMUM_SPEED
        : forklift.speed;
    const turnDirection = turnRate > 0 ? 'RIGHT' : turnRate < 0 ? 'LEFT' : 'STRAIGHT';

    return new SensorObservation({
        observationId: `turn-rate-${forklift.id}-${observedAtMs}-${imuObservationSequence}`,
        observationType: ObservationType.TURN_RATE,
        sensorId: imuSensor ? imuSensor.id : `imu-sim-${forklift.id}`,
        targetId: forklift.id,
        value: turnRate,
        unit: 'degree/second',
        confidence: 1,
        observedAt: new Date(observedAtMs).toISOString(),
        metadata: {
            source: 'imu-simulation',
            speed: evaluationSpeed,
            direction: forklift.direction,
            previousDirection: forklift.turnRatePreviousDirection,
            turnDirection
        }
    });
}

// Detect IMU Anomalies
function detectIMUAnomalies(
    forklift,
    tiltObservation,
    accelerationObservation,
    brakingObservation,
    turnRateObservation
) {
    // Hard Acceleration Observation
    const accelerationRiskSignal = observationToRiskSignal(accelerationObservation);
    if (accelerationRiskSignal.shouldCreateRisk) {
        const result = handleHardAcceleration(forklift, accelerationRiskSignal.eventInput);
        notifyAccelerationTestActive(forklift.id, result);
    } else if (accelerationRiskSignal.shouldClearRisk) {
        const clearedEvent = riskEventStateMachine.clear('HARD_ACCELERATION', forklift.id);
        finishAccelerationTest(forklift.id, clearedEvent);
    }
    
    // Hard Braking Observation
    const brakingRiskSignal = observationToRiskSignal(brakingObservation);
    if (brakingRiskSignal.shouldCreateRisk) {
        const result = handleHardBraking(forklift, brakingRiskSignal.eventInput);
        notifyBrakingTestActive(forklift.id, result);
    } else if (brakingRiskSignal.shouldClearRisk) {
        const clearedEvent = riskEventStateMachine.clear('HARD_BRAKING', forklift.id);
        finishBrakingTest(forklift.id, clearedEvent);
    }
    
    // Sharp Turn Observation
    const turnRateRiskSignal = observationToRiskSignal(turnRateObservation);
    if (turnRateRiskSignal.shouldCreateRisk) {
        const result = handleSharpTurn(forklift, turnRateRiskSignal.eventInput);
        notifyTurnRateTestActive(forklift.id, result);
    } else if (turnRateRiskSignal.shouldClearRisk) {
        const clearedEvent = riskEventStateMachine.clear('SHARP_TURN', forklift.id);
        finishTurnRateTest(forklift.id, clearedEvent);
    }
    
    // Dangerous Tilt Observation
    const tiltRiskSignal = observationToRiskSignal(tiltObservation);
    if (tiltRiskSignal.shouldCreateRisk) {
        handleDangerousTilt(forklift, tiltRiskSignal.eventInput);
    } else if (tiltRiskSignal.shouldClearRisk) {
        riskEventStateMachine.clear('DANGEROUS_TILT', forklift.id);
    }
}

// Handle Hard Acceleration
function handleHardAcceleration(forklift, eventInput = {}) {
    const name = formatForkliftIdForSpeech(forklift.id);
    const result = riskEventStateMachine.observe({
        eventType: eventInput.eventType || 'HARD_ACCELERATION',
        targetId: eventInput.targetId || forklift.id,
        severity: eventInput.severity || 'MEDIUM',
        speechMessage: `${name} 급가속 감지! 속도를 조절하세요!`,
        speechPriority: 'high'
    });
    if (result.didSpeak) {
        showWarningIndicator(forklift, '⚡ 급가속', '#FF9800');
    }
    return result;
}

function triggerAccelerationTest() {
    const forklift = animationState.forklifts.find(item => item.id === 'F-07');
    if (!forklift) {
        showNotificationPopup('급가속 테스트 대상 F-07을 찾을 수 없습니다.', 'error');
        return;
    }

    if (accelerationTestStates.has(forklift.id)) {
        showNotificationPopup('급가속 테스트가 이미 실행 중입니다.', 'warning');
        return;
    }

    accelerationTestStates.set(forklift.id, {
        startedAt: Date.now(),
        activeNotified: false
    });
    showNotificationPopup('F-07 급가속 테스트 시작 (3.5m/s², 300ms)', 'info');
    startAnimation();
}

function notifyAccelerationTestActive(targetId, result) {
    const testState = accelerationTestStates.get(targetId);
    if (!testState || testState.activeNotified || !result || result.event.state !== EventState.ACTIVE) {
        return;
    }

    testState.activeNotified = true;
    showNotificationPopup(`HARD_ACCELERATION ACTIVE · ${result.event.eventId}`, 'warning');
}

function finishAccelerationTest(targetId, clearedEvent) {
    if (!accelerationTestStates.has(targetId) || !clearedEvent) return;

    accelerationTestStates.delete(targetId);
    showNotificationPopup(`HARD_ACCELERATION CLEARED · ${clearedEvent.eventId}`, 'success');
}

function triggerBrakingTest() {
    const forklift = animationState.forklifts.find(item => item.id === 'F-07');
    if (!forklift) {
        showNotificationPopup('급제동 테스트 대상 F-07을 찾을 수 없습니다.', 'error');
        return;
    }

    startBrakingTest(forklift, true);
}

function startBrakingTest(forklift, showStartNotification) {
    if (brakingTestStates.has(forklift.id)) {
        if (showStartNotification) {
            showNotificationPopup('급제동 테스트가 이미 실행 중입니다.', 'warning');
        }
        return false;
    }

    brakingTestStates.set(forklift.id, {
        startedAt: Date.now(),
        activeNotified: false
    });
    if (showStartNotification) {
        showNotificationPopup('F-07 급제동 테스트 시작 (-3.5m/s², 300ms)', 'info');
    }
    startAnimation();
    return true;
}

function notifyBrakingTestActive(targetId, result) {
    const testState = brakingTestStates.get(targetId);
    if (!testState || testState.activeNotified || !result || result.event.state !== EventState.ACTIVE) {
        return;
    }

    testState.activeNotified = true;
    showNotificationPopup(`HARD_BRAKING ACTIVE · ${result.event.eventId}`, 'warning');
}

function finishBrakingTest(targetId, clearedEvent) {
    if (!brakingTestStates.has(targetId) || !clearedEvent) return;

    brakingTestStates.delete(targetId);
    showNotificationPopup(`HARD_BRAKING CLEARED · ${clearedEvent.eventId}`, 'success');
}

// Handle Hard Braking
function handleHardBraking(forklift, eventInput = {}) {
    const name = formatForkliftIdForSpeech(forklift.id);
    const result = riskEventStateMachine.observe({
        eventType: eventInput.eventType || 'HARD_BRAKING',
        targetId: eventInput.targetId || forklift.id,
        severity: eventInput.severity || 'HIGH',
        speechMessage: `${name} 급브레이크! 충격 감지!`,
        speechPriority: 'high'
    });
    if (result.didSpeak) {
        showWarningIndicator(forklift, '🛑 급정지', '#ef4444');
    }
    return result;
}

function triggerTurnRateTest() {
    const forklift = animationState.forklifts.find(item => item.id === 'F-12');
    if (!forklift) {
        showNotificationPopup('급회전 테스트 대상 F-12를 찾을 수 없습니다.', 'error');
        return;
    }

    if (turnRateTestStates.has(forklift.id)) {
        showNotificationPopup('급회전 테스트가 이미 실행 중입니다.', 'warning');
        return;
    }

    turnRateTestStates.set(forklift.id, {
        startedAt: Date.now(),
        activeNotified: false
    });
    showNotificationPopup('F-12 급회전 테스트 시작 (+60°/s, 300ms)', 'info');
    startAnimation();
}

function notifyTurnRateTestActive(targetId, result) {
    const testState = turnRateTestStates.get(targetId);
    if (!testState || testState.activeNotified || !result || result.event.state !== EventState.ACTIVE) {
        return;
    }

    testState.activeNotified = true;
    showNotificationPopup(`SHARP_TURN ACTIVE · ${result.event.eventId}`, 'warning');
}

function finishTurnRateTest(targetId, clearedEvent) {
    if (!turnRateTestStates.has(targetId) || !clearedEvent) return;

    turnRateTestStates.delete(targetId);
    showNotificationPopup(`SHARP_TURN CLEARED · ${clearedEvent.eventId}`, 'success');
}

// Handle Sharp Turn
function handleSharpTurn(forklift, eventInput = {}) {
    const name = formatForkliftIdForSpeech(forklift.id);
    const result = riskEventStateMachine.observe({
        eventType: eventInput.eventType || 'SHARP_TURN',
        targetId: eventInput.targetId || forklift.id,
        severity: eventInput.severity || 'MEDIUM',
        speechMessage: `${name} 급회전 주의!`,
        speechPriority: 'normal'
    });
    if (result.didSpeak) {
        showWarningIndicator(forklift, '🔄 급회전', '#3b82f6');
    }
    return result;
}

// Handle Dangerous Tilt
function handleDangerousTilt(forklift, eventInput = {}) {
    const name = formatForkliftIdForSpeech(forklift.id);
    const result = riskEventStateMachine.observe({
        eventType: eventInput.eventType || 'DANGEROUS_TILT',
        targetId: eventInput.targetId || forklift.id,
        severity: eventInput.severity || 'HIGH',
        speechMessage: `${name} 기울기 위험! 과적재 확인하세요!`,
        speechPriority: 'high'
    });
    if (!result.didSpeak) return;
    showWarningIndicator(forklift, '⚠️ 기울기 위험', '#f59e0b');
}

// Show Warning Indicator on Map
function showWarningIndicator(forklift, message, color) {
    const svg = document.getElementById('digitalTwinSvg');
    if (!svg) return;
    
    const indicatorId = `warning-${forklift.id}`;
    const existing = document.getElementById(indicatorId);
    if (existing) existing.remove();
    
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', indicatorId);
    g.innerHTML = `
        <circle cx="${forklift.x}" cy="${forklift.y - 30}" r="20" fill="${color}40" stroke="${color}" stroke-width="2">
            <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1s" repeatCount="indefinite"/>
        </circle>
        <text x="${forklift.x}" y="${forklift.y - 27}" text-anchor="middle" 
              fill="${color}" font-size="10" font-weight="bold">${message}</text>
    `;
    svg.appendChild(g);
    
    // Remove after 3 seconds
    setTimeout(() => {
        const ind = document.getElementById(indicatorId);
        if (ind) ind.remove();
    }, 3000);
}

// Trigger Scenario 4: Emergency Braking (IMU Detection)
function triggerScenario4() {
    console.log('🟣 Triggering Scenario 4: Emergency Braking (IMU)');
    
    stopAnimation();
    
    // Position F-07 at high speed
    const f07 = animationState.forklifts.find(f => f.id === 'F-07');
    if (f07) {
        f07.x = 300;
        f07.y = 100;
        f07.direction = 0;
        f07.speed = 3.5; // Very high speed
        f07.prevSpeed = 3.5;
    }
    
    // Add obstacle
    const svg = document.getElementById('dtForklifts');
    const existingObs = document.getElementById('obstacle-01');
    if (existingObs) existingObs.remove();
    
    const obsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    obsGroup.setAttribute('id', 'obstacle-01');
    obsGroup.innerHTML = `
        <rect x="550" y="85" width="30" height="30" fill="#ef4444" stroke="#fff" stroke-width="2" rx="3"/>
        <text x="565" y="105" text-anchor="middle" fill="#fff" font-size="16" font-weight="bold">⚠</text>
    `;
    svg.appendChild(obsGroup);
    
    // Voice announcement
    speakScenarioStart(4, '급정지 위험. IMU 센서 작동');
    
    // Show notification
    const notification = document.createElement('div');
    notification.style.cssText = 'position:fixed;top:100px;left:50%;transform:translateX(-50%);background:#9C27B0;color:#fff;padding:20px 40px;border-radius:10px;font-size:18px;font-weight:bold;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.3);';
    notification.innerHTML = '🟣 시나리오 4: 급정지 위험 (IMU) 시뮬레이션 시작!';
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
    
    // After 2 seconds, trigger emergency braking
    setTimeout(() => {
        if (f07) {
            f07.speed = 0; // Emergency stop
            startBrakingTest(f07, false);
        }
    }, 2000);
    
    startAnimation();
}
