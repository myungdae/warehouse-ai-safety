/* ============================================================
   Tethered Drone Inventory System (2 Docks, Wired Power)
   Samsung Semiconductor Warehouse
   
   Architecture:
   - 15 Aisles × 20 Racks × 15 Levels
   - 2 Docks: Dock A (Aisles 1-7), Dock B (Aisles 8-15)
   - Tethered (wired) power: No battery management
   - Simultaneous Side A + Side B scanning
   - Sequential aisle navigation (no cross-aisle flight)
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

const LAYERS = [
    { id: 'L1', label: 'Layer 1', height_m: 0.5, color: '#34d399' },
];

const WAREHOUSE = {
    width: 1400,
    height: 620,
    aisles: [],
    shelves: [],
    docks: [
        { 
            id: 'A', 
            name: 'Dock A (Left)', 
            x: 20, y: 50, w: 40, h: 80,
            color: '#22d3ee',
            aisles: ['1','2','3','4','5','6','7']
        },
        { 
            id: 'B', 
            name: 'Dock B (Right)', 
            x: 20, y: 490, w: 40, h: 80,
            color: '#a78bfa',
            aisles: ['8','9','10','11','12','13','14','15']
        },
    ]
};

// Generate Aisles (15 aisles, vertical layout)
for (let i = 0; i < 15; i++) {
    WAREHOUSE.aisles.push({
        id: String(i + 1),
        label: `Aisle ${i + 1}`,
        x: 90 + i * 85,
        y: 50,
        w: 60,
        h: 520
    });
}

// Generate Shelves (15 aisles × 20 racks × 1 level × 2 sides)
WAREHOUSE.aisles.forEach(aisle => {
    const rackCount = 20;
    for (let rack = 0; rack < rackCount; rack++) {
        const y = aisle.y + 10 + rack * 25;
        LAYERS.forEach((layer, li) => {
            // Left shelf (Side A)
            WAREHOUSE.shelves.push({
                id: `${aisle.id}-L${rack+1}-${layer.id}`,
                aisle: aisle.id,
                side: 'L',
                layer: layer.id,
                layerIdx: li,
                rack: rack + 1,
                x: aisle.x - 25,
                y: y,
                w: 20,
                h: 20,
            });
            // Right shelf (Side B)
            WAREHOUSE.shelves.push({
                id: `${aisle.id}-R${rack+1}-${layer.id}`,
                aisle: aisle.id,
                side: 'R',
                layer: layer.id,
                layerIdx: li,
                rack: rack + 1,
                x: aisle.x + aisle.w + 5,
                y: y,
                w: 20,
                h: 20,
            });
        });
    }
});

// ══════════════════════════════════════════════════════════════
// DRONE CONFIGURATION
// ══════════════════════════════════════════════════════════════

const DRONE_CONFIG = {
    size: 12,
    speed: 3.0,
    scanRadius: 40,
};

// ══════════════════════════════════════════════════════════════
// MOCK INVENTORY
// ══════════════════════════════════════════════════════════════

const SKU_LIST = ['SKU-A1001', 'SKU-A1002', 'SKU-A1003', 'SKU-B2001', 'SKU-B2002'];

function buildInventory() {
    const db = {};
    WAREHOUSE.shelves.forEach(shelf => {
        const hasItem = Math.random() > 0.15;
        if (!hasItem) {
            db[shelf.id] = { sku: null, qty: 0 };
            return;
        }
        const skuIdx = Math.abs((shelf.id.charCodeAt(0) * 7 + shelf.rack * 11) % SKU_LIST.length);
        db[shelf.id] = {
            sku: SKU_LIST[skuIdx],
            qty: Math.floor(Math.random() * 15) + 5,
            location: `Aisle-${shelf.aisle} / Rack-${shelf.rack} / ${shelf.side === 'L' ? 'Side A' : 'Side B'} / ${shelf.layer}`
        };
    });
    return db;
}

const inventory = buildInventory();

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

const state = {
    patrolActive: false,
    drones: {
        A: { id: 'A', dockId: 'A', x: 40, y: 90, angle: 0, status: 'standby', currentAisle: null, path: [], pathIndex: 0, scannedCount: 0 },
        B: { id: 'B', dockId: 'B', x: 40, y: 530, angle: 0, status: 'standby', currentAisle: null, path: [], pathIndex: 0, scannedCount: 0 },
    },
    scannedShelves: new Set(),
    scanEvents: [],
    feedLog: [],
    svg: null,
    animFrames: {},
};

// ══════════════════════════════════════════════════════════════
// TASK BUILDER (Tethered: Enter → Scan Both Sides → Return)
// ══════════════════════════════════════════════════════════════

function buildTaskQueue(dockId) {
    const dock = WAREHOUSE.docks.find(d => d.id === dockId);
    const tasks = [];
    
    dock.aisles.forEach((aisleId, idx) => {
        const aisle = WAREHOUSE.aisles.find(a => a.id === aisleId);
        const aisleCenter = aisle.x + aisle.w / 2;
        const aisleTop = aisle.y + 10;
        const aisleBottom = aisle.y + aisle.h - 10;
        
        // 1. Enter aisle (top)
        tasks.push({
            type: 'move',
            desc: `Enter ${aisle.label}`,
            x: aisleCenter,
            y: aisleTop,
        });
        
        // 2. Scan Side A + Side B simultaneously (Rack 1→20)
        const shelvesLeft = WAREHOUSE.shelves.filter(s => 
            s.aisle === aisleId && s.side === 'L' && s.layerIdx === 0
        );
        const shelvesRight = WAREHOUSE.shelves.filter(s => 
            s.aisle === aisleId && s.side === 'R' && s.layerIdx === 0
        );
        
        const racksLeft = {};
        shelvesLeft.forEach(s => {
            if (!racksLeft[s.rack]) racksLeft[s.rack] = [];
            racksLeft[s.rack].push(s);
        });
        
        const racksRight = {};
        shelvesRight.forEach(s => {
            if (!racksRight[s.rack]) racksRight[s.rack] = [];
            racksRight[s.rack].push(s);
        });
        
        // Scan both sides at each rack position
        for (let rack = 1; rack <= 20; rack++) {
            tasks.push({
                type: 'scan',
                aisleId: aisleId,
                rack: rack,
                shelvesLeft: racksLeft[rack] || [],
                shelvesRight: racksRight[rack] || [],
                x: aisleCenter,
                y: aisle.y + 10 + (rack - 1) * 25 + 10,
            });
        }
        
        // 3. Return to top
        tasks.push({
            type: 'move',
            desc: `Return to top of ${aisle.label}`,
            x: aisleCenter,
            y: aisleTop,
        });
        
        // 4. Return to dock (only at the end of all aisles)
        if (idx === dock.aisles.length - 1) {
            tasks.push({
                type: 'move',
                desc: `Return to ${dock.name}`,
                x: dock.x + dock.w / 2,
                y: dock.y + dock.h / 2,
            });
        }
    });
    
    return tasks;
}

// ══════════════════════════════════════════════════════════════
// DRONE CONTROL
// ══════════════════════════════════════════════════════════════

function startPatrol() {
    if (state.patrolActive) return;
    
    console.log('🚀 Starting Tethered Drone Patrol');
    state.patrolActive = true;
    
    // Build tasks for each dock
    ['A', 'B'].forEach(dockId => {
        const drone = state.drones[dockId];
        drone.path = buildTaskQueue(dockId);
        drone.pathIndex = 0;
        drone.status = 'working';
        
        console.log(`Drone ${dockId}: ${drone.path.length} tasks`);
        
        // Start animation
        state.animFrames[dockId] = requestAnimationFrame(() => droneLoop(dockId));
    });
    
    addFeed('🔌 Tethered Drone Patrol Started — 2 drones (wired power)', 'system');
    
    // Update button
    const btn = document.getElementById('patrolBtn');
    if (btn) btn.textContent = '⏸ Pause';
}

function stopPatrol() {
    state.patrolActive = false;
    ['A', 'B'].forEach(dockId => {
        if (state.animFrames[dockId]) {
            cancelAnimationFrame(state.animFrames[dockId]);
        }
    });
    
    const btn = document.getElementById('patrolBtn');
    if (btn) btn.textContent = '▶ Resume';
}

function resetPatrol() {
    stopPatrol();
    state.scannedShelves.clear();
    state.scanEvents = [];
    state.feedLog = [];
    
    ['A', 'B'].forEach(dockId => {
        const drone = state.drones[dockId];
        const dock = WAREHOUSE.docks.find(d => d.id === dockId);
        drone.x = dock.x + dock.w / 2;
        drone.y = dock.y + dock.h / 2;
        drone.status = 'standby';
        drone.path = [];
        drone.pathIndex = 0;
        drone.scannedCount = 0;
    });
    
    const btn = document.getElementById('patrolBtn');
    if (btn) btn.textContent = '▶ Start Patrol';
    
    renderPatrolView(document.getElementById('dashboardContent'));
}

function togglePatrol() {
    if (state.patrolActive) {
        stopPatrol();
    } else {
        startPatrol();
    }
}

function droneLoop(droneId) {
    const drone = state.drones[droneId];
    
    if (!state.patrolActive || drone.status !== 'working') return;
    
    if (drone.path.length > 0 && drone.pathIndex < drone.path.length) {
        const target = drone.path[drone.pathIndex];
        const dx = target.x - drone.x;
        const dy = target.y - drone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 2) {
            // Reached target
            if (target.type === 'scan') {
                processScan(droneId, target);
            } else if (target.type === 'move') {
                if (target.desc) {
                    addFeed(`Drone ${droneId}: ${target.desc}`, 'system');
                }
            }
            drone.pathIndex++;
            
            // Check if all tasks completed
            if (drone.pathIndex >= drone.path.length) {
                drone.status = 'standby';
                addFeed(`✅ Drone ${droneId} patrol complete — ${drone.scannedCount} items scanned`, 'success');
                updateDroneElement(droneId);
                return;
            }
        } else {
            // Move towards target
            drone.x += (dx / dist) * DRONE_CONFIG.speed;
            drone.y += (dy / dist) * DRONE_CONFIG.speed;
            drone.angle = Math.atan2(dy, dx) * 180 / Math.PI;
        }
    }
    
    updateDroneElement(droneId);
    updateGlobalStats();
    
    // Continue loop
    state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));
}

function processScan(droneId, task) {
    const drone = state.drones[droneId];
    const scanTime = new Date().toLocaleTimeString('ko-KR');
    
    // Read Rack ID first
    const rackId = `${task.aisleId}-${task.rack}`;
    addFeed(`Drone ${droneId}: 📍 Reading Rack ${rackId} (Both Sides)`, 'system');
    
    // Scan Side A (Left)
    task.shelvesLeft.forEach((shelf, idx) => {
        if (state.scannedShelves.has(shelf.id)) return;
        state.scannedShelves.add(shelf.id);
        
        const item = inventory[shelf.id];
        state.scanEvents.push({
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            droneId: droneId,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            rack: shelf.rack,
            side: 'A',
            sku: item?.sku || null,
            qty: item?.qty || 0,
        });
        
        drone.scannedCount++;
        
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', item?.sku ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.2)');
            shelfEl.setAttribute('stroke', item?.sku ? '#34d399' : '#f87171');
        }
        
        addFeed(`Drone ${droneId}: 📦 Side A Item ${idx + 1}/5 — ${item?.sku ? item.sku + ' × ' + item.qty : 'Empty'}`, 'scan');
    });
    
    // Scan Side B (Right)
    task.shelvesRight.forEach((shelf, idx) => {
        if (state.scannedShelves.has(shelf.id)) return;
        state.scannedShelves.add(shelf.id);
        
        const item = inventory[shelf.id];
        state.scanEvents.push({
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            droneId: droneId,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            rack: shelf.rack,
            side: 'B',
            sku: item?.sku || null,
            qty: item?.qty || 0,
        });
        
        drone.scannedCount++;
        
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', item?.sku ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.2)');
            shelfEl.setAttribute('stroke', item?.sku ? '#34d399' : '#f87171');
        }
        
        addFeed(`Drone ${droneId}: 📦 Side B Item ${idx + 1}/5 — ${item?.sku ? item.sku + ' × ' + item.qty : 'Empty'}`, 'scan');
    });
    
    addFeed(`Drone ${droneId}: ✅ Rack ${task.rack} complete — Both sides scanned`, 'success');
}

// ══════════════════════════════════════════════════════════════
// UI RENDERING
// ══════════════════════════════════════════════════════════════

function renderPatrolView(content) {
    content.innerHTML = `
    <div class="patrol-layout">
        <div class="map-panel" style="width:100%;">
            <div class="map-header">
                <span class="map-title">🔌 Tethered Drone System — 15 Aisles × 20 Racks (Wired Power)</span>
                <div class="map-controls">
                    <button class="btn-start" onclick="resetPatrol()">↺ Reset</button>
                    <button class="btn-start go" id="patrolBtn" onclick="togglePatrol()">▶ Start Patrol</button>
                </div>
            </div>
            
            <div style="display:flex;gap:10px">
                <!-- Dock Status Panel -->
                <div style="width:180px;display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(15,23,42,0.8);border-radius:8px">
                    ${WAREHOUSE.docks.map(dock => `
                    <div class="dock-card" style="border-left:3px solid ${dock.color};padding:8px;background:rgba(15,23,42,0.5);border-radius:4px">
                        <div style="font-weight:700;color:${dock.color};font-size:0.8rem">${dock.name}</div>
                        <div style="font-size:0.65rem;color:#64748b;margin-top:4px">
                            <div>Drone: <span style="color:${dock.color}">${dock.id}</span></div>
                            <div>Aisles: ${dock.aisles.join(', ')}</div>
                            <div id="drone${dock.id}-status">Status: Standby</div>
                        </div>
                    </div>
                    `).join('')}
                </div>
                
                <!-- Warehouse Map -->
                <svg id="warehouseMap" viewBox="0 0 ${WAREHOUSE.width} ${WAREHOUSE.height}" 
                     style="flex:1;background:#0d1424;border-radius:8px;border:1px solid rgba(99,102,241,0.2)">
                    <g id="docksGroup"></g>
                    <g id="aislesGroup"></g>
                    <g id="shelvesGroup"></g>
                    <g id="dronesGroup"></g>
                </svg>
            </div>
        </div>
        
        <div id="liveFeed" style="margin-top:10px;padding:10px;background:rgba(15,23,42,0.5);border-radius:8px;max-height:200px;overflow-y:auto;font-size:0.75rem;border:1px solid rgba(99,102,241,0.1)"></div>
    </div>`;
    
    state.svg = document.getElementById('warehouseMap');
    renderWarehouseElements();
}

function renderWarehouseElements() {
    const docksG = document.getElementById('docksGroup');
    const aislesG = document.getElementById('aislesGroup');
    const shelvesG = document.getElementById('shelvesGroup');
    const dronesG = document.getElementById('dronesGroup');
    
    // Render docks
    WAREHOUSE.docks.forEach(dock => {
        const rect = createSVG('rect', {
            x: dock.x, y: dock.y, width: dock.w, height: dock.h,
            fill: `rgba(${dock.color === '#22d3ee' ? '34,211,238' : '167,139,250'},0.15)`,
            stroke: dock.color, 'stroke-width': '2', rx: '4'
        });
        docksG.appendChild(rect);
        
        const label = createSVG('text', {
            x: dock.x + dock.w / 2, y: dock.y - 5,
            fill: dock.color, 'font-size': '9', 'text-anchor': 'middle', 'font-weight': '700'
        });
        label.textContent = dock.name;
        docksG.appendChild(label);
    });
    
    // Render aisles
    WAREHOUSE.aisles.forEach(aisle => {
        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: 'rgba(99,102,241,0.03)', stroke: 'rgba(99,102,241,0.15)', 'stroke-width': '1', rx: '2'
        });
        aislesG.appendChild(rect);
        
        const label = createSVG('text', {
            x: aisle.x + aisle.w / 2, y: aisle.y - 5,
            fill: '#64748b', 'font-size': '8', 'text-anchor': 'middle'
        });
        label.textContent = aisle.label;
        aislesG.appendChild(label);
    });
    
    // Render shelves (L1 only)
    WAREHOUSE.shelves.filter(s => s.layerIdx === 0).forEach(shelf => {
        const item = inventory[shelf.id];
        const hasItem = item && item.qty > 0;
        
        const rect = createSVG('rect', {
            id: `shelf-${shelf.id}`,
            x: shelf.x, y: shelf.y, width: shelf.w, height: shelf.h,
            fill: hasItem ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
            stroke: hasItem ? 'rgba(99,102,241,0.3)' : 'rgba(100,116,139,0.2)',
            'stroke-width': '1', rx: '2'
        });
        shelvesG.appendChild(rect);
    });
    
    // Render drones
    ['A', 'B'].forEach(droneId => {
        const drone = state.drones[droneId];
        const g = createSVG('g', { id: `drone-${droneId}` });
        
        const circle = createSVG('circle', {
            cx: drone.x, cy: drone.y, r: DRONE_CONFIG.size,
            fill: WAREHOUSE.docks.find(d => d.id === droneId).color,
            opacity: '0.8', stroke: '#fff', 'stroke-width': '1.5'
        });
        g.appendChild(circle);
        
        const text = createSVG('text', {
            x: drone.x, y: drone.y + 4,
            fill: '#fff', 'font-size': '8', 'text-anchor': 'middle', 'font-weight': '700'
        });
        text.textContent = droneId;
        g.appendChild(text);
        
        dronesG.appendChild(g);
    });
}

function updateDroneElement(droneId) {
    const drone = state.drones[droneId];
    const g = document.getElementById(`drone-${droneId}`);
    if (!g) return;
    
    const circle = g.querySelector('circle');
    const text = g.querySelector('text');
    
    circle.setAttribute('cx', drone.x);
    circle.setAttribute('cy', drone.y);
    text.setAttribute('x', drone.x);
    text.setAttribute('y', drone.y + 4);
    
    // Update dock status
    const statusEl = document.getElementById(`drone${droneId}-status`);
    if (statusEl) {
        statusEl.textContent = `Status: ${drone.status === 'working' ? 'Working' : 'Standby'}`;
    }
}

function updateGlobalStats() {
    const totalL1 = WAREHOUSE.shelves.filter(s => s.layerIdx === 0).length;
    const scanned = state.scannedShelves.size;
    const coverage = totalL1 > 0 ? (scanned / totalL1 * 100) : 0;
    
    const scannedEl = document.getElementById('totalScanned');
    const coverageEl = document.getElementById('coveragePct');
    
    if (scannedEl) scannedEl.textContent = scanned;
    if (coverageEl) coverageEl.textContent = coverage.toFixed(1) + '%';
}

function addFeed(message, type) {
    const time = new Date().toLocaleTimeString('ko-KR');
    state.feedLog.push({ time, message, type });
    
    const feed = document.getElementById('liveFeed');
    if (!feed) return;
    
    const colors = {
        system: '#64748b',
        scan: '#34d399',
        success: '#22d3ee',
        alert: '#fbbf24'
    };
    
    const div = document.createElement('div');
    div.style.color = colors[type] || '#94a3b8';
    div.style.marginBottom = '4px';
    div.innerHTML = `<span style="color:#475569">${time}</span> ${message}`;
    
    feed.insertBefore(div, feed.firstChild);
    
    // Keep only last 50 entries
    while (feed.children.length > 50) {
        feed.removeChild(feed.lastChild);
    }
}

function createSVG(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('dashboardContent');
    if (content) {
        renderPatrolView(content);
    }
});
