/* ============================================================
   Multi-Drone Inventory System (9 Drones, 3 Docks)
   Samsung Semiconductor Warehouse - Drone Inventory Management
   
   Architecture:
   - 15 Aisles × 20 Racks × 15 Levels (9,000 positions per side)
   - 3 Docks (First/Second/Third), each with 3 drones (A/B/C)
   - Battery-based handover: working → standby → charging
   - Demo: Level 1 only, 27-minute battery cycle
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

// ── Layers (15 levels, 1m spacing) ──────────────────────────
const LAYERS = [
    { id: 'L1',  label: 'Layer 1',   height_m: 0.5,   color: '#f87171', colorAlpha: 'rgba(248,113,113,0.15)' },
    { id: 'L2',  label: 'Layer 2',   height_m: 1.5,   color: '#fb923c', colorAlpha: 'rgba(251,146,60,0.15)' },
    { id: 'L3',  label: 'Layer 3',   height_m: 2.5,   color: '#fbbf24', colorAlpha: 'rgba(251,191,36,0.15)' },
    { id: 'L4',  label: 'Layer 4',   height_m: 3.5,   color: '#a3e635', colorAlpha: 'rgba(163,230,53,0.15)' },
    { id: 'L5',  label: 'Layer 5',   height_m: 4.5,   color: '#34d399', colorAlpha: 'rgba(52,211,153,0.15)' },
    { id: 'L6',  label: 'Layer 6',   height_m: 5.5,   color: '#22d3ee', colorAlpha: 'rgba(34,211,238,0.15)' },
    { id: 'L7',  label: 'Layer 7',   height_m: 6.5,   color: '#3b82f6', colorAlpha: 'rgba(59,130,246,0.15)' },
    { id: 'L8',  label: 'Layer 8',   height_m: 7.5,   color: '#6366f1', colorAlpha: 'rgba(99,102,241,0.15)' },
    { id: 'L9',  label: 'Layer 9',   height_m: 8.5,   color: '#8b5cf6', colorAlpha: 'rgba(139,92,246,0.15)' },
    { id: 'L10', label: 'Layer 10',  height_m: 9.5,   color: '#a78bfa', colorAlpha: 'rgba(167,139,250,0.15)' },
    { id: 'L11', label: 'Layer 11',  height_m: 10.5,  color: '#c084fc', colorAlpha: 'rgba(192,132,252,0.15)' },
    { id: 'L12', label: 'Layer 12',  height_m: 11.5,  color: '#d946ef', colorAlpha: 'rgba(217,70,239,0.15)' },
    { id: 'L13', label: 'Layer 13',  height_m: 12.5,  color: '#e879f9', colorAlpha: 'rgba(232,121,249,0.15)' },
    { id: 'L14', label: 'Layer 14',  height_m: 13.5,  color: '#f0abfc', colorAlpha: 'rgba(240,171,252,0.15)' },
    { id: 'L15', label: 'Layer 15',  height_m: 14.5,  color: '#fae8ff', colorAlpha: 'rgba(250,232,255,0.15)' },
];

// ── Warehouse Structure ──────────────────────────────────────
const WAREHOUSE = {
    width: 1400,
    height: 620,
    aisles: [],
    shelves: [],
    docks: []
};

// Generate 15 Aisles
for (let i = 0; i < 15; i++) {
    WAREHOUSE.aisles.push({
        id: String(i + 1),
        x: 60 + i * 88,
        y: 50,
        w: 70,
        h: 540,
        label: `Aisle-${i + 1}`,
        dockId: i < 5 ? 1 : (i < 10 ? 2 : 3)
    });
}

// 3 Dock Stations
WAREHOUSE.docks = [
    { 
        id: 1, 
        name: 'First Dock',  
        x: 20,  y: 180, w: 35, h: 110, 
        color: '#22d3ee', 
        aisles: ['1','2','3','4','5'],
        drones: ['A', 'B', 'C']
    },
    { 
        id: 2, 
        name: 'Second Dock', 
        x: 20,  y: 310, w: 35, h: 110, 
        color: '#34d399', 
        aisles: ['6','7','8','9','10'],
        drones: ['D', 'E', 'F']
    },
    { 
        id: 3, 
        name: 'Third Dock',  
        x: 20,  y: 440, w: 35, h: 110, 
        color: '#a78bfa', 
        aisles: ['11','12','13','14','15'],
        drones: ['G', 'H', 'I']
    },
];

// Generate Shelves (15 aisles × 20 racks × 15 levels × 2 sides = 9,000 per side)
WAREHOUSE.aisles.forEach(aisle => {
    const rackCount = 20;
    for (let rack = 0; rack < rackCount; rack++) {
        const y = aisle.y + 10 + rack * 26;
        LAYERS.forEach((layer, li) => {
            // Left shelf
            WAREHOUSE.shelves.push({
                id:       `${aisle.id}-L${rack+1}-${layer.id}`,
                aisle:    aisle.id,
                side:     'L',
                layer:    layer.id,
                layerIdx: li,
                x: aisle.x - 28,
                y: y,
                w: 24, h: 22,
                rack: rack + 1,
                height_m: layer.height_m,
            });
            // Right shelf
            WAREHOUSE.shelves.push({
                id:       `${aisle.id}-R${rack+1}-${layer.id}`,
                aisle:    aisle.id,
                side:     'R',
                layer:    layer.id,
                layerIdx: li,
                x: aisle.x + aisle.w + 4,
                y: y,
                w: 24, h: 22,
                rack: rack + 1,
                height_m: layer.height_m,
            });
        });
    }
});

// ── Drone Configuration ──────────────────────────────────────
const DRONE_CONFIG = {
    size: 12,
    speed: 2.5,
    scanRadius: 35,
    batteryMax: 100,
    batteryDrainRate: 0.0617,      // 27분(1620초)에 100% 소모: 100/1620 = 0.0617%/초
    batteryLowThreshold: 10,       // 10% 이하 시 복귀
    chargeRate: 0.476,             // 3봸 30초(210초)에 100% 충전: 100/210 = 0.476%/초
};

// ── Scan Configuration ──────────────────────────────────────
const SCAN_CONFIG = {
    scanMode: 'both',    // 'both' | 'left' | 'right'
    startLayer: 0,       // Demo: L1 only
    endLayer: 0,         // Demo: L1 only
};

// ══════════════════════════════════════════════════════════════
// INVENTORY DATA (ERP Mockup)
// ══════════════════════════════════════════════════════════════

const SKU_LIST = [
    'SKU-A1001', 'SKU-A1002', 'SKU-A1003', 'SKU-A1004', 'SKU-A1005',
    'SKU-B2001', 'SKU-B2002', 'SKU-B2003', 'SKU-B2004', 'SKU-B2005',
    'SKU-C3001', 'SKU-C3002', 'SKU-C3003', 'SKU-C3004', 'SKU-C3005',
    'SKU-D4001', 'SKU-D4002', 'SKU-D4003', 'SKU-D4004', 'SKU-D4005',
    'SKU-E5001', 'SKU-E5002', 'SKU-E5003', 'SKU-E5004', 'SKU-E5005',
];

function buildInventoryDay(day) {
    const db = {};
    WAREHOUSE.shelves.forEach(shelf => {
        const hasItem = Math.random() > 0.12;  // 88% has items
        if (!hasItem) {
            db[shelf.id] = { sku: null, qty: 0, confidence: 0 };
            return;
        }
        const skuIdx = Math.abs((shelf.id.charCodeAt(0) * 7 + shelf.rack * 11) % SKU_LIST.length);
        db[shelf.id] = {
            sku: SKU_LIST[skuIdx],
            qty: Math.floor(Math.random() * 15) + 5,
            confidence: 0.90 + Math.random() * 0.09,
            location: `Aisle-${shelf.aisle} / Rack-${shelf.rack} / ${shelf.side === 'L' ? 'Left' : 'Right'} / ${shelf.layer}`
        };
    });
    return db;
}

function buildDay2(day1) {
    const day2 = JSON.parse(JSON.stringify(day1));
    const shelfIds = Object.keys(day2);
    
    // Simulate changes
    shuffle(shelfIds).slice(0, 12).forEach(id => {
        if (day2[id].qty > 0) day2[id].qty = Math.max(0, day2[id].qty - Math.floor(Math.random() * 6 + 1));
    });
    shuffle(shelfIds).slice(0, 8).forEach(id => {
        if (day2[id].sku) day2[id].qty += Math.floor(Math.random() * 8 + 2);
    });
    shuffle(shelfIds).slice(0, 5).forEach(id => {
        day2[id].qty = 0;
        day2[id].sku = null;
    });
    return day2;
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ══════════════════════════════════════════════════════════════
// GLOBAL STATE
// ══════════════════════════════════════════════════════════════

let inventoryDay1 = buildInventoryDay(1);
let inventoryDay2 = buildDay2(inventoryDay1);

let state = {
    currentView: 'patrol',
    currentDay: 1,
    patrolActive: false,
    patrolDone: false,
    
    // Multi-drone state
    drones: {},  // { 'A': {...}, 'B': {...}, ... }
    dockQueues: {
        1: { working: null, standby: 'B', charging: 'C', queue: [] },
        2: { working: null, standby: 'E', charging: 'F', queue: [] },
        3: { working: null, standby: 'H', charging: 'I', queue: [] },
    },
    
    scanEvents: [],
    scanEventsDay2: [],
    changeEvents: [],
    
    svg: null,
    droneElements: {},
    scannedShelves: new Set(),
    
    animFrames: {},  // Separate animation frame for each drone
};

// Initialize 9 drones
function initializeDrones() {
    const droneNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    droneNames.forEach((name, idx) => {
        const dockId = Math.floor(idx / 3) + 1;
        const dock = WAREHOUSE.docks.find(d => d.id === dockId);
        const posInDock = idx % 3;  // 0=A/D/G, 1=B/E/H, 2=C/F/I
        
        // Initial status rotation: Working (A/D/G), Standby (B/E/H), Charging (C/F/I)
        let initialStatus = posInDock === 0 ? 'standby' : (posInDock === 1 ? 'standby' : 'charging');
        let initialBattery = posInDock === 0 ? 100 : (posInDock === 1 ? 100 : 20);
        
        state.drones[name] = {
            id: name,
            dockId: dockId,
            status: initialStatus,
            x: dock.x + dock.w / 2,
            y: dock.y + 20 + posInDock * 30,
            angle: 0,
            battery: initialBattery,
            path: [],
            pathIndex: 0,
            targetShelf: null,
            scannedCount: 0,
        };
    });
    
    // Set initial queue states
    state.dockQueues[1] = { working: null, standby: 'B', charging: 'C', queue: [] };
    state.dockQueues[2] = { working: null, standby: 'E', charging: 'F', queue: [] };
    state.dockQueues[3] = { working: null, standby: 'H', charging: 'I', queue: [] };
}

// ══════════════════════════════════════════════════════════════
// TASK SCHEDULER
// ══════════════════════════════════════════════════════════════

function buildTaskQueue(dockId) {
    const dock = WAREHOUSE.docks.find(d => d.id === dockId);
    const tasks = [];
    
    dock.aisles.forEach((aisleId, aisleIdx) => {
        const aisle = WAREHOUSE.aisles.find(a => a.id === aisleId);
        const aisleTopY = aisle.y + 10;
        const aisleBottomY = aisle.y + aisle.h - 20;
        const aisleCenter = aisle.x + aisle.w / 2;
        
        // ─── Aisle 진입 (상단으로) ───
        if (aisleIdx === 0) {
            // 첫 번째 aisle: Dock에서 직접 상단 진입
            tasks.push({
                type: 'move',
                desc: `Enter ${aisle.label} (top)`,
                x: aisleCenter,
                y: aisleTopY,
            });
        } else {
            // 이전 aisle 상단에서 수평 이동 (같은 높이)
            const prevAisle = WAREHOUSE.aisles.find(a => a.id === dock.aisles[aisleIdx - 1]);
            
            // 수평 이동 (같은 높이로, 기둥 돌아가기)
            tasks.push({
                type: 'move',
                desc: `Navigate to ${aisle.label} (same level)`,
                x: aisleCenter,
                y: aisleTopY,  // 상단 높이 유지
            });
        }
        
        // ─── Side A 스캔 (Left, Rack 1→20, 위→아래) ───
        const shelvesLeftSide = WAREHOUSE.shelves.filter(s => 
            s.aisle === aisleId && 
            s.side === 'L' &&
            s.layerIdx === SCAN_CONFIG.startLayer
        );
        
        const racksLeft = {};
        shelvesLeftSide.forEach(shelf => {
            if (!racksLeft[shelf.rack]) racksLeft[shelf.rack] = [];
            racksLeft[shelf.rack].push(shelf);
        });
        
        Object.keys(racksLeft).sort((a, b) => parseInt(a) - parseInt(b)).forEach(rack => {
            tasks.push({
                type: 'scan',
                side: 'L',
                aisleId: aisleId,
                rack: parseInt(rack),
                shelves: racksLeft[rack],
                x: aisleCenter,
                y: aisle.y + 10 + (parseInt(rack) - 1) * 26 + 11,
            });
        });
        
        // ─── Side A 완료 후 하단 끝으로 이동 (물리적 제약: 직접 넘어갈 수 없음) ───
        tasks.push({
            type: 'move',
            desc: `Move to bottom end of ${aisle.label} (Side A complete, preparing Side B)`,
            x: aisleCenter,
            y: aisleBottomY,
        });
        
        // ─── 하단 끝에서 반대편(Side B)으로 회전 ───
        tasks.push({
            type: 'move',
            desc: `Rotate to Side B at bottom of ${aisle.label}`,
            x: aisleCenter + 15,  // 약간 오른쪽으로 이동 (회전 표현)
            y: aisleBottomY,
        });
        
        // ─── Side B 스캔 (Right, Rack 20→1, 하단→상단) ───
        const shelvesRightSide = WAREHOUSE.shelves.filter(s => 
            s.aisle === aisleId && 
            s.side === 'R' &&
            s.layerIdx === SCAN_CONFIG.startLayer
        );
        
        const racksRight = {};
        shelvesRightSide.forEach(shelf => {
            if (!racksRight[shelf.rack]) racksRight[shelf.rack] = [];
            racksRight[shelf.rack].push(shelf);
        });
        
        // Side B는 Rack 20부터 1까지 역순 (하단→상단)
        Object.keys(racksRight).sort((a, b) => parseInt(b) - parseInt(a)).forEach(rack => {
            tasks.push({
                type: 'scan',
                side: 'R',
                aisleId: aisleId,
                rack: parseInt(rack),
                shelves: racksRight[rack],
                x: aisleCenter,
                y: aisle.y + 10 + (parseInt(rack) - 1) * 26 + 11,
            });
        });
        
        // ─── Side B 완료 후 상단 끝으로 이동 (다음 aisle로 이동 준비) ───
        tasks.push({
            type: 'move',
            desc: `Move to top end of ${aisle.label} (Side B complete)`,
            x: aisleCenter,
            y: aisleTopY,
        });
        
        // ─── 다음 aisle로 이동 (수평 이동, 상단 끝→다음 aisle 상단 끝) ───
        const nextAisle = dockAisles[idx + 1];
        if (nextAisle) {
            tasks.push({
                type: 'move',
                desc: `Navigate to ${nextAisle.label} top end (horizontal)`,
                x: nextAisle.x + nextAisle.w / 2,
                y: nextAisle.y + 10,
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
    
    state.patrolActive = true;
    initializeDrones();
    
    // Build task queues for each dock
    [1, 2, 3].forEach(dockId => {
        state.dockQueues[dockId].queue = buildTaskQueue(dockId);
    });
    
    // Start with standby drones (B, E, H) - they become working
    assignNextTask('B');
    assignNextTask('E');
    assignNextTask('H');
    
    // Start animation loops
    Object.keys(state.drones).forEach(droneId => {
        state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));
    });
    
    addFeed('🚁 Multi-Drone Patrol Started — 9 drones across 3 docks', 'system');
}

function assignNextTask(droneId) {
    const drone = state.drones[droneId];
    const dockQueue = state.dockQueues[drone.dockId];
    
    if (dockQueue.queue.length === 0) {
        // No more tasks, return to dock
        returnToDock(droneId);
        return;
    }
    
    const task = dockQueue.queue.shift();
    drone.status = 'working';
    drone.currentTask = task;
    
    // Build path based on task type
    if (task.type === 'move') {
        // Simple move task
        drone.path = [
            { x: task.x, y: task.y, type: 'move', desc: task.desc }
        ];
    } else if (task.type === 'scan') {
        // Scan task
        drone.path = [
            { x: task.x, y: task.y, type: 'scan', task: task }
        ];
    }
    
    drone.pathIndex = 0;
    dockQueue.working = droneId;
    
    updateDockUI(drone.dockId);
}

function returnToDock(droneId) {
    const drone = state.drones[droneId];
    const dock = WAREHOUSE.docks.find(d => d.id === drone.dockId);
    
    drone.status = 'returning';
    drone.path = [
        { x: dock.x + dock.w / 2, y: dock.y + 20, type: 'dock' }
    ];
    drone.pathIndex = 0;
}

function droneLoop(droneId) {
    if (!state.patrolActive) return;
    
    const drone = state.drones[droneId];
    
    // Battery drain (working 또는 returning 상태일 때)
    if (drone.status === 'working' || drone.status === 'returning') {
        drone.battery = Math.max(0, drone.battery - DRONE_CONFIG.batteryDrainRate);
        
        // Low battery check: 10% 이하일 때 복귀
        if (drone.battery <= DRONE_CONFIG.batteryLowThreshold && drone.status === 'working') {
            addFeed(`⚠️ Drone ${droneId} low battery (${drone.battery.toFixed(1)}%) - returning to dock`, 'alert');
            returnToDock(droneId);
            handoverToStandby(drone.dockId);
        }
    }
    
    // Charging: 충전 중일 때
    if (drone.status === 'charging') {
        drone.battery = Math.min(100, drone.battery + DRONE_CONFIG.chargeRate);
        
        // 충전 완료 시 standby로 전환
        if (drone.battery >= 95) {
            const dockQueue = state.dockQueues[drone.dockId];
            if (dockQueue.charging === droneId && !dockQueue.standby) {
                drone.status = 'standby';
                dockQueue.standby = droneId;
                dockQueue.charging = null;
                addFeed(`✅ Drone ${droneId} fully charged - now standby`, 'system');
                updateDockUI(drone.dockId);
            }
        }
    }
    
    // Movement
    if (drone.path.length > 0 && drone.pathIndex < drone.path.length) {
        const target = drone.path[drone.pathIndex];
        const dx = target.x - drone.x;
        const dy = target.y - drone.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 2) {
            // Reached target
            if (target.type === 'scan') {
                processScan(droneId, target.task);
            } else if (target.type === 'move') {
                // Just a waypoint, continue to next task
                if (target.desc) {
                    // 이동 타입별로 아이콘 추가
                    let icon = '🛫';
                    if (target.desc.includes('bottom')) icon = '⬇️';
                    else if (target.desc.includes('top') || target.desc.includes('Return')) icon = '⬆️';
                    else if (target.desc.includes('Navigate') || target.desc.includes('same level')) icon = '➡️';
                    else if (target.desc.includes('Rotate')) icon = '🔄';
                    
                    addFeed(`Drone ${droneId}: ${icon} ${target.desc}`, 'system');
                }
            } else if (target.type === 'dock') {
                dockDrone(droneId);
            }
            drone.pathIndex++;
            
            // Get next task
            if (drone.pathIndex >= drone.path.length && drone.status === 'working') {
                assignNextTask(droneId);
            }
        } else {
            // Move towards target
            drone.x += (dx / dist) * DRONE_CONFIG.speed;
            drone.y += (dy / dist) * DRONE_CONFIG.speed;
            drone.angle = Math.atan2(dy, dx) * 180 / Math.PI;
        }
    }
    
    updateDroneElement(droneId);
    
    // Continue loop
    state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));
}

function processScan(droneId, task) {
    const drone = state.drones[droneId];
    const inv = getCurrentInventory();
    const scanTime = new Date().toLocaleTimeString('ko-KR');
    
    // 1️⃣ 먼저 Rack ID 읽기 (물리적 프로세스의 첫 단계)
    const rackId = `${task.aisleId}-${task.side}${task.rack}`;
    const sideName = task.side === 'L' ? 'Side A (Left)' : 'Side B (Right)';
    addFeed(`Drone ${droneId}: 📍 Reading Rack ID: ${rackId} — ${sideName}`, 'system');
    
    task.shelves.forEach((shelf, itemIdx) => {
        if (state.scannedShelves.has(shelf.id)) return;
        state.scannedShelves.add(shelf.id);
        
        const item = inv[shelf.id];
        const event = {
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            day: state.currentDay,
            droneId: droneId,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            rack: shelf.rack,
            side: shelf.side,
            layer: shelf.layer,
            sku: item?.sku || null,
            qty: item?.qty || 0,
            confidence: item?.confidence || 0,
        };
        
        if (state.currentDay === 1) {
            state.scanEvents.push(event);
        } else {
            state.scanEventsDay2.push(event);
        }
        
        drone.scannedCount++;
        
        // Update shelf visual
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', event.sku ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.1)');
            shelfEl.setAttribute('stroke', event.sku ? '#34d399' : '#f87171');
        }
        
        // 2️⃣ Item 단위 스캔 피드백 (1/5, 2/5, ...)
        addFeed(`Drone ${droneId}: 📦 Item ${itemIdx + 1}/5 — ${event.sku ? event.sku + ' × ' + event.qty : 'Empty'}`, 'scan');
    });
    
    // 3️⃣ Rack 스캔 완료 피드백
    addFeed(`Drone ${droneId}: ✅ Rack ${task.rack} complete — 5 items scanned`, 'success');
}

function dockDrone(droneId) {
    const drone = state.drones[droneId];
    const dockQueue = state.dockQueues[drone.dockId];
    
    drone.status = 'charging';
    dockQueue.working = null;
    dockQueue.charging = droneId;
    
    updateDockUI(drone.dockId);
    addFeed(`Drone ${droneId} returned to dock — charging (${drone.battery.toFixed(1)}%)`, 'system');
}

function handoverToStandby(dockId) {
    const dockQueue = state.dockQueues[dockId];
    
    if (!dockQueue.standby) {
        addFeed(`⚠️ No standby drone available at Dock ${dockId}`, 'alert');
        return;
    }
    
    const standbyDroneId = dockQueue.standby;
    const standbyDrone = state.drones[standbyDroneId];
    
    addFeed(`🔄 Handover at Dock ${dockId}: Drone ${standbyDroneId} taking over`, 'agent');
    
    // Standby 드론이 다음 작업을 이어받음
    assignNextTask(standbyDroneId);
    
    // Standby 슬롯 비우기
    dockQueue.standby = null;
    
    // Charging 드론이 충전 완료되면 standby로 전환
    if (dockQueue.charging) {
        const chargingDrone = state.drones[dockQueue.charging];
        if (chargingDrone.battery >= 95) {
            dockQueue.standby = dockQueue.charging;
            dockQueue.charging = null;
            chargingDrone.status = 'standby';
            addFeed(`🔋 Drone ${dockQueue.charging} charged → now standby`, 'system');
        }
    }
    
    updateDockUI(dockId);
}

// ══════════════════════════════════════════════════════════════
// UI RENDERING
// ══════════════════════════════════════════════════════════════

function renderPatrolView(content) {
    content.innerHTML = `
    <div class="patrol-layout">
        <div class="map-panel" style="width:100%;">
            <div class="map-header">
                <span class="map-title">🗺️ Samsung Warehouse — 15 Aisles × 20 Racks × 15 Levels</span>
                <div class="map-controls">
                    <button class="btn-start" onclick="resetPatrol()">↺ Reset</button>
                    <button class="btn-start go" id="patrolBtn" onclick="togglePatrol()">▶ Start Patrol</button>
                </div>
            </div>
            
            <div style="display:flex;gap:10px">
                <!-- Dock Status Panel -->
                <div style="width:200px;display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(15,23,42,0.8);border-radius:8px">
                    ${WAREHOUSE.docks.map(dock => `
                    <div id="dock-${dock.id}" class="dock-status-card" style="border-left:3px solid ${dock.color}">
                        <div style="font-weight:700;color:${dock.color};font-size:0.8rem">${dock.name}</div>
                        <div style="font-size:0.65rem;color:#64748b;margin-top:4px">
                            <div>Working: <span id="dock${dock.id}-working">—</span></div>
                            <div>Standby: <span id="dock${dock.id}-standby">—</span></div>
                            <div>Charging: <span id="dock${dock.id}-charging">—</span></div>
                        </div>
                    </div>
                    `).join('')}
                </div>
                
                <!-- Warehouse Map -->
                <svg id="warehouseMap" viewBox="0 0 ${WAREHOUSE.width} ${WAREHOUSE.height}" 
                     style="flex:1;background:#0d1424;border-radius:8px">
                    <defs>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                    </defs>
                    <g id="docksGroup"></g>
                    <g id="aislesGroup"></g>
                    <g id="shelvesGroup"></g>
                    <g id="dronesGroup"></g>
                </svg>
            </div>
        </div>
        
        <div id="liveFeed" style="margin-top:10px;padding:10px;background:rgba(15,23,42,0.5);border-radius:8px;max-height:200px;overflow-y:auto;font-size:0.75rem"></div>
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
            fill: `rgba(${dock.color === '#22d3ee' ? '34,211,238' : dock.color === '#34d399' ? '52,211,153' : '167,139,250'},0.1)`,
            stroke: dock.color, 'stroke-width': '2', rx: '4'
        });
        docksG.appendChild(rect);
        
        const label = createSVG('text', {
            x: dock.x + dock.w / 2, y: dock.y - 5,
            fill: dock.color, 'font-size': '8', 'text-anchor': 'middle', 'font-weight': '700'
        });
        label.textContent = dock.name;
        docksG.appendChild(label);
    });
    
    // Render aisles
    WAREHOUSE.aisles.forEach(aisle => {
        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: 'rgba(99,102,241,0.03)', stroke: 'rgba(99,102,241,0.1)', 'stroke-width': '1', rx: '2'
        });
        aislesG.appendChild(rect);
        
        const label = createSVG('text', {
            x: aisle.x + aisle.w / 2, y: aisle.y - 5,
            fill: '#64748b', 'font-size': '7', 'text-anchor': 'middle'
        });
        label.textContent = aisle.label;
        aislesG.appendChild(label);
    });
    
    // Render shelves (only L1 for demo)
    const inv = getCurrentInventory();
    WAREHOUSE.shelves.filter(s => s.layerIdx === 0).forEach(shelf => {
        const item = inv[shelf.id];
        const hasItem = item && item.qty > 0;
        
        const rect = createSVG('rect', {
            id: `shelf-${shelf.id}`,
            x: shelf.x, y: shelf.y, width: shelf.w, height: shelf.h,
            fill: hasItem ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
            stroke: hasItem ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)',
            'stroke-width': '1', rx: '1'
        });
        shelvesG.appendChild(rect);
    });
    
    // Render drones
    Object.keys(state.drones).forEach(droneId => {
        const drone = state.drones[droneId];
        const dock = WAREHOUSE.docks.find(d => d.id === drone.dockId);
        
        const g = createSVG('g', { id: `drone-${droneId}` });
        
        // Drone body
        const body = createSVG('circle', {
            cx: drone.x, cy: drone.y, r: DRONE_CONFIG.size / 2,
            fill: '#1e3a5f', stroke: dock.color, 'stroke-width': '2', filter: 'url(#glow)'
        });
        g.appendChild(body);
        
        // Drone label
        const label = createSVG('text', {
            x: drone.x, y: drone.y + 1,
            fill: '#fff', 'font-size': '6', 'text-anchor': 'middle', 'font-weight': '700'
        });
        label.textContent = droneId;
        g.appendChild(label);
        
        dronesG.appendChild(g);
        state.droneElements[droneId] = g;
    });
}

function updateDroneElement(droneId) {
    const drone = state.drones[droneId];
    const g = state.droneElements[droneId];
    if (!g) return;
    
    const circle = g.querySelector('circle');
    const text = g.querySelector('text');
    
    circle.setAttribute('cx', drone.x);
    circle.setAttribute('cy', drone.y);
    text.setAttribute('x', drone.x);
    text.setAttribute('y', drone.y + 1);
    
    // 드론 상태별 색상 변경
    const dock = WAREHOUSE.docks.find(d => d.id === drone.dockId);
    let strokeColor = dock.color;
    let fillOpacity = 0.3;
    
    if (drone.status === 'working') {
        strokeColor = '#22d3ee';  // cyan
        fillOpacity = 0.8;
    } else if (drone.status === 'charging') {
        strokeColor = '#fbbf24';  // amber
        fillOpacity = 0.4;
    } else if (drone.status === 'returning') {
        strokeColor = '#f87171';  // red
        fillOpacity = 0.6;
    }
    
    circle.setAttribute('stroke', strokeColor);
    circle.style.opacity = fillOpacity;
    
    // 배터리에 따라 크기 조절 (선택적)
    // const batteryScale = 0.8 + (drone.battery / 100) * 0.4;  // 0.8~1.2 scale
    // circle.setAttribute('r', DRONE_CONFIG.size / 2 * batteryScale);
    
    // 총 스캤 수 업데이트
    updateGlobalStats();
}

function updateDockUI(dockId) {
    const dockQueue = state.dockQueues[dockId];
    
    const workingEl = document.getElementById(`dock${dockId}-working`);
    const standbyEl = document.getElementById(`dock${dockId}-standby`);
    const chargingEl = document.getElementById(`dock${dockId}-charging`);
    
    if (workingEl) {
        workingEl.textContent = dockQueue.working ? `Drone ${dockQueue.working}` : '—';
        workingEl.style.color = dockQueue.working ? '#22d3ee' : '#64748b';
        workingEl.style.fontWeight = dockQueue.working ? '700' : '400';
    }
    if (standbyEl) {
        standbyEl.textContent = dockQueue.standby ? `Drone ${dockQueue.standby}` : '—';
        standbyEl.style.color = dockQueue.standby ? '#34d399' : '#64748b';
        standbyEl.style.fontWeight = dockQueue.standby ? '700' : '400';
    }
    if (chargingEl) {
        chargingEl.textContent = dockQueue.charging ? `Drone ${dockQueue.charging}` : '—';
        chargingEl.style.color = dockQueue.charging ? '#fbbf24' : '#64748b';
        chargingEl.style.fontWeight = dockQueue.charging ? '700' : '400';
    }
}

function updateGlobalStats() {
    const totalScannedEl = document.getElementById('totalScanned');
    const coveragePctEl = document.getElementById('coveragePct');
    
    if (totalScannedEl) {
        totalScannedEl.textContent = state.scannedShelves.size;
    }
    
    // L1만 데모이므로 전체 L1 shelf 수를 계산
    const totalL1Shelves = WAREHOUSE.shelves.filter(s => s.layerIdx === 0).length;
    const coverage = totalL1Shelves > 0 ? (state.scannedShelves.size / totalL1Shelves * 100) : 0;
    
    if (coveragePctEl) {
        coveragePctEl.textContent = coverage.toFixed(1) + '%';
    }
}

function createSVG(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

function getCurrentInventory() {
    return state.currentDay === 1 ? inventoryDay1 : inventoryDay2;
}

function addFeed(msg, type) {
    const feed = document.getElementById('liveFeed');
    if (!feed) return;
    
    const item = document.createElement('div');
    item.className = `feed-item feed-${type}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    feed.insertBefore(item, feed.firstChild);
    
    while (feed.children.length > 30) feed.removeChild(feed.lastChild);
}

// ══════════════════════════════════════════════════════════════
// CONTROL FUNCTIONS
// ══════════════════════════════════════════════════════════════

function togglePatrol() {
    if (state.patrolActive) {
        stopPatrol();
    } else {
        startPatrol();
    }
}

function stopPatrol() {
    state.patrolActive = false;
    Object.keys(state.animFrames).forEach(droneId => {
        if (state.animFrames[droneId]) {
            cancelAnimationFrame(state.animFrames[droneId]);
        }
    });
    
    const btn = document.getElementById('patrolBtn');
    if (btn) btn.textContent = '▶ Resume';
}

function resetPatrol() {
    stopPatrol();
    state.scannedShelves.clear();
    state.scanEvents = [];
    initializeDrones();
    
    const btn = document.getElementById('patrolBtn');
    if (btn) btn.textContent = '▶ Start Patrol';
    
    renderPatrolView(document.getElementById('dashboardContent'));
}

function showView(view) {
    const content = document.getElementById('dashboardContent');
    if (view === 'patrol') {
        renderPatrolView(content);
    }
}

// ══════════════════════════════════════════════════════════════
// SUMMARY REPORT
// ══════════════════════════════════════════════════════════════

function showSummaryReport() {
    const totalL1Shelves = WAREHOUSE.shelves.filter(s => s.layerIdx === 0).length;
    const scannedCount = state.scannedShelves.size;
    const coverage = totalL1Shelves > 0 ? (scannedCount / totalL1Shelves * 100) : 0;
    
    // 드론별 통계
    const droneStats = Object.keys(state.drones).map(droneId => {
        const drone = state.drones[droneId];
        return {
            id: droneId,
            dockId: drone.dockId,
            status: drone.status,
            battery: drone.battery.toFixed(1),
            scanned: drone.scannedCount || 0
        };
    });
    
    // Dock별 통계
    const dockStats = [1, 2, 3].map(dockId => {
        const dock = WAREHOUSE.docks.find(d => d.id === dockId);
        const dockDrones = droneStats.filter(d => d.dockId === dockId);
        const totalScanned = dockDrones.reduce((sum, d) => sum + d.scanned, 0);
        
        return {
            id: dockId,
            name: dock.name,
            color: dock.color,
            totalScanned: totalScanned,
            drones: dockDrones
        };
    });
    
    // Summary Card 생성
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
    `;
    
    modal.innerHTML = `
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                    border-radius: 16px; padding: 30px; max-width: 900px; width: 100%;
                    border: 1px solid rgba(99,102,241,0.3); box-shadow: 0 20px 60px rgba(0,0,0,0.5);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                <h2 style="font-size:1.5rem; color:#e2e8f0; margin:0;">📊 Multi-Drone Operation Summary</h2>
                <button onclick="this.closest('div').parentElement.remove()" 
                        style="background:rgba(248,113,113,0.15); border:1px solid rgba(248,113,113,0.3);
                               color:#f87171; padding:8px 16px; border-radius:8px; cursor:pointer; font-weight:700;">
                    ✕ Close
                </button>
            </div>
            
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px;">
                <div style="background:rgba(34,211,238,0.1); border:1px solid rgba(34,211,238,0.3); 
                            border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Total Scanned</div>
                    <div style="font-size:2rem; font-weight:800; color:#22d3ee;">${scannedCount}</div>
                    <div style="font-size:0.7rem; color:#64748b; margin-top:4px;">/ ${totalL1Shelves} shelves</div>
                </div>
                <div style="background:rgba(52,211,153,0.1); border:1px solid rgba(52,211,153,0.3); 
                            border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Coverage</div>
                    <div style="font-size:2rem; font-weight:800; color:#34d399;">${coverage.toFixed(1)}%</div>
                    <div style="font-size:0.7rem; color:#64748b; margin-top:4px;">Level 1 (Demo)</div>
                </div>
                <div style="background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); 
                            border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px;">Active Drones</div>
                    <div style="font-size:2rem; font-weight:800; color:#fbbf24;">${droneStats.filter(d => d.status === 'working').length}</div>
                    <div style="font-size:0.7rem; color:#64748b; margin-top:4px;">/ 9 total</div>
                </div>
            </div>
            
            <h3 style="font-size:1rem; color:#94a3b8; margin:20px 0 12px 0; font-weight:700;">Dock Performance</h3>
            
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
                ${dockStats.map(dock => `
                <div style="background:rgba(15,23,42,0.6); border:1px solid ${dock.color}33; 
                            border-left:3px solid ${dock.color}; border-radius:10px; padding:14px;">
                    <div style="font-weight:700; color:${dock.color}; font-size:0.9rem; margin-bottom:10px;">
                        ${dock.name}
                    </div>
                    <div style="font-size:0.7rem; color:#64748b; margin-bottom:8px;">
                        Total Scanned: <b style="color:#e2e8f0">${dock.totalScanned}</b>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${dock.drones.map(d => `
                        <div style="display:flex; justify-content:space-between; font-size:0.75rem; 
                                    padding:4px 8px; background:rgba(255,255,255,0.03); border-radius:6px;">
                            <span style="color:#94a3b8;">Drone ${d.id}</span>
                            <span style="color:${d.status === 'working' ? '#22d3ee' : d.status === 'charging' ? '#fbbf24' : '#64748b'}">
                                ${d.status === 'working' ? '🔵 Working' : d.status === 'charging' ? '🟡 Charging' : '⚪ Standby'}
                            </span>
                            <span style="color:#e2e8f0; font-weight:700;">${d.battery}%</span>
                        </div>
                        `).join('')}
                    </div>
                </div>
                `).join('')}
            </div>
            
            <div style="margin-top:24px; padding:16px; background:rgba(99,102,241,0.1); 
                        border:1px solid rgba(99,102,241,0.3); border-radius:10px;">
                <div style="font-size:0.8rem; color:#94a3b8; line-height:1.6;">
                    <b style="color:#a5b4fc;">📌 Demo Configuration:</b><br>
                    • Scanning Level 1 only (expandable to all 15 levels)<br>
                    • Battery: 27-minute cycle with 10% handover threshold<br>
                    • Navigation: Realistic aisle-to-aisle path (no overhead flight)<br>
                    • Path: Side A (top→bottom) → Side B (bottom→top) → Next aisle
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    showView('patrol');
});
