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
                <h3>🚛 실시간 지게차 추적</h3>
                <p>AI 기반 충돌 위험 예측 및 실시간 위치 모니터링</p>
            </div>
            <div class="info-section">
                <h3>🔊 3채널 음성 명령</h3>
                <p>지게차 스피커 • 구역 스피커 • 웨어러블 기기</p>
            </div>
            <div class="info-section">
                <h3>📡 센서 융합</h3>
                <p>CCTV 8대 • LiDAR 6대 • UWB 6대 통합 모니터링</p>
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
            <div class="twin-controls">
                <button class="control-btn" onclick="resetTwinView()">🔄 뷰 리셋</button>
                <button class="control-btn" onclick="toggleTwinLabels()">🏷️ 라벨 토글</button>
            </div>
            <div class="twin-map" id="twinMap">
                <svg id="warehouseSvg" viewBox="0 0 1000 600" style="width:100%; height:100%; background:#0a0e1a;">
                    <!-- Grid Pattern -->
                    <defs>
                        <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
                        </pattern>
                    </defs>
                    <rect width="1000" height="600" fill="url(#grid)" />
                    
                    <!-- Warehouse Layout -->
                    <g id="warehouseLayout">
                        <!-- Aisle A -->
                        <rect x="100" y="50" width="800" height="80" fill="rgba(59, 130, 246, 0.1)" stroke="#3b82f6" stroke-width="2" rx="5"/>
                        <text x="500" y="95" text-anchor="middle" fill="#3b82f6" font-size="16" font-weight="600">Aisle-A</text>
                        
                        <!-- Aisle B -->
                        <rect x="100" y="180" width="800" height="80" fill="rgba(16, 185, 129, 0.1)" stroke="#10b981" stroke-width="2" rx="5"/>
                        <text x="500" y="225" text-anchor="middle" fill="#10b981" font-size="16" font-weight="600">Aisle-B</text>
                        
                        <!-- Aisle C -->
                        <rect x="100" y="310" width="800" height="80" fill="rgba(245, 158, 11, 0.1)" stroke="#f59e0b" stroke-width="2" rx="5"/>
                        <text x="500" y="355" text-anchor="middle" fill="#f59e0b" font-size="16" font-weight="600">Aisle-C</text>
                        
                        <!-- Aisle D -->
                        <rect x="100" y="440" width="800" height="80" fill="rgba(139, 92, 246, 0.1)" stroke="#8b5cf6" stroke-width="2" rx="5"/>
                        <text x="500" y="485" text-anchor="middle" fill="#8b5cf6" font-size="16" font-weight="600">Aisle-D</text>
                    </g>
                    
                    <!-- Forklifts -->
                    <g id="forklifts"></g>
                    
                    <!-- Sensors -->
                    <g id="sensors"></g>
                </svg>
            </div>
            <div class="twin-legend">
                <div class="legend-item">
                    <span class="legend-color" style="background:#3b82f6;"></span>
                    <span>CCTV (8)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background:#ff9800;"></span>
                    <span>LiDAR (6)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background:#9c27b0;"></span>
                    <span>UWB (6)</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background:#4caf50;"></span>
                    <span>지게차 (4)</span>
                </div>
            </div>
        </div>
    `;
    
    // Initialize digital twin
    initializeDigitalTwin();
}

// Initialize Digital Twin
function initializeDigitalTwin() {
    // Add CCTV sensors
    const cctvPositions = [
        {x: 150, y: 30, label: 'CCTV-01'},
        {x: 500, y: 30, label: 'CCTV-02'},
        {x: 850, y: 30, label: 'CCTV-03'},
        {x: 150, y: 560, label: 'CCTV-04'},
        {x: 500, y: 560, label: 'CCTV-05'},
        {x: 850, y: 560, label: 'CCTV-06'},
        {x: 50, y: 300, label: 'CCTV-07'},
        {x: 950, y: 300, label: 'CCTV-08'}
    ];
    
    const sensorsGroup = document.getElementById('sensors');
    
    cctvPositions.forEach(cctv => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <circle cx="${cctv.x}" cy="${cctv.y}" r="8" fill="#2196F3" stroke="#fff" stroke-width="2"/>
            <circle cx="${cctv.x+5}" cy="${cctv.y-5}" r="3" fill="#4CAF50" class="pulse"/>
            <text x="${cctv.x}" y="${cctv.y-15}" text-anchor="middle" fill="#2196F3" font-size="10" class="sensor-label">${cctv.label}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // Add LiDAR sensors
    const lidarPositions = [
        {x: 300, y: 130, label: 'LiDAR-01'},
        {x: 500, y: 130, label: 'LiDAR-02'},
        {x: 700, y: 130, label: 'LiDAR-03'},
        {x: 300, y: 390, label: 'LiDAR-04'},
        {x: 500, y: 390, label: 'LiDAR-05'},
        {x: 700, y: 390, label: 'LiDAR-06'}
    ];
    
    lidarPositions.forEach(lidar => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <circle cx="${lidar.x}" cy="${lidar.y}" r="6" fill="#FF9800" stroke="#fff" stroke-width="2"/>
            <text x="${lidar.x}" y="${lidar.y+20}" text-anchor="middle" fill="#FF9800" font-size="10" class="sensor-label">${lidar.label}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // Add UWB gateways
    const uwbPositions = [
        {x: 100, y: 50, label: 'UWB-01'},
        {x: 500, y: 50, label: 'UWB-02'},
        {x: 900, y: 50, label: 'UWB-03'},
        {x: 100, y: 550, label: 'UWB-04'},
        {x: 500, y: 550, label: 'UWB-05'},
        {x: 900, y: 550, label: 'UWB-06'}
    ];
    
    uwbPositions.forEach(uwb => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <polygon points="${uwb.x},${uwb.y-6} ${uwb.x-5},${uwb.y+6} ${uwb.x+5},${uwb.y+6}" fill="#9C27B0" stroke="#fff" stroke-width="2"/>
            <text x="${uwb.x}" y="${uwb.y+20}" text-anchor="middle" fill="#9C27B0" font-size="10" class="sensor-label">${uwb.label}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // Add forklifts
    const forkliftPositions = [
        {x: 200, y: 90, label: 'F-07'},
        {x: 600, y: 90, label: 'F-12'},
        {x: 400, y: 220, label: 'F-03'},
        {x: 750, y: 350, label: 'F-15'}
    ];
    
    const forkliftsGroup = document.getElementById('forklifts');
    
    forkliftPositions.forEach(forklift => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <rect x="${forklift.x-10}" y="${forklift.y-6}" width="20" height="12" fill="#4CAF50" stroke="#fff" stroke-width="2" rx="2"/>
            <polygon points="${forklift.x+10},${forklift.y} ${forklift.x+15},${forklift.y-3} ${forklift.x+15},${forklift.y+3}" fill="#66BB6A"/>
            <text x="${forklift.x}" y="${forklift.y-12}" text-anchor="middle" fill="#4CAF50" font-size="11" font-weight="600">${forklift.label}</text>
        `;
        forkliftsGroup.appendChild(g);
    });
}

// Reset Twin View
function resetTwinView() {
    const svg = document.getElementById('warehouseSvg');
    if (svg) {
        svg.setAttribute('viewBox', '0 0 1000 600');
    }
}

// Toggle Twin Labels
let labelsVisible = true;
function toggleTwinLabels() {
    labelsVisible = !labelsVisible;
    const labels = document.querySelectorAll('.sensor-label');
    labels.forEach(label => {
        label.style.display = labelsVisible ? 'block' : 'none';
    });
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
    document.getElementById('pageTitle').innerHTML = '🔊 음성 명령 이력';
    document.getElementById('pageSubtitle').textContent = '오늘 28건 발령';
    
    const content = document.getElementById('dashboardContent');
    content.innerHTML = `
        <div class="commands-container">
            <div class="command-item">
                <div class="command-header">
                    <span class="command-icon">🔊</span>
                    <span class="command-target">F-07 → 지게차 스피커</span>
                    <span class="command-time">5분 전</span>
                </div>
                <div class="command-body">
                    "정지하세요! 보행자 접근 중"
                </div>
                <div class="command-status delivered">✓ 전달 완료</div>
            </div>
            
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
    `;
}

// Update Clock
function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('ko-KR');
}
