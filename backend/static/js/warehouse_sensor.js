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
        <div class="dashboard-grid-fullmap">
            <!-- Full Width Warehouse Map -->
            <div class="warehouse-map-full">
                <div class="panel-header-inline">
                    <h3>🗺️ 물류센터 실시간 지도</h3>
                    <div class="map-controls">
                        <button class="btn-control" onclick="resetDigitalTwinView()">🔄 뷰 리셋</button>
                        <button class="btn-control" onclick="toggleDigitalTwinLabels()">🏷️ 라벨</button>
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
                    <div class="legend-item"><span class="legend-dot" style="background:#4CAF50;"></span> 지게차 (4)</div>
                </div>
            </div>
        </div>
    `;
    
    // Initialize the digital twin map
    setTimeout(() => {
        initializeFullDigitalTwin();
    }, 100);
}

// Initialize Full Digital Twin
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
                  text-anchor="middle" fill="${aisle.color}" font-size="18" font-weight="600">${aisle.label}</text>
        `;
        layout.appendChild(g);
    });
    
    // Add sensors
    const sensorsGroup = document.getElementById('dtSensors');
    
    // CCTV
    const cctvs = [
        {x:150,y:30},{x:500,y:30},{x:850,y:30},
        {x:150,y:560},{x:500,y:560},{x:850,y:560},
        {x:50,y:300},{x:950,y:300}
    ];
    cctvs.forEach((c, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <circle cx="${c.x}" cy="${c.y}" r="8" fill="#2196F3" stroke="#fff" stroke-width="2"/>
            <text x="${c.x}" y="${c.y-12}" text-anchor="middle" fill="#2196F3" font-size="10" class="dt-label">CCTV-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // LiDAR
    const lidars = [
        {x:300,y:100},{x:500,y:100},{x:700,y:100},
        {x:300,y:380},{x:500,y:380},{x:700,y:380}
    ];
    lidars.forEach((l, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <circle cx="${l.x}" cy="${l.y}" r="6" fill="#FF9800" stroke="#fff" stroke-width="2"/>
            <text x="${l.x}" y="${l.y+20}" text-anchor="middle" fill="#FF9800" font-size="10" class="dt-label">LIDAR-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // UWB
    const uwbs = [
        {x:100,y:50},{x:500,y:50},{x:900,y:50},
        {x:100,y:550},{x:500,y:550},{x:900,y:550}
    ];
    uwbs.forEach((u, i) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <polygon points="${u.x},${u.y-6} ${u.x-5},${u.y+6} ${u.x+5},${u.y+6}" fill="#9C27B0" stroke="#fff" stroke-width="2"/>
            <text x="${u.x}" y="${u.y+20}" text-anchor="middle" fill="#9C27B0" font-size="10" class="dt-label">UWB-0${i+1}</text>
        `;
        sensorsGroup.appendChild(g);
    });
    
    // Add forklifts
    const forkliftsGroup = document.getElementById('dtForklifts');
    const forklifts = [
        {x:200,y:100,id:'F-07'},{x:600,y:100,id:'F-12'},
        {x:400,y:230,id:'F-03'},{x:750,y:360,id:'F-15'}
    ];
    forklifts.forEach(f => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.innerHTML = `
            <rect x="${f.x-12}" y="${f.y-8}" width="24" height="16" fill="#4CAF50" stroke="#fff" stroke-width="2" rx="3"/>
            <text x="${f.x}" y="${f.y-15}" text-anchor="middle" fill="#4CAF50" font-size="12" font-weight="600">${f.id}</text>
        `;
        forkliftsGroup.appendChild(g);
    });
}

// Reset Digital Twin View
function resetDigitalTwinView() {
    const svg = document.getElementById('digitalTwinSvg');
    if (svg) {
        svg.setAttribute('viewBox', '0 0 1000 600');
    }
}

// Toggle Digital Twin Labels
let dtLabelsVisible = true;
function toggleDigitalTwinLabels() {
    dtLabelsVisible = !dtLabelsVisible;
    const labels = document.querySelectorAll('.dt-label');
    labels.forEach(label => {
        label.style.display = dtLabelsVisible ? 'block' : 'none';
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
