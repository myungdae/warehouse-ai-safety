// Warehouse Digital Twin - Real-time Traffic Control System
// This system demonstrates Decision Support, not autonomous control

// Configuration
const CONFIG = {
    updateInterval: 1000, // Update every second
    warehouseWidth: 1000,
    warehouseHeight: 600,
    forkliftSpeed: 2, // pixels per update
    collisionThreshold: 50, // pixels
    dangerZoneRadius: 80,
    warningZoneRadius: 120
};

// Global State
const state = {
    forklifts: [],
    pedestrians: [],
    zones: [],
    sensors: {
        cctv: [],
        lidar: [],
        uwb: []
    },
    events: [],
    commands: [],
    stats: {
        activeForklift: 0,
        pedestrianCount: 0,
        todayIncidents: 0,
        preventedCollisions: 0
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('🏭 Warehouse Digital Twin System Starting...');
    initializeWarehouse();
    initializeSensors();
    initializeForklifts();
    initializePedestrians();
    startSimulation();
    updateClock();
    setInterval(updateClock, 1000);
});

// Initialize Warehouse Layout
function initializeWarehouse() {
    const svg = document.getElementById('warehouseLayout');
    
    // Draw aisles
    const aisles = [
        { x: 100, y: 50, width: 800, height: 80, id: 'Aisle-A' },
        { x: 100, y: 180, width: 800, height: 80, id: 'Aisle-B' },
        { x: 100, y: 310, width: 800, height: 80, id: 'Aisle-C' },
        { x: 100, y: 440, width: 800, height: 80, id: 'Aisle-D' }
    ];
    
    aisles.forEach(aisle => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', aisle.x);
        rect.setAttribute('y', aisle.y);
        rect.setAttribute('width', aisle.width);
        rect.setAttribute('height', aisle.height);
        rect.setAttribute('class', 'warehouse-aisle');
        rect.setAttribute('id', aisle.id);
        svg.appendChild(rect);
        
        // Add label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', aisle.x + aisle.width / 2);
        text.setAttribute('y', aisle.y + aisle.height / 2);
        text.setAttribute('class', 'zone-label');
        text.textContent = aisle.id;
        svg.appendChild(text);
    });
    
    // Draw intersections (danger zones)
    const intersections = [
        { x: 300, y: 130, r: 40, id: 'X-1' },
        { x: 500, y: 130, r: 40, id: 'X-2' },
        { x: 700, y: 130, r: 40, id: 'X-3' },
        { x: 300, y: 390, r: 40, id: 'X-4' },
        { x: 500, y: 390, r: 40, id: 'X-5' },
        { x: 700, y: 390, r: 40, id: 'X-6' }
    ];
    
    intersections.forEach(inter => {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', inter.x);
        circle.setAttribute('cy', inter.y);
        circle.setAttribute('r', inter.r);
        circle.setAttribute('class', 'warehouse-intersection');
        circle.setAttribute('id', inter.id);
        svg.appendChild(circle);
        
        state.zones.push({
            id: inter.id,
            x: inter.x,
            y: inter.y,
            radius: inter.r,
            type: 'BlindCorner'
        });
    });
    
    // Draw pedestrian zones
    const pedZones = [
        { x: 50, y: 250, width: 40, height: 100, id: 'PedZone-1' }
    ];
    
    pedZones.forEach(zone => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', zone.x);
        rect.setAttribute('y', zone.y);
        rect.setAttribute('width', zone.width);
        rect.setAttribute('height', zone.height);
        rect.setAttribute('class', 'warehouse-zone');
        rect.setAttribute('fill', 'rgba(76, 175, 80, 0.2)');
        rect.setAttribute('id', zone.id);
        svg.appendChild(rect);
        
        state.zones.push({
            id: zone.id,
            x: zone.x,
            y: zone.y,
            width: zone.width,
            height: zone.height,
            type: 'PedestrianZone'
        });
    });
}

// Initialize Sensors (CCTV, LiDAR, UWB)
function initializeSensors() {
    console.log('📡 Initializing sensors...');
    
    const svg = document.getElementById('warehouseLayout');
    
    // ==========================================
    // CCTV Cameras
    // ==========================================
    const cctvs = [
        { id: 'CCTV-01', x: 150, y: 30, coverage: 150, direction: 135, zone: 'Aisle-A' },
        { id: 'CCTV-02', x: 500, y: 30, coverage: 150, direction: 135, zone: 'Intersection' },
        { id: 'CCTV-03', x: 850, y: 30, coverage: 150, direction: 225, zone: 'Aisle-A' },
        { id: 'CCTV-04', x: 150, y: 560, coverage: 150, direction: 45, zone: 'Aisle-D' },
        { id: 'CCTV-05', x: 500, y: 560, coverage: 150, direction: 45, zone: 'Intersection' },
        { id: 'CCTV-06', x: 850, y: 560, coverage: 150, direction: 315, zone: 'Aisle-D' },
        { id: 'CCTV-07', x: 50, y: 300, coverage: 100, direction: 0, zone: 'PedestrianZone' },
        { id: 'CCTV-08', x: 950, y: 300, coverage: 100, direction: 180, zone: 'Entrance' }
    ];
    
    cctvs.forEach(cctv => {
        // Create CCTV group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `cctv-${cctv.id}`);
        group.setAttribute('class', 'sensor-cctv');
        
        // Coverage cone (FOV)
        const cone = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const angle = 60; // FOV angle
        const startAngle = cctv.direction - angle / 2;
        const endAngle = cctv.direction + angle / 2;
        
        const startX = cctv.x + cctv.coverage * Math.cos((startAngle * Math.PI) / 180);
        const startY = cctv.y + cctv.coverage * Math.sin((startAngle * Math.PI) / 180);
        const endX = cctv.x + cctv.coverage * Math.cos((endAngle * Math.PI) / 180);
        const endY = cctv.y + cctv.coverage * Math.sin((endAngle * Math.PI) / 180);
        
        const pathData = `M ${cctv.x},${cctv.y} L ${startX},${startY} A ${cctv.coverage},${cctv.coverage} 0 0,1 ${endX},${endY} Z`;
        cone.setAttribute('d', pathData);
        cone.setAttribute('fill', 'rgba(33, 150, 243, 0.15)');
        cone.setAttribute('stroke', '#2196F3');
        cone.setAttribute('stroke-width', '1');
        cone.setAttribute('class', 'cctv-coverage');
        group.appendChild(cone);
        
        // Camera icon
        const camera = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        camera.setAttribute('cx', cctv.x);
        camera.setAttribute('cy', cctv.y);
        camera.setAttribute('r', 8);
        camera.setAttribute('fill', '#2196F3');
        camera.setAttribute('stroke', 'white');
        camera.setAttribute('stroke-width', '2');
        camera.setAttribute('class', 'cctv-icon');
        group.appendChild(camera);
        
        // Status indicator (blinking)
        const statusDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        statusDot.setAttribute('cx', cctv.x + 5);
        statusDot.setAttribute('cy', cctv.y - 5);
        statusDot.setAttribute('r', 3);
        statusDot.setAttribute('fill', '#4CAF50');
        statusDot.setAttribute('class', 'sensor-status-indicator');
        group.appendChild(statusDot);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', cctv.x);
        label.setAttribute('y', cctv.y - 15);
        label.setAttribute('class', 'sensor-label');
        label.setAttribute('fill', '#2196F3');
        label.textContent = cctv.id;
        group.appendChild(label);
        
        svg.appendChild(group);
        
        // Add to state
        cctv.element = group;
        cctv.status = 'active';
        cctv.type = 'vision';
        state.sensors.cctv.push(cctv);
    });
    
    // ==========================================
    // LiDAR Sensors (at intersections)
    // ==========================================
    const lidars = [
        { id: 'LIDAR-01', x: 300, y: 130, range: 30, intersection: 'X-1' },
        { id: 'LIDAR-02', x: 500, y: 130, range: 30, intersection: 'X-2' },
        { id: 'LIDAR-03', x: 700, y: 130, range: 30, intersection: 'X-3' },
        { id: 'LIDAR-04', x: 300, y: 390, range: 30, intersection: 'X-4' },
        { id: 'LIDAR-05', x: 500, y: 390, range: 30, intersection: 'X-5' },
        { id: 'LIDAR-06', x: 700, y: 390, range: 30, intersection: 'X-6' }
    ];
    
    lidars.forEach(lidar => {
        // Create LiDAR group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `lidar-${lidar.id}`);
        group.setAttribute('class', 'sensor-lidar');
        
        // Scanning circle (animated)
        const scanCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        scanCircle.setAttribute('cx', lidar.x);
        scanCircle.setAttribute('cy', lidar.y);
        scanCircle.setAttribute('r', lidar.range);
        scanCircle.setAttribute('fill', 'none');
        scanCircle.setAttribute('stroke', '#FF9800');
        scanCircle.setAttribute('stroke-width', '2');
        scanCircle.setAttribute('stroke-dasharray', '5,5');
        scanCircle.setAttribute('class', 'lidar-scan-circle');
        group.appendChild(scanCircle);
        
        // LiDAR icon (rotating square)
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        icon.setAttribute('x', lidar.x - 6);
        icon.setAttribute('y', lidar.y - 6);
        icon.setAttribute('width', 12);
        icon.setAttribute('height', 12);
        icon.setAttribute('fill', '#FF9800');
        icon.setAttribute('stroke', 'white');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('class', 'lidar-icon');
        group.appendChild(icon);
        
        // Status indicator
        const statusDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        statusDot.setAttribute('cx', lidar.x + 8);
        statusDot.setAttribute('cy', lidar.y - 8);
        statusDot.setAttribute('r', 3);
        statusDot.setAttribute('fill', '#4CAF50');
        statusDot.setAttribute('class', 'sensor-status-indicator');
        group.appendChild(statusDot);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', lidar.x);
        label.setAttribute('y', lidar.y + 25);
        label.setAttribute('class', 'sensor-label');
        label.setAttribute('fill', '#FF9800');
        label.textContent = lidar.id;
        group.appendChild(label);
        
        svg.appendChild(group);
        
        // Add to state
        lidar.element = group;
        lidar.status = 'active';
        lidar.type = 'distance';
        state.sensors.lidar.push(lidar);
    });
    
    // ==========================================
    // UWB/RTLS Coverage Indicators
    // ==========================================
    const uwbGateways = [
        { id: 'UWB-GW-01', x: 100, y: 50, coverage: 200 },
        { id: 'UWB-GW-02', x: 500, y: 50, coverage: 200 },
        { id: 'UWB-GW-03', x: 900, y: 50, coverage: 200 },
        { id: 'UWB-GW-04', x: 100, y: 550, coverage: 200 },
        { id: 'UWB-GW-05', x: 500, y: 550, coverage: 200 },
        { id: 'UWB-GW-06', x: 900, y: 550, coverage: 200 }
    ];
    
    uwbGateways.forEach(uwb => {
        // Create UWB group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `uwb-${uwb.id}`);
        group.setAttribute('class', 'sensor-uwb');
        
        // Coverage circle (very subtle)
        const coverage = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        coverage.setAttribute('cx', uwb.x);
        coverage.setAttribute('cy', uwb.y);
        coverage.setAttribute('r', uwb.coverage);
        coverage.setAttribute('fill', 'rgba(156, 39, 176, 0.05)');
        coverage.setAttribute('stroke', '#9C27B0');
        coverage.setAttribute('stroke-width', '1');
        coverage.setAttribute('stroke-dasharray', '3,3');
        coverage.setAttribute('class', 'uwb-coverage');
        group.appendChild(coverage);
        
        // Gateway icon (triangle)
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        icon.setAttribute('points', `${uwb.x},${uwb.y-6} ${uwb.x-6},${uwb.y+6} ${uwb.x+6},${uwb.y+6}`);
        icon.setAttribute('fill', '#9C27B0');
        icon.setAttribute('stroke', 'white');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('class', 'uwb-icon');
        group.appendChild(icon);
        
        // Status indicator
        const statusDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        statusDot.setAttribute('cx', uwb.x + 8);
        statusDot.setAttribute('cy', uwb.y - 8);
        statusDot.setAttribute('r', 3);
        statusDot.setAttribute('fill', '#4CAF50');
        statusDot.setAttribute('class', 'sensor-status-indicator');
        group.appendChild(statusDot);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', uwb.x);
        label.setAttribute('y', uwb.y + 20);
        label.setAttribute('class', 'sensor-label');
        label.setAttribute('fill', '#9C27B0');
        label.setAttribute('font-size', '9');
        label.textContent = uwb.id;
        group.appendChild(label);
        
        svg.appendChild(group);
        
        // Add to state
        uwb.element = group;
        uwb.status = 'active';
        uwb.type = 'position';
        state.sensors.uwb.push(uwb);
    });
    
    console.log(`✅ Sensors initialized: ${state.sensors.cctv.length} CCTV, ${state.sensors.lidar.length} LiDAR, ${state.sensors.uwb.length} UWB`);
}

// Initialize Forklifts
function initializeForklifts() {
    const forklifts = [
        { id: 'F-07', x: 200, y: 90, speed: 12, direction: 0, operator: 'Kim', status: 'moving' },
        { id: 'F-12', x: 600, y: 90, speed: 8, direction: 180, operator: 'Lee', status: 'moving' },
        { id: 'F-03', x: 400, y: 220, speed: 10, direction: 90, operator: 'Park', status: 'moving' },
        { id: 'F-15', x: 750, y: 350, speed: 6, direction: 270, operator: 'Choi', status: 'moving' }
    ];
    
    const svg = document.getElementById('forklifts');
    
    forklifts.forEach(forklift => {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `forklift-${forklift.id}`);
        group.setAttribute('class', 'forklift-marker');
        group.setAttribute('transform', `translate(${forklift.x}, ${forklift.y}) rotate(${forklift.direction})`);
        
        // Forklift body
        const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        body.setAttribute('x', -15);
        body.setAttribute('y', -10);
        body.setAttribute('width', 30);
        body.setAttribute('height', 20);
        body.setAttribute('rx', 3);
        body.setAttribute('class', 'forklift-body');
        group.appendChild(body);
        
        // Direction indicator
        const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        indicator.setAttribute('points', '15,0 20,5 20,-5');
        indicator.setAttribute('class', 'forklift-direction');
        group.appendChild(indicator);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', 0);
        label.setAttribute('y', -15);
        label.setAttribute('class', 'forklift-label');
        label.textContent = forklift.id;
        group.appendChild(label);
        
        svg.appendChild(group);
        
        // Add to state
        forklift.element = group;
        state.forklifts.push(forklift);
    });
    
    updateStats();
}

// Initialize Pedestrians
function initializePedestrians() {
    const pedestrians = [
        { id: 'P-01', x: 70, y: 300, name: 'Worker-A' },
        { id: 'P-02', x: 520, y: 420, name: 'Worker-B' }
    ];
    
    const svg = document.getElementById('pedestrians');
    
    pedestrians.forEach(ped => {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('id', `pedestrian-${ped.id}`);
        group.setAttribute('class', 'pedestrian-marker');
        
        // Pedestrian body
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', ped.x);
        circle.setAttribute('cy', ped.y);
        circle.setAttribute('r', 8);
        circle.setAttribute('class', 'pedestrian-body');
        group.appendChild(circle);
        
        // Label
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', ped.x);
        label.setAttribute('y', ped.y - 15);
        label.setAttribute('class', 'forklift-label');
        label.setAttribute('fill', '#388E3C');
        label.textContent = ped.id;
        group.appendChild(label);
        
        svg.appendChild(group);
        
        ped.element = group;
        state.pedestrians.push(ped);
    });
    
    updateStats();
}

// Start Real-time Simulation
function startSimulation() {
    console.log('▶️ Starting real-time simulation...');
    
    setInterval(() => {
        moveForklifts();
        detectCollisionRisks();
        updateVisualization();
    }, CONFIG.updateInterval);
}

// Move Forklifts
function moveForklifts() {
    state.forklifts.forEach(forklift => {
        if (forklift.status !== 'stopped') {
            // Calculate movement
            const radians = (forklift.direction * Math.PI) / 180;
            const dx = Math.cos(radians) * CONFIG.forkliftSpeed;
            const dy = Math.sin(radians) * CONFIG.forkliftSpeed;
            
            forklift.x += dx;
            forklift.y += dy;
            
            // Boundary check
            if (forklift.x < 50 || forklift.x > 950) {
                forklift.direction = 180 - forklift.direction;
            }
            if (forklift.y < 30 || forklift.y > 570) {
                forklift.direction = 360 - forklift.direction;
            }
            
            // Random direction changes (simulate real warehouse traffic)
            if (Math.random() < 0.02) {
                forklift.direction = (forklift.direction + (Math.random() > 0.5 ? 90 : -90)) % 360;
            }
            
            // Update SVG
            forklift.element.setAttribute('transform', 
                `translate(${forklift.x}, ${forklift.y}) rotate(${forklift.direction})`);
        }
    });
}

// Detect Collision Risks (SWRL-style reasoning)
function detectCollisionRisks() {
    const now = new Date();
    
    // Rule 1: Forklift-Forklift Collision Risk
    for (let i = 0; i < state.forklifts.length; i++) {
        for (let j = i + 1; j < state.forklifts.length; j++) {
            const f1 = state.forklifts[i];
            const f2 = state.forklifts[j];
            
            const distance = Math.sqrt(
                Math.pow(f1.x - f2.x, 2) + Math.pow(f1.y - f2.y, 2)
            );
            
            if (distance < CONFIG.collisionThreshold) {
                // HIGH RISK EVENT
                createRiskEvent({
                    level: 'HIGH',
                    type: 'ForkliftCollision',
                    entities: [f1.id, f2.id],
                    location: { x: (f1.x + f2.x) / 2, y: (f1.y + f2.y) / 2 },
                    distance: distance.toFixed(1)
                });
                
                // Generate DIRECTIVE voice command
                issueVoiceCommand({
                    type: 'DIRECTIVE',
                    target: f1.id,
                    command: '정지! 교차로 확인!',
                    reason: `${f2.id}와 충돌 위험 (거리: ${distance.toFixed(1)}m)`
                });
                
                issueVoiceCommand({
                    type: 'DIRECTIVE',
                    target: f2.id,
                    command: '정지! 교차로 확인!',
                    reason: `${f1.id}와 충돌 위험 (거리: ${distance.toFixed(1)}m)`
                });
                
                // Highlight risk area
                highlightRiskArea(f1.x, f1.y, f2.x, f2.y);
                
                // Update stats
                state.stats.preventedCollisions++;
                updateStats();
            }
        }
    }
    
    // Rule 2: Forklift-Pedestrian Proximity Risk
    state.forklifts.forEach(forklift => {
        state.pedestrians.forEach(ped => {
            const distance = Math.sqrt(
                Math.pow(forklift.x - ped.x, 2) + Math.pow(forklift.y - ped.y, 2)
            );
            
            if (distance < CONFIG.dangerZoneRadius && forklift.speed > 5) {
                // CRITICAL RISK EVENT
                createRiskEvent({
                    level: 'CRITICAL',
                    type: 'PedestrianProximity',
                    entities: [forklift.id, ped.id],
                    location: { x: forklift.x, y: forklift.y },
                    distance: distance.toFixed(1)
                });
                
                // Generate ENFORCEMENT command
                issueVoiceCommand({
                    type: 'ENFORCEMENT',
                    target: forklift.id,
                    command: '긴급정지! 보행자!',
                    reason: `보행자 ${ped.id} 근접 (거리: ${distance.toFixed(1)}m)`
                });
                
                // Temporarily stop forklift (simulate human response)
                forklift.status = 'stopped';
                setTimeout(() => {
                    forklift.status = 'moving';
                    forklift.speed = 3; // Slow down
                }, 3000);
                
                highlightRiskArea(forklift.x, forklift.y, ped.x, ped.y);
                
                state.stats.preventedCollisions++;
                updateStats();
            }
        });
    });
    
    // Rule 3: Speed Limit in Pedestrian Zone
    state.zones.filter(z => z.type === 'PedestrianZone').forEach(zone => {
        state.forklifts.forEach(forklift => {
            if (forklift.x > zone.x && forklift.x < zone.x + zone.width &&
                forklift.y > zone.y && forklift.y < zone.y + zone.height) {
                
                if (forklift.speed > 5) {
                    createRiskEvent({
                        level: 'MEDIUM',
                        type: 'SpeedViolation',
                        entities: [forklift.id],
                        location: { x: forklift.x, y: forklift.y },
                        zone: zone.id
                    });
                    
                    issueVoiceCommand({
                        type: 'DIRECTIVE',
                        target: forklift.id,
                        command: '감속! 보행자 구역!',
                        reason: `${zone.id} 속도 제한 5km/h`
                    });
                    
                    forklift.speed = 5;
                }
            }
        });
    });
}

// Create Risk Event
function createRiskEvent(event) {
    // Prevent duplicate events within 5 seconds
    const now = new Date().getTime();
    const recentEvent = state.events.find(e => 
        e.type === event.type && 
        JSON.stringify(e.entities) === JSON.stringify(event.entities) &&
        (now - e.timestamp) < 5000
    );
    
    if (recentEvent) return;
    
    event.id = `EVT-${Date.now()}`;
    event.timestamp = now;
    state.events.unshift(event);
    
    // Keep only last 20 events
    if (state.events.length > 20) {
        state.events.pop();
    }
    
    // Update UI
    updateEventsPanel();
    addActivity(`${event.level} 위험: ${event.type}`, event.level.toLowerCase());
    
    state.stats.todayIncidents++;
    updateStats();
}

// Issue Voice Command
function issueVoiceCommand(command) {
    // Prevent duplicate commands within 3 seconds
    const now = new Date().getTime();
    const recentCommand = state.commands.find(c => 
        c.target === command.target && 
        c.command === command.command &&
        (now - c.timestamp) < 3000
    );
    
    if (recentCommand) return;
    
    command.id = `CMD-${Date.now()}`;
    command.timestamp = now;
    state.commands.unshift(command);
    
    // Keep only last 15 commands
    if (state.commands.length > 15) {
        state.commands.pop();
    }
    
    // Update UI
    updateCommandsPanel();
    addActivity(`🔊 ${command.target}: ${command.command}`, 'warning');
    
    // 🔊 PLAY AUDIO - Text-to-Speech
    playVoiceCommand(command.target, command.command);
}

// Highlight Risk Area
function highlightRiskArea(x1, y1, x2, y2) {
    const svg = document.getElementById('riskAreas');
    
    // Remove old highlights
    svg.innerHTML = '';
    
    // Draw risk zone
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    const ellipse = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    ellipse.setAttribute('cx', midX);
    ellipse.setAttribute('cy', midY);
    ellipse.setAttribute('rx', CONFIG.dangerZoneRadius);
    ellipse.setAttribute('ry', CONFIG.dangerZoneRadius);
    ellipse.setAttribute('class', 'risk-highlight');
    svg.appendChild(ellipse);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        ellipse.remove();
    }, 3000);
}

// Update Events Panel
function updateEventsPanel() {
    const panel = document.getElementById('eventsList');
    panel.innerHTML = '';
    
    state.events.slice(0, 10).forEach(event => {
        const item = document.createElement('div');
        item.className = `event-item ${event.level.toLowerCase()}`;
        
        const header = document.createElement('div');
        header.className = 'event-header';
        header.innerHTML = `
            <span>${event.type}</span>
            <span>${new Date(event.timestamp).toLocaleTimeString()}</span>
        `;
        
        const desc = document.createElement('div');
        desc.className = 'event-description';
        desc.textContent = `관련: ${event.entities.join(', ')} | 거리: ${event.distance || 'N/A'}m`;
        
        item.appendChild(header);
        item.appendChild(desc);
        panel.appendChild(item);
    });
    
    // Update risk counts
    const high = state.events.filter(e => e.level === 'HIGH' || e.level === 'CRITICAL').length;
    const medium = state.events.filter(e => e.level === 'MEDIUM').length;
    const low = state.events.filter(e => e.level === 'LOW').length;
    
    document.getElementById('highRiskCount').textContent = high;
    document.getElementById('mediumRiskCount').textContent = medium;
    document.getElementById('lowRiskCount').textContent = low;
}

// Update Commands Panel
function updateCommandsPanel() {
    const panel = document.getElementById('commandsList');
    panel.innerHTML = '';
    
    state.commands.slice(0, 10).forEach(cmd => {
        const item = document.createElement('div');
        item.className = `command-item ${cmd.type.toLowerCase()}`;
        
        item.innerHTML = `
            <div class="command-header">
                <span class="command-target">${cmd.target}</span>
                <span class="command-time">${new Date(cmd.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="command-text">"${cmd.command}"</div>
            <div class="command-reason">${cmd.reason}</div>
        `;
        
        panel.appendChild(item);
    });
}

// Update Statistics
function updateStats() {
    document.getElementById('activeForkliftCount').textContent = state.forklifts.filter(f => f.status === 'moving').length;
    document.getElementById('pedestrianCount').textContent = state.pedestrians.length;
    document.getElementById('todayIncidents').textContent = state.stats.todayIncidents;
    document.getElementById('preventedCollisions').textContent = state.stats.preventedCollisions;
    
    // Update sensor counts
    updateSensorStatus();
}

// Update Sensor Status Display
function updateSensorStatus() {
    // Update counts
    document.getElementById('cctvCount').textContent = state.sensors.cctv.length;
    document.getElementById('lidarCount').textContent = state.sensors.lidar.length;
    document.getElementById('uwbCount').textContent = state.sensors.uwb.length;
    
    // Update detailed sensor list
    const sensorDetails = document.getElementById('sensorDetails');
    if (!sensorDetails) return;
    
    sensorDetails.innerHTML = '';
    
    // Add CCTV sensors
    state.sensors.cctv.forEach(sensor => {
        const item = createSensorItem('📹', sensor.id, sensor.zone, sensor.status || 'online');
        sensorDetails.appendChild(item);
    });
    
    // Add LiDAR sensors
    state.sensors.lidar.forEach(sensor => {
        const item = createSensorItem('📡', sensor.id, sensor.intersection, sensor.status || 'online');
        sensorDetails.appendChild(item);
    });
    
    // Add UWB sensors
    state.sensors.uwb.forEach(sensor => {
        const item = createSensorItem('📍', sensor.id, sensor.coverage, sensor.status || 'online');
        sensorDetails.appendChild(item);
    });
}

// Create Sensor Item HTML
function createSensorItem(icon, id, location, status) {
    const item = document.createElement('div');
    item.className = 'sensor-item';
    item.innerHTML = `
        <div class="sensor-item-left">
            <span class="sensor-icon-type">${icon}</span>
            <div class="sensor-info">
                <div class="sensor-id">${id}</div>
                <div class="sensor-location">${location}</div>
            </div>
        </div>
        <div class="sensor-status-indicator">
            <span class="sensor-status-dot ${status}"></span>
            <span>${status === 'online' ? '정상' : status === 'offline' ? '오프라인' : '불안정'}</span>
        </div>
    `;
    return item;
}

// Add Activity to Timeline
function addActivity(text, type = 'info') {
    const timeline = document.getElementById('activityTimeline');
    
    const item = document.createElement('div');
    item.className = `activity-item ${type}`;
    item.innerHTML = `
        <div class="activity-time">${new Date().toLocaleTimeString()}</div>
        <div class="activity-text">${text}</div>
    `;
    
    timeline.insertBefore(item, timeline.firstChild);
    
    // Keep only last 10 items
    while (timeline.children.length > 10) {
        timeline.removeChild(timeline.lastChild);
    }
}

// Update Visualization
function updateVisualization() {
    // This can be extended for more complex animations
}

// Utility Functions
function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('ko-KR');
}

function resetView() {
    console.log('🔄 Resetting view...');
    location.reload();
}

function toggleLabels() {
    const labels = document.querySelectorAll('.zone-label, .forklift-label');
    labels.forEach(label => {
        label.style.display = label.style.display === 'none' ? 'block' : 'none';
    });
}

function clearCommandLog() {
    state.commands = [];
    updateCommandsPanel();
}

// ========================================
// AUDIO / TEXT-TO-SPEECH
// ========================================

// Play Voice Command using Web Speech API
function playVoiceCommand(target, commandText) {
    // Check if browser supports speech synthesis
    if (!('speechSynthesis' in window)) {
        console.warn('Browser does not support speech synthesis');
        return;
    }
    
    // Create speech utterance
    const utterance = new SpeechSynthesisUtterance();
    
    // Convert target ID to Korean pronunciation
    // "F-07" -> "F 대시 07" (F dash zero seven)
    // "P-01" -> "P 대시 01" (P dash zero one)
    const targetKorean = convertIdToKorean(target);
    
    // Set text: "F 대시 07! 정지! 교차로 확인!"
    utterance.text = `${targetKorean}! ${commandText}`;
    
    // Set voice properties
    utterance.lang = 'ko-KR'; // Korean
    utterance.rate = 1.1; // Slightly faster (urgent)
    utterance.pitch = 1.0; // Normal pitch
    utterance.volume = 1.0; // Full volume
    
    // Try to use Korean voice if available
    const voices = speechSynthesis.getVoices();
    const koreanVoice = voices.find(voice => voice.lang.startsWith('ko'));
    if (koreanVoice) {
        utterance.voice = koreanVoice;
    }
    
    // Add sound effect before speech (optional beep)
    playBeep(800, 100); // 800Hz beep for 100ms
    
    // Play speech after short delay
    setTimeout(() => {
        speechSynthesis.speak(utterance);
    }, 150);
    
    // Log
    console.log(`🔊 Playing voice: ${utterance.text}`);
}

// Convert ID to Korean pronunciation
// "F-07" -> "F 대시 07"
// "F-12" -> "F 대시 12"
// "P-01" -> "P 대시 01"
function convertIdToKorean(id) {
    // Split by dash
    const parts = id.split('-');
    if (parts.length !== 2) return id;
    
    const letter = parts[0]; // "F" or "P"
    const number = parts[1]; // "07", "12", etc.
    
    // Convert to Korean pronunciation
    // Use "대시" (dash) instead of hyphen being read as "minus" or "hyphen"
    return `${letter} 대시 ${number}`;
}

// Play warning beep sound
function playBeep(frequency = 800, duration = 100) {
    try {
        // Create audio context
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create oscillator (beep sound)
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Set frequency and type
        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';
        
        // Set volume envelope (fade in/out)
        gainNode.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
        gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + duration / 1000);
        
        // Play
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (e) {
        console.warn('Could not play beep:', e);
    }
}

// Play scenario announcement
function playScenarioAnnouncement(text) {
    if (!('speechSynthesis' in window)) return;
    
    const utterance = new SpeechSynthesisUtterance();
    utterance.text = text;
    utterance.lang = 'ko-KR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    const voices = speechSynthesis.getVoices();
    const koreanVoice = voices.find(voice => voice.lang.startsWith('ko'));
    if (koreanVoice) {
        utterance.voice = koreanVoice;
    }
    
    // Play double beep for scenario start
    playBeep(1000, 80);
    setTimeout(() => playBeep(1200, 80), 100);
    
    setTimeout(() => {
        speechSynthesis.speak(utterance);
    }, 250);
}

// Preload voices on page load
window.addEventListener('load', function() {
    // Trigger voice loading
    if ('speechSynthesis' in window) {
        speechSynthesis.getVoices();
        
        // Some browsers need this event
        speechSynthesis.onvoiceschanged = function() {
            const voices = speechSynthesis.getVoices();
            console.log('✅ Available voices:', voices.length);
            
            // List Korean voices
            const koreanVoices = voices.filter(v => v.lang.startsWith('ko'));
            if (koreanVoices.length > 0) {
                console.log('🇰🇷 Korean voices:', koreanVoices.map(v => v.name));
            } else {
                console.warn('⚠️ No Korean voice found, will use default');
            }
        };
    }
});

// ========================================
// DEMO SCENARIO TRIGGERS
// ========================================

// Scenario 1: Forklift Collision Risk
function triggerScenario1() {
    console.log('🔴 Triggering Scenario 1: Collision Risk');
    
    // Play scenario announcement
    playScenarioAnnouncement('시나리오 1. 충돌 위험 감지');
    
    // Find F-07 and F-12
    const f07 = state.forklifts.find(f => f.id === 'F-07');
    const f12 = state.forklifts.find(f => f.id === 'F-12');
    
    if (!f07 || !f12) {
        console.error('Could not find forklifts F-07 or F-12');
        return;
    }
    
    // Stop all other forklifts temporarily
    state.forklifts.forEach(f => {
        if (f.id !== 'F-07' && f.id !== 'F-12') {
            f.status = 'stopped';
            f.speed = 0;
        }
    });
    
    // Position F-07 at intersection X-2 (left approach)
    f07.x = 450;
    f07.y = 90;
    f07.direction = 0; // Moving right
    f07.speed = 15; // High speed
    f07.status = 'moving';
    
    // Position F-12 at intersection X-2 (bottom approach)
    f12.x = 500;
    f12.y = 30;
    f12.direction = 90; // Moving down
    f12.speed = 15; // High speed
    f12.status = 'moving';
    
    // Add activity log
    addActivity('🎬 시나리오 1 시작: F-07과 F-12 충돌 코스', 'danger');
    
    // Show notification
    showNotification('🔴 시나리오 1: 충돌 위험 시나리오 시작!', 'danger');
    
    // Resume other forklifts after 10 seconds
    setTimeout(() => {
        state.forklifts.forEach(f => {
            if (f.status === 'stopped' && f.id !== 'F-07' && f.id !== 'F-12') {
                f.status = 'moving';
                f.speed = Math.floor(Math.random() * 8) + 5;
            }
        });
    }, 10000);
}

// Scenario 2: Pedestrian Proximity
function triggerScenario2() {
    console.log('🟠 Triggering Scenario 2: Pedestrian Proximity');
    
    // Play scenario announcement
    playScenarioAnnouncement('시나리오 2. 보행자 근접 경고');
    
    // Find F-03
    const f03 = state.forklifts.find(f => f.id === 'F-03');
    const p02 = state.pedestrians.find(p => p.id === 'P-02');
    
    if (!f03 || !p02) {
        console.error('Could not find forklift F-03 or pedestrian P-02');
        return;
    }
    
    // Stop other forklifts
    state.forklifts.forEach(f => {
        if (f.id !== 'F-03') {
            f.status = 'stopped';
            f.speed = 0;
        }
    });
    
    // Position F-03 approaching pedestrian
    f03.x = 450;
    f03.y = 420;
    f03.direction = 0; // Moving right
    f03.speed = 12; // High speed
    f03.status = 'moving';
    
    // Position pedestrian P-02 in path
    p02.x = 520;
    p02.y = 420;
    
    // Update SVG position
    const p02Circle = p02.element.querySelector('circle');
    const p02Label = p02.element.querySelector('text');
    if (p02Circle) {
        p02Circle.setAttribute('cx', p02.x);
        p02Circle.setAttribute('cy', p02.y);
    }
    if (p02Label) {
        p02Label.setAttribute('x', p02.x);
        p02Label.setAttribute('y', p02.y - 15);
    }
    
    // Add activity log
    addActivity('🎬 시나리오 2 시작: F-03 보행자 근접', 'warning');
    
    // Show notification
    showNotification('🟠 시나리오 2: 보행자 근접 시나리오 시작!', 'warning');
    
    // Resume other forklifts after 8 seconds
    setTimeout(() => {
        state.forklifts.forEach(f => {
            if (f.status === 'stopped' && f.id !== 'F-03') {
                f.status = 'moving';
                f.speed = Math.floor(Math.random() * 8) + 5;
            }
        });
    }, 8000);
}

// Scenario 3: Speed Violation in Pedestrian Zone
function triggerScenario3() {
    console.log('🟡 Triggering Scenario 3: Speed Violation');
    
    // Play scenario announcement
    playScenarioAnnouncement('시나리오 3. 과속 감지');
    
    // Find F-15
    const f15 = state.forklifts.find(f => f.id === 'F-15');
    
    if (!f15) {
        console.error('Could not find forklift F-15');
        return;
    }
    
    // Stop other forklifts
    state.forklifts.forEach(f => {
        if (f.id !== 'F-15') {
            f.status = 'stopped';
            f.speed = 0;
        }
    });
    
    // Position F-15 entering pedestrian zone at high speed
    f15.x = 30;
    f15.y = 300;
    f15.direction = 0; // Moving right (into ped zone)
    f15.speed = 15; // High speed (violation!)
    f15.status = 'moving';
    
    // Add activity log
    addActivity('🎬 시나리오 3 시작: F-15 보행자 구역 과속', 'warning');
    
    // Show notification
    showNotification('🟡 시나리오 3: 과속 감지 시나리오 시작!', 'caution');
    
    // Resume other forklifts after 8 seconds
    setTimeout(() => {
        state.forklifts.forEach(f => {
            if (f.status === 'stopped' && f.id !== 'F-15') {
                f.status = 'moving';
                f.speed = Math.floor(Math.random() * 8) + 5;
            }
        });
    }, 8000);
}

// Show notification banner
function showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.scenario-notification');
    if (existing) {
        existing.remove();
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `scenario-notification scenario-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">🎬</span>
            <span class="notification-text">${message}</span>
        </div>
    `;
    
    // Add to body
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

// Export for debugging
window.warehouseState = state;
window.warehouseConfig = CONFIG;

console.log('✅ Warehouse Digital Twin System Loaded');
console.log('📊 State:', state);
console.log('⚙️ Config:', CONFIG);
