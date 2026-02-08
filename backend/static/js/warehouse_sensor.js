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
                <h3>🚛 Traffic Control</h3>
                <p>실시간 지게차 위치 추적 및 경로 모니터링</p>
            </div>
            <div class="info-section">
                <h3>⚠️ Collision Detection</h3>
                <p>AI 기반 충돌 위험 예측 및 실시간 경고</p>
            </div>
            <div class="info-section">
                <h3>🔊 Voice Commands</h3>
                <p>실시간 음성 명령 시스템</p>
                <ul class="feature-list">
                    <li>정지/감속 지시</li>
                    <li>보행자 경고</li>
                    <li>구역 제한 알림</li>
                </ul>
            </div>
            <div class="info-section">
                <h3>⚠️ Human-in-the-loop</h3>
                <p>시스템은 조언만 제공하고, 최종 결정은 운전자가 합니다.</p>
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
        sensors = [...sensorData.cctv, ...sensorData.lidar, ...sensorData.uwb];
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
    }
    
    return html;
}

// Show Digital Twin
function showDigitalTwin() {
    document.getElementById('pageTitle').innerHTML = '🗺️ 디지털 트윈';
    document.getElementById('pageSubtitle').textContent = '실시간 물류센터 지도';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="digital-twin-container">
            <div class="twin-map">
                <p style="text-align:center; padding-top:250px; color:rgba(255,255,255,0.5);">
                    디지털 트윈 지도 (개발 중...)
                </p>
            </div>
        </div>
    `;
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
        <div class="system-info-box">
            <p style="text-align:center; color:rgba(255,255,255,0.5);">
                지게차 추적 화면 (개발 중...)
            </p>
        </div>
    `;
}

// Show Risk Events
function showRiskEvents() {
    document.getElementById('pageTitle').innerHTML = '⚠️ 위험 이벤트';
    document.getElementById('pageSubtitle').textContent = '오늘 12건 감지';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="system-info-box">
            <p style="text-align:center; color:rgba(255,255,255,0.5);">
                이벤트 로그 (개발 중...)
            </p>
        </div>
    `;
}

// Show Voice Commands
function showVoiceCommands() {
    document.getElementById('pageTitle').innerHTML = '🔊 음성 명령 이력';
    document.getElementById('pageSubtitle').textContent = '오늘 28건 발령';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="system-info-box">
            <p style="text-align:center; color:rgba(255,255,255,0.5);">
                음성 명령 로그 (개발 중...)
            </p>
        </div>
    `;
}

// Update Clock
function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('ko-KR');
}
