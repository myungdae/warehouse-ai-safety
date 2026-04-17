/* ============================================================
   Tethered Drone Inventory System (2 Docks, Wired Power)
   Samsung Semiconductor Warehouse
   
   Architecture:
   - 15 Aisles × 20 Racks × 15 Levels
   - 2 Docks: Dock A (Aisles 1-7), Dock B (Aisles 8-15)
   - Tethered (wired) power: No battery management
   - Simultaneous Side A + Side B scanning
   - Sequential aisle navigation (no cross-aisle flight)
   
   Level Pass Strategy (CORRECT):
   - PASS 1 (L1): Dock → all aisles (Rack 1~20, L1 only) → Return to Dock
   - PASS 2 (L2): Dock → all aisles (Rack 1~20, L2 only) → Return to Dock
   - ... → PASS N (L15) : complete
   - Each level is a FULL sweep before returning to dock
   ============================================================ */

'use strict';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

// All 15 levels — demo shows L1~L2 (first 2 passes)
const LAYERS = [
    { id: 'L1',  label: 'Level 1',  height_m:  0.5,  color: '#34d399' },
    { id: 'L2',  label: 'Level 2',  height_m:  1.5,  color: '#22d3ee' },
    { id: 'L3',  label: 'Level 3',  height_m:  2.5,  color: '#818cf8' },
    { id: 'L4',  label: 'Level 4',  height_m:  3.5,  color: '#f59e0b' },
    { id: 'L5',  label: 'Level 5',  height_m:  4.5,  color: '#f87171' },
    { id: 'L6',  label: 'Level 6',  height_m:  5.5,  color: '#a78bfa' },
    { id: 'L7',  label: 'Level 7',  height_m:  6.5,  color: '#34d399' },
    { id: 'L8',  label: 'Level 8',  height_m:  7.5,  color: '#22d3ee' },
    { id: 'L9',  label: 'Level 9',  height_m:  8.5,  color: '#818cf8' },
    { id: 'L10', label: 'Level 10', height_m:  9.5,  color: '#f59e0b' },
    { id: 'L11', label: 'Level 11', height_m: 10.5,  color: '#f87171' },
    { id: 'L12', label: 'Level 12', height_m: 11.5,  color: '#a78bfa' },
    { id: 'L13', label: 'Level 13', height_m: 12.5,  color: '#34d399' },
    { id: 'L14', label: 'Level 14', height_m: 13.5,  color: '#22d3ee' },
    { id: 'L15', label: 'Level 15', height_m: 14.5,  color: '#818cf8' },
];

// DEMO: show only first 2 level passes (L1, L2) for simulation speed
// In production this would be LAYERS (all 15)
const DEMO_LAYERS = LAYERS.slice(0, 2);

const WAREHOUSE = {
    width: 1400,
    height: 620,
    aisles: [],
    shelves: [],
    docks: [
        { 
            id: 'A', 
            name: 'Dock A (Top-Left)', 
            x: 65, y: 10, w: 50, h: 30,
            color: '#22d3ee',
            aisles: ['1','2','3','4','5','6','7']
        },
        { 
            id: 'B', 
            name: 'Dock B (Top-Right)', 
            x: 1285, y: 10, w: 50, h: 30,
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

// Generate Shelves (15 aisles × 20 racks × 15 levels × 2 sides)
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
    speed: 5.0,  // 적당한 이동 속도 (애니메이션 안정적)
    scanRadius: 40,
    scanDelay: 200,  // 스캔 딜레이 — 약 3분 순찰 완료
};

// ══════════════════════════════════════════════════════════════
// 스캔 필드 정의 (삼성 반도체 창고)
// ──────────────────────────────────────────────────────────────
// 삼성 요청: 모든 박스에서 PT번호를 읽어야 함
// DVC(K93KGD8J0C) 가 아닌 PT번호(PT64090302) 읽기
// Dock A / Dock B 구별 없이 전 구역 동일 적용
// ══════════════════════════════════════════════════════════════

// ── 스캔 필드 메타 (전 구역 통일) ────────────────────────────
const LABEL_FIELD_META = { fieldName: 'PT번호', fieldKey: 'pt_number', icon: '🔵', color: '#22d3ee' };

// ── PT번호 목록 (삼성 요청 기준) ─────────────────────────────
const WAFER_PT_LIST = [
    'PT64090302', 'PT64090303', 'PT64090304', 'PT64090305',
    'PT64090306', 'PT64090307', 'PT64090308', 'PT64090309',
    'PT64090310', 'PT64090311',
];

// ── 모든 구역에서 PT번호 반환 ────────────────────────────────
function getLabelTypeForAisle(_aisleId) {
    return 'WAFER';  // 전 구역 동일
}

function generateScanId(shelf) {
    const seed = Math.abs(shelf.id.charCodeAt(0) * 13 + shelf.rack * 7 + shelf.layerIdx * 3);
    return WAFER_PT_LIST[seed % WAFER_PT_LIST.length];
}

function buildInventory() {
    const db = {};
    WAREHOUSE.shelves.forEach(shelf => {
        const hasItem = Math.random() > 0.15;
        if (!hasItem) {
            db[shelf.id] = { sku: null, qty: 0 };
            return;
        }
        const ptNumber = generateScanId(shelf);
        db[shelf.id] = {
            sku: ptNumber,          // PT번호 (삼성 요청)
            scannedValue: ptNumber,
            qty: Math.floor(Math.random() * 15) + 5,
            location: `Aisle-${shelf.aisle} / Rack-${shelf.rack} / ${shelf.side === 'L' ? 'Side A' : 'Side B'} / ${shelf.layer}`
        };
    });
    return db;
}

function buildDay2Inventory(day1) {
    const day2 = JSON.parse(JSON.stringify(day1));
    const shelfIds = Object.keys(day2);
    
    // Simulate changes
    const changes = [];
    
    // Decrease quantity (10 shelves)
    for (let i = 0; i < 10; i++) {
        const id = shelfIds[Math.floor(Math.random() * shelfIds.length)];
        if (day2[id].qty > 0) {
            const oldQty = day2[id].qty;
            day2[id].qty = Math.max(0, oldQty - Math.floor(Math.random() * 5 + 1));
            changes.push({ type: 'decreased', shelfId: id, oldQty, newQty: day2[id].qty });
        }
    }
    
    // Increase quantity (5 shelves)
    for (let i = 0; i < 5; i++) {
        const id = shelfIds[Math.floor(Math.random() * shelfIds.length)];
        if (day2[id].sku) {
            const oldQty = day2[id].qty;
            day2[id].qty += Math.floor(Math.random() * 8 + 2);
            changes.push({ type: 'increased', shelfId: id, oldQty, newQty: day2[id].qty });
        }
    }
    
    // Missing items (3 shelves)
    for (let i = 0; i < 3; i++) {
        const id = shelfIds[Math.floor(Math.random() * shelfIds.length)];
        if (day2[id].qty > 0) {
            changes.push({ type: 'missing', shelfId: id, oldQty: day2[id].qty });
            day2[id].qty = 0;
            day2[id].sku = null;
        }
    }
    
    return { inventory: day2, changes };
}

const inventoryDay1 = buildInventory();
const day2Result = buildDay2Inventory(inventoryDay1);
const inventoryDay2 = day2Result.inventory;
const inventoryChanges = day2Result.changes;

function getCurrentInventory() {
    return state.currentDay === 1 ? inventoryDay1 : inventoryDay2;
}

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

const state = {
    view: 'patrol',  // 'patrol' | 'compare' | 'report'
    currentDay: 1,
    patrolActive: false,
    sessionId: null,          // ← 순찰 세션 ID (Edge DB 기록용)
    erpCompareResult: null,   // ← ERP 비교 결과 캐시
    drones: {
        A: { id: 'A', dockId: 'A', x: 90, y: 25, angle: 0, status: 'standby', currentAisle: null, currentLevel: null, path: [], pathIndex: 0, scannedCount: 0, isScanning: false },
        B: { id: 'B', dockId: 'B', x: 1310, y: 25, angle: 0, status: 'standby', currentAisle: null, currentLevel: null, path: [], pathIndex: 0, scannedCount: 0, isScanning: false },
    },
    scannedShelves: new Set(),
    scanEvents: [],
    scanEventsDay2: [],
    changeEvents: [],
    feedLog: [],
    svg: null,
    animFrames: {},
    _reportFired: false,   // ← 순찰 완료 보고서 중복 실행 방지
};

// ══════════════════════════════════════════════════════════════
// TASK BUILDER — Level-Pass Strategy (CORRECT)
//
// Real tethered drone operation:
//   PASS L1: Dock → Aisle1(Rack1~20,L1) → Aisle2 → ... → AisleN → Dock
//   PASS L2: Dock → Aisle1(Rack1~20,L2) → Aisle2 → ... → AisleN → Dock
//   ...
//   PASS L15: Dock → all aisles (L15) → Dock  ← complete
//
// Each PASS = one full sweep of all assigned aisles at ONE level only.
// The drone returns to dock between passes (cable management).
// ══════════════════════════════════════════════════════════════

function buildTaskQueue(dockId) {
    const dock = WAREHOUSE.docks.find(d => d.id === dockId);
    const tasks = [];

    // Iterate over each level PASS first (outer loop)
    DEMO_LAYERS.forEach((layer, levelIdx) => {

        // ── PASS START: Dock → first aisle entry (horizontal move at dock Y)
        tasks.push({
            type: 'level_pass_start',
            desc: `▶ Level Pass ${layer.id} (${layer.label}) — all aisles`,
            layerId: layer.id,
            levelIdx: levelIdx,
            x: dock.x + dock.w / 2,
            y: dock.y + dock.h / 2,
        });

        // ── Scan every assigned aisle at this level
        dock.aisles.forEach((aisleId, idx) => {
            const aisle = WAREHOUSE.aisles.find(a => a.id === aisleId);
            const aisleCenter = aisle.x + aisle.w / 2;
            const aisleTop    = aisle.y + 10;

            // 1. Move horizontally to aisle column (at dock height)
            tasks.push({
                type: 'move',
                desc: `[${layer.id}] Navigate to Aisle ${aisleId}`,
                x: aisleCenter,
                y: dock.y + dock.h / 2,
                straightLineOnly: true
            });

            // 2. Descend into aisle top
            tasks.push({
                type: 'move',
                desc: `[${layer.id}] Enter Aisle ${aisleId}`,
                x: aisleCenter,
                y: aisleTop,
                straightLineOnly: true
            });

            // 3. Scan Rack 1 → 20 at THIS LEVEL ONLY
            for (let rack = 1; rack <= 20; rack++) {
                const shelvesLeft = WAREHOUSE.shelves.filter(s =>
                    s.aisle === aisleId && s.side === 'L' &&
                    s.rack === rack && s.layerIdx === levelIdx
                );
                const shelvesRight = WAREHOUSE.shelves.filter(s =>
                    s.aisle === aisleId && s.side === 'R' &&
                    s.rack === rack && s.layerIdx === levelIdx
                );
                tasks.push({
                    type: 'scan',
                    aisleId: aisleId,
                    rack: rack,
                    layerId: layer.id,
                    levelIdx: levelIdx,
                    shelvesLeft:  shelvesLeft,
                    shelvesRight: shelvesRight,
                    x: aisleCenter,
                    y: aisle.y + 10 + (rack - 1) * 25 + 10,
                });
            }

            // 4. Return to aisle top after rack scan
            tasks.push({
                type: 'move',
                desc: `[${layer.id}] Exit Aisle ${aisleId}`,
                x: aisleCenter,
                y: aisleTop,
                straightLineOnly: true
            });
        });

        // ── PASS END: return to dock (horizontal at dock Y)
        // Move to dock column
        tasks.push({
            type: 'move',
            desc: `[${layer.id}] Return to dock column`,
            x: dock.x + dock.w / 2,
            y: dock.y + dock.h / 2 + 5,  // slight offset for visibility
            straightLineOnly: true
        });
        // Dock
        tasks.push({
            type: 'level_pass_end',
            desc: `✅ ${layer.id} Pass complete — returning to ${dock.name}`,
            layerId: layer.id,
            levelIdx: levelIdx,
            x: dock.x + dock.w / 2,
            y: dock.y + dock.h / 2,
        });
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
    state._reportFired = false;   // 매 순찰 시작마다 초기화

    // 순찰 세션 ID 생성 (Edge DB 저장용)
    const now = new Date();
    state.sessionId = `SES-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}-${Math.random().toString(36).substr(2,6).toUpperCase()}`;
    addFeed(`🔑 세션 시작: ${state.sessionId}`, 'system');
    
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
    state._reportFired = false;   // ← 리셋 시 플래그 초기화
    state.sessionId = null;

    // 배너 제거
    const oldBanner = document.getElementById('erpResultBanner');
    if (oldBanner) oldBanner.remove();

    // ERP 카드 초기화
    const erpCardVal = document.getElementById('erpCardVal');
    if (erpCardVal) { erpCardVal.textContent = 'Day1 vs Day2'; erpCardVal.style.color = '#fbbf24'; }
    const erpCardHint = document.getElementById('erpCardHint');
    if (erpCardHint) erpCardHint.textContent = '순찰 후 자동 비교';
    
    ['A', 'B'].forEach(dockId => {
        const drone = state.drones[dockId];
        const dock = WAREHOUSE.docks.find(d => d.id === dockId);
        drone.x = dock.x + dock.w / 2;
        drone.y = dock.y + dock.h / 2;
        drone.status = 'standby';
        drone.currentAisle = null;
        drone.currentLevel = null;
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
    
    // If currently scanning, don't move
    if (drone.isScanning) {
        state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));
        return;
    }
    
    if (drone.path.length > 0 && drone.pathIndex < drone.path.length) {
        const target = drone.path[drone.pathIndex];
        
        // For straight-line movement, move to targetX/targetY in two phases
        if (target.straightLineOnly) {
            // Phase 1: Move horizontally if X doesn't match
            if (Math.abs(drone.x - target.x) > 2) {
                drone.x += (target.x > drone.x ? 1 : -1) * DRONE_CONFIG.speed;
                drone.angle = target.x > drone.x ? 0 : 180;
            }
            // Phase 2: Move vertically if Y doesn't match
            else if (Math.abs(drone.y - target.y) > 2) {
                drone.y += (target.y > drone.y ? 1 : -1) * DRONE_CONFIG.speed;
                drone.angle = target.y > drone.y ? 90 : -90;
            }
            // Reached target
            else {
                drone.x = target.x;
                drone.y = target.y;
                if (target.desc) {
                    addFeed(`Drone ${droneId}: ${target.desc}`, 'system');
                }
                drone.pathIndex++;
            }
        } else {
            // Regular movement (for scan targets)
            const dx = target.x - drone.x;
            const dy = target.y - drone.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist < 2) {
                // Reached target
                if (target.type === 'scan') {
                    // Start scanning (async)
                    drone.isScanning = true;
                    processScanWithDelay(droneId, target, () => {
                        drone.isScanning = false;
                        drone.pathIndex++;
                    });
                } else if (target.type === 'move') {
                    if (target.desc) {
                        addFeed(`Drone ${droneId}: ${target.desc}`, 'system');
                    }
                    drone.pathIndex++;
                } else if (target.type === 'level_pass_start') {
                    drone.x = target.x;
                    drone.y = target.y;
                    drone.currentLevel = target.layerId;
                    updatePassBarStatus(target.layerId, 'active', 0);
                    addFeed(`Drone ${droneId}: ${target.desc}`, 'system');
                    drone.pathIndex++;
                } else if (target.type === 'level_pass_end') {
                    drone.x = target.x;
                    drone.y = target.y;
                    drone.currentLevel = null;
                    updatePassBarStatus(target.layerId, 'done', 100);
                    addFeed(`Drone ${droneId}: ${target.desc}`, 'success');
                    drone.pathIndex++;
                } else {
                    // Unknown task type — skip
                    drone.pathIndex++;
                }
            } else {
                // Move towards target
                drone.x += (dx / dist) * DRONE_CONFIG.speed;
                drone.y += (dy / dist) * DRONE_CONFIG.speed;
                drone.angle = Math.atan2(dy, dx) * 180 / Math.PI;
            }
        }
        
        // Check if all tasks completed
        if (drone.pathIndex >= drone.path.length) {
            drone.status = 'standby';
            addFeed(`✅ Drone ${droneId} patrol complete — ${drone.scannedCount} items scanned`, 'success');
            updateDroneElement(droneId);
            // Check if ALL drones are now standby → trigger auto-report (한 번만 실행 보장)
            const allDone = Object.values(state.drones).every(d => d.status === 'standby');
            if (allDone && state.patrolActive && !state._reportFired) {
                state._reportFired = true;   // ← 중복 실행 방지 플래그
                state.patrolActive = false;
                const btn = document.getElementById('patrolBtn');
                if (btn) btn.textContent = '▶ Start Patrol';
                // Auto-save report and notify MCP
                setTimeout(() => onPatrolComplete(), 800);
            }
            return;
        }
    }
    
    updateDroneElement(droneId);
    updateGlobalStats();
    
    // Continue loop
    state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));
}

async function processScanWithDelay(droneId, task, onComplete) {
    const drone = state.drones[droneId];
    const inv = getCurrentInventory();
    const scanTime = new Date().toLocaleTimeString('ko-KR');
    
    // Update current aisle
    drone.currentAisle = task.aisleId;
    
    // Step 1: Read Rack ID
    const rackId = `Aisle-${task.aisleId} / Rack-${task.rack}`;
    addFeed(`Drone ${droneId}: 📍 Reading Rack ID: ${rackId}`, 'system');
    await sleep(DRONE_CONFIG.scanDelay);
    
    // Update current level display at start of scan
    drone.currentLevel = task.layerId;
    updateDroneElement(droneId);
    
    // ── 선반 스캔 처리 함수 — 전 구역 PT번호 읽기 ──────────────
    async function scanShelf(shelf, side) {
        drone.currentLevel = shelf.layer;
        updateDroneElement(droneId);
        if (state.scannedShelves.has(shelf.id)) return;

        state.scannedShelves.add(shelf.id);
        const item = inv[shelf.id];
        const ptNumber = item?.sku || null;
        const qty = item?.qty || 0;
        const location = item?.location || `Aisle-${shelf.aisle} / Rack-${shelf.rack} / Side ${side} / ${shelf.layer}`;

        const event = {
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            droneId,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            rack: shelf.rack,
            side,
            layer: shelf.layer,
            sku: ptNumber,
            qty,
        };

        if (state.currentDay === 1) {
            state.scanEvents.push(event);
        } else {
            state.scanEventsDay2.push(event);
        }

        drone.scannedCount++;

        // ── Edge DB에 즉시 저장 (/api/scan/event) ────────────────
        if (state.sessionId) {
            fetch('/api/scan/event', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: state.sessionId,
                    drone_id:   droneId,
                    aisle:      shelf.aisle,
                    rack:       shelf.rack,
                    side:       side,
                    layer:      shelf.layer,
                    shelf_id:   shelf.id,
                    pt_number:  ptNumber,
                    qty:        qty,
                    location:   location,
                }),
            }).catch(() => { /* silent — edge저장 실패해도 UI 영향 없음 */ });
        }

        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', qty > 0 ? 'rgba(34,211,238,0.3)' : 'rgba(248,113,113,0.2)');
            shelfEl.setAttribute('stroke', qty > 0 ? '#22d3ee' : '#f87171');
            shelfEl.setAttribute('stroke-width', '2');
        }

        const scanMsg = qty > 0
            ? `🔵 PT번호: <b style="color:#22d3ee">${ptNumber}</b> × ${qty}`
            : `빈 선반 (Empty)`;
        addFeed(`Drone ${droneId}: 📦 Side ${side} ${shelf.layer} — ${scanMsg}`, 'scan');
        await sleep(DRONE_CONFIG.scanDelay / 2);
    }

    // Step 2: Scan Side A items
    for (let i = 0; i < task.shelvesLeft.length; i++) {
        await scanShelf(task.shelvesLeft[i], 'A');
    }
    
    // Step 3: Scan Side B items (L1, L2)
    for (let i = 0; i < task.shelvesRight.length; i++) {
        await scanShelf(task.shelvesRight[i], 'B');
    }
    
    // Step 4: Rack complete
    const totalItems = task.shelvesLeft.length + task.shelvesRight.length;
    const tag = task.isRescan ? ' [RE-SCAN]' : '';
    const layerLabel = task.layerId || drone.currentLevel || '?';
    addFeed(`Drone ${droneId}: ✅ Rack ${task.rack} [${layerLabel}] complete${tag} — ${totalItems}건 스캔 완료 | 🔵 PT번호 기준`, 'success');
    await sleep(DRONE_CONFIG.scanDelay);

    // If this was a re-scan task, mark it done in the compare view
    if (task.isRescan && task.originalShelfId) {
        markRescanDone(task.originalShelfId, droneId);
    }

    // Update level pass bar progress
    if (task.layerId) {
        updatePassBarProgress(task.layerId);
    }

    updateGlobalStats();
    onComplete();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
                <div style="width:200px;display:flex;flex-direction:column;gap:8px;padding:10px;background:rgba(15,23,42,0.8);border-radius:8px">
                    <!-- 스캔 기준 안내 (삼성 요청 — 전 구역 동일) -->
                    <div style="padding:8px;background:rgba(30,41,59,0.8);border-radius:6px;border:1px solid rgba(34,211,238,0.35)">
                        <div style="font-size:0.68rem;color:#22d3ee;font-weight:700;margin-bottom:6px">🏷️ 스캔 기준 (Dock A/B 전 구역)</div>
                        <div style="display:flex;align-items:flex-start;gap:6px;padding:6px;background:rgba(34,211,238,0.08);border-radius:4px;border-left:3px solid #22d3ee;font-size:0.62rem">
                            <span style="font-size:1rem;line-height:1.2">🔵</span>
                            <div>
                                <div style="color:#22d3ee;font-weight:700;margin-bottom:2px">PT번호 읽기</div>
                                <div style="color:#94a3b8">전체 Aisle 1 ~ 15</div>
                                <div style="color:#64748b;font-family:monospace;margin-top:3px">PT64090302<br>PT64090303 …</div>
                                <div style="color:#f87171;margin-top:4px;font-size:0.6rem">✗ DVC(K93KGD8J0C) 아님</div>
                            </div>
                        </div>
                    </div>
                    <!-- Level Pass Progress -->
                    <div style="padding:8px;background:rgba(30,41,59,0.8);border-radius:6px;border:1px solid rgba(99,102,241,0.2)">
                        <div style="font-size:0.7rem;color:#818cf8;font-weight:700;margin-bottom:4px">📊 Level Pass Progress</div>
                        <div id="levelPassBars" style="display:flex;flex-direction:column;gap:2px">
                            ${DEMO_LAYERS.map((layer, i) => `
                            <div style="display:flex;align-items:center;gap:4px;font-size:0.6rem">
                                <div style="width:28px;color:${layer.color};font-weight:700">${layer.id}</div>
                                <div style="flex:1;height:6px;background:rgba(30,41,59,0.8);border-radius:3px;overflow:hidden">
                                    <div id="passBar-${layer.id}" style="height:100%;width:0%;background:${layer.color};border-radius:3px;transition:width 0.3s"></div>
                                </div>
                                <div id="passStatus-${layer.id}" style="width:40px;color:#475569">waiting</div>
                            </div>`).join('')}
                        </div>
                    </div>
                    ${WAREHOUSE.docks.map(dock => `
                    <div class="dock-card" style="border-left:3px solid ${dock.color};padding:8px;background:rgba(15,23,42,0.5);border-radius:4px">
                        <div style="font-weight:700;color:${dock.color};font-size:0.8rem">${dock.name}</div>
                        <div style="font-size:0.65rem;color:#64748b;margin-top:4px">
                            <div>Drone: <span style="color:${dock.color}">${dock.id}</span></div>
                            <div>Aisles: ${dock.aisles.join(', ')}</div>
                            <div id="drone${dock.id}-aisle" style="color:#94a3b8">Current: -</div>
                            <div id="drone${dock.id}-level" style="color:#fbbf24;font-weight:600">Pass: -</div>
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
    
    // Render aisles — 전 구역 동일 색상 (PT번호 기준)
    WAREHOUSE.aisles.forEach(aisle => {
        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: 'rgba(34,211,238,0.03)', stroke: 'rgba(34,211,238,0.2)', 'stroke-width': '1', rx: '2'
        });
        aislesG.appendChild(rect);

        const label = createSVG('text', {
            x: aisle.x + aisle.w / 2, y: aisle.y - 5,
            fill: '#64748b', 'font-size': '8', 'text-anchor': 'middle'
        });
        label.textContent = aisle.label;
        aislesG.appendChild(label);
    });
    
    // Render shelves (L1, L2 only)
    const inv = getCurrentInventory();
    WAREHOUSE.shelves.forEach(shelf => {
        // Only render L1 and L2
        if (shelf.layerIdx >= 2) return;
        
        const item = inv[shelf.id];
        const hasItem = item && item.qty > 0;
        
        // Layer-based opacity and color
        const opacity = shelf.layerIdx === 0 ? 1.0 : 0.7;
        const layerColor = shelf.layer === 'L1' ? '#34d399' : '#22d3ee';
        
        const rect = createSVG('rect', {
            id: `shelf-${shelf.id}`,
            x: shelf.x, y: shelf.y, width: shelf.w, height: shelf.h,
            fill: hasItem ? `rgba(99,102,241,${0.1 * opacity})` : 'rgba(255,255,255,0.02)',
            stroke: hasItem ? `rgba(99,102,241,${0.3 * opacity})` : 'rgba(100,116,139,0.2)',
            'stroke-width': '1', rx: '2',
            opacity: opacity
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
    
    // Update current aisle
    const aisleEl = document.getElementById(`drone${droneId}-aisle`);
    if (aisleEl) {
        aisleEl.innerHTML = drone.currentAisle
            ? `Current: Aisle ${drone.currentAisle} <span style="color:#22d3ee">🔵PT</span>`
            : 'Current: -';
    }
    
    // Update current level with color (use layer's defined color)
    const levelEl = document.getElementById(`drone${droneId}-level`);
    if (levelEl) {
        if (drone.currentLevel) {
            const layerDef = LAYERS.find(l => l.id === drone.currentLevel);
            const levelColor = layerDef ? layerDef.color : '#fbbf24';
            levelEl.style.color = levelColor;
            const layerLabel = layerDef ? layerDef.label : drone.currentLevel;
            levelEl.textContent = `Pass: ${drone.currentLevel} (${layerLabel})`;
        } else {
            levelEl.style.color = '#64748b';
            levelEl.textContent = 'Pass: -';
        }
    }
}

function updateGlobalStats() {
    // Total shelves across all DEMO layers (L1+L2)
    const totalDemo = WAREHOUSE.shelves.filter(s => s.layerIdx < DEMO_LAYERS.length).length;
    const scanned = state.scannedShelves.size;
    const coverage = totalDemo > 0 ? (scanned / totalDemo * 100) : 0;
    
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
        rack: '#a78bfa',
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

// ── Level Pass Progress Bar updater ──────────────────────────
function updatePassBarStatus(layerId, status, pct) {
    const bar = document.getElementById(`passBar-${layerId}`);
    const label = document.getElementById(`passStatus-${layerId}`);
    const layerDef = LAYERS.find(l => l.id === layerId);
    const color = layerDef ? layerDef.color : '#818cf8';
    if (bar) {
        bar.style.width = pct + '%';
        if (status === 'done') {
            bar.style.background = '#34d399';
        } else if (status === 'active') {
            bar.style.background = color;
        }
    }
    if (label) {
        const texts = { active: '▶ run', done: '✅ done', waiting: 'waiting' };
        label.textContent = texts[status] || status;
        label.style.color = status === 'done' ? '#34d399' : status === 'active' ? color : '#475569';
    }
}

// ── Update pass bar progress during scanning ─────────────────
function updatePassBarProgress(layerId) {
    // Calculate how many shelves of this layer have been scanned
    const total = WAREHOUSE.shelves.filter(s => s.layer === layerId).length;
    if (total === 0) return;
    const scanned = [...state.scannedShelves].filter(id => id.endsWith(`-${layerId}`)).length;
    const pct = Math.round((scanned / total) * 100);
    const bar = document.getElementById(`passBar-${layerId}`);
    if (bar) bar.style.width = pct + '%';
}

// ══════════════════════════════════════════════════════════════
// RESCAN LOGIC
// ══════════════════════════════════════════════════════════════

// Parse shelfId like "2-L13-L2" → { aisleId:'2', side:'L', rack:13, layer:'L2' }
// or "14-R8-L2" → { aisleId:'14', side:'R', rack:8, layer:'L2' }
function parseShelfId(shelfId) {
    const m = shelfId.match(/^(\d+)-([LR])(\d+)-(.+)$/);
    if (!m) return null;
    return { aisleId: m[1], side: m[2], rack: parseInt(m[3]), layer: m[4] };
}

// Rescan state
const rescanStatus = {};   // shelfId → 'pending' | 'scanning' | 'done' | 'failed'
const rescanResults = {};  // shelfId → { before, after, droneId, timestamp, verdict }

function dispatchRescan(shelfId) {
    const parsed = parseShelfId(shelfId);
    if (!parsed) {
        addFeed(`⛔ Cannot parse shelf ID: ${shelfId}`, 'alert');
        return;
    }

    const { aisleId, rack } = parsed;

    // Pick the best drone: the one whose dock covers this aisle, preferably standby
    const dockForAisle = WAREHOUSE.docks.find(d => d.aisles.includes(aisleId));
    if (!dockForAisle) {
        addFeed(`⛔ No dock covers Aisle ${aisleId}`, 'alert');
        return;
    }

    // Choose drone from that dock (there's only 1 per dock in this system)
    const droneId = dockForAisle.id;
    const drone = state.drones[droneId];

    if (!drone) {
        addFeed(`⛔ Drone ${droneId} not found`, 'alert');
        return;
    }

    // Mark as pending
    rescanStatus[shelfId] = 'pending';
    refreshRescanCardUI(shelfId, 'pending');

    addFeed(`🔁 Re-scan dispatched → Drone ${droneId} → Aisle ${aisleId} / Rack ${rack}`, 'alert');

    // Capture BEFORE snapshot from current day2 inventory
    const invBefore = getCurrentInventory();
    const beforeSnap = {};
    WAREHOUSE.shelves
        .filter(s => s.aisle === aisleId && s.rack === rack && s.layerIdx < 2)
        .forEach(s => { beforeSnap[s.id] = { ...invBefore[s.id] }; });
    rescanResults[shelfId] = { before: beforeSnap, after: null, droneId, timestamp: new Date().toISOString(), verdict: 'scanning' };

    // Build a mini task queue: go to rack, scan, return to dock
    const aisle = WAREHOUSE.aisles.find(a => a.id === aisleId);
    const dock  = dockForAisle;
    const aisleCenter = aisle.x + aisle.w / 2;
    const aisleTop    = aisle.y + 10;
    const rackY       = aisle.y + 10 + (rack - 1) * 25 + 10;

    // Collect shelves for this rack (both sides, layers 0-1)
    const shelvesLeft  = WAREHOUSE.shelves.filter(s =>
        s.aisle === aisleId && s.side === 'L' && s.rack === rack && s.layerIdx < 2);
    const shelvesRight = WAREHOUSE.shelves.filter(s =>
        s.aisle === aisleId && s.side === 'R' && s.rack === rack && s.layerIdx < 2);

    const rescanTasks = [
        { type:'move', desc:`Re-scan: move to Aisle ${aisleId} entry`, x: aisleCenter, y: dock.y + dock.h / 2, straightLineOnly: true },
        { type:'move', desc:`Re-scan: enter Aisle ${aisleId}`, x: aisleCenter, y: aisleTop, straightLineOnly: true },
        { type:'move', desc:`Re-scan: position at Rack ${rack}`, x: aisleCenter, y: rackY, straightLineOnly: true },
        { type:'scan', aisleId, rack, shelvesLeft, shelvesRight, x: aisleCenter, y: rackY, isRescan: true, originalShelfId: shelfId },
        { type:'move', desc:`Re-scan: return to aisle top`, x: aisleCenter, y: aisleTop, straightLineOnly: true },
        { type:'move', desc:`Re-scan: return to dock`, x: dock.x + dock.w / 2, y: aisleTop, straightLineOnly: true },
        { type:'move', desc:`Re-scan: dock`, x: dock.x + dock.w / 2, y: dock.y + dock.h / 2, straightLineOnly: true },
    ];

    // Interrupt current patrol, prepend rescan tasks
    state.patrolActive = true;
    if (state.animFrames[droneId]) cancelAnimationFrame(state.animFrames[droneId]);

    drone.path = [...rescanTasks, ...drone.path.slice(drone.pathIndex)];
    drone.pathIndex = 0;
    drone.status = 'working';
    drone.isScanning = false;

    rescanStatus[shelfId] = 'scanning';
    refreshRescanCardUI(shelfId, 'scanning');

    // Restart drone loop
    state.animFrames[droneId] = requestAnimationFrame(() => droneLoop(droneId));

    // Switch back to patrol view so user can watch
    showPatrolView();
}

// Update the re-scan card badge in compare view (if visible)
function refreshRescanCardUI(shelfId, status) {
    const el = document.getElementById(`rescan-badge-${CSS.escape(shelfId)}`);
    if (!el) return;
    const cfg = {
        pending:  { bg:'#78350f', color:'#fbbf24', text:'⏳ Pending' },
        scanning: { bg:'#1e3a5f', color:'#22d3ee', text:'🔁 Scanning...' },
        done:     { bg:'#064e3b', color:'#34d399', text:'✅ Done' },
        failed:   { bg:'#7f1d1d', color:'#f87171', text:'❌ Failed' },
    };
    const c = cfg[status] || cfg.pending;
    el.style.background = c.bg;
    el.style.color = c.color;
    el.textContent = c.text;
}

// Called from processScanWithDelay when isRescan flag is set
function markRescanDone(shelfId, droneId) {
    rescanStatus[shelfId] = 'done';
    refreshRescanCardUI(shelfId, 'done');

    // Capture AFTER snapshot
    const invAfter = getCurrentInventory();
    const parsed   = parseShelfId(shelfId);
    if (parsed && rescanResults[shelfId]) {
        const afterSnap = {};
        WAREHOUSE.shelves
            .filter(s => s.aisle === parsed.aisleId && s.rack === parsed.rack && s.layerIdx < 2)
            .forEach(s => { afterSnap[s.id] = { ...invAfter[s.id] }; });

        // Determine verdict
        const before = rescanResults[shelfId].before;
        let verdict = 'confirmed_missing';   // default: still missing
        let foundItems = 0, missingItems = 0;
        Object.keys(afterSnap).forEach(sid => {
            const a = afterSnap[sid];
            const b = before[sid] || { qty: 0 };
            if (a && a.qty > 0) foundItems++;
            else missingItems++;
        });
        if (foundItems > 0 && missingItems === 0) verdict = 'all_found';
        else if (foundItems > 0) verdict = 'partial_found';
        else verdict = 'confirmed_missing';

        rescanResults[shelfId] = {
            ...rescanResults[shelfId],
            after:     afterSnap,
            droneId:   droneId,
            doneAt:    new Date().toISOString(),
            verdict,
            foundItems,
            missingItems,
        };
    }

    addFeed(`✅ Re-scan complete: ${shelfId} → ${_verdictLabel(rescanResults[shelfId]?.verdict)}`, 'success');

    // Refresh compare view badge if still open
    refreshRescanCardUI(shelfId, 'done');
    // Refresh the result detail if compare view is visible
    const detailEl = document.getElementById(`rescan-detail-${shelfId}`);
    if (detailEl) renderRescanResultDetail(shelfId, detailEl);
}

function _verdictLabel(v) {
    return { all_found:'✅ 재고 확인됨', partial_found:'⚠️ 일부 확인', confirmed_missing:'🚨 재고 없음 확인', scanning:'🔁 스캔 중' }[v] || v;
}

function renderRescanResultDetail(shelfId, el) {
    const r = rescanResults[shelfId];
    if (!r || !r.after) { el.innerHTML = '<span style="color:#64748b;font-size:0.75rem">스캔 중…</span>'; return; }
    const verdictColor = { all_found:'#34d399', partial_found:'#fbbf24', confirmed_missing:'#f87171' }[r.verdict] || '#94a3b8';
    const verdictText  = _verdictLabel(r.verdict);
    const doneTime     = r.doneAt ? new Date(r.doneAt).toLocaleTimeString('ko-KR') : '';

    // Build before/after comparison
    const allShelfIds  = [...new Set([...Object.keys(r.before), ...Object.keys(r.after)])];
    const rows = allShelfIds.map(sid => {
        const b = r.before[sid] || { sku: null, qty: 0 };
        const a = r.after[sid]  || { sku: null, qty: 0 };
        const changed = b.qty !== a.qty || b.sku !== a.sku;
        const parts = sid.split('-');  // e.g. "2-L13-L1"
        const sideLayer = parts.slice(1).join('-');
        let diff = '';
        if (!b.sku && a.sku)        diff = `<span style="color:#34d399">+입고 (${a.sku}×${a.qty})</span>`;
        else if (b.sku && !a.sku)   diff = `<span style="color:#f87171">소진 확인</span>`;
        else if (b.qty !== a.qty)   diff = `<span style="color:#fbbf24">${b.qty}→${a.qty}</span>`;
        else                        diff = `<span style="color:#475569">변화 없음</span>`;
        return `<div style="display:flex;justify-content:space-between;font-size:0.72rem;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:#64748b;font-family:monospace">${sideLayer}</span>
            <span style="color:#94a3b8">${b.sku || 'Empty'} ×${b.qty}</span>
            <span style="color:#475569">→</span>
            <span>${diff}</span>
        </div>`;
    }).join('');

    el.innerHTML = `
    <div style="margin-top:8px;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;border-left:3px solid ${verdictColor}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:700;font-size:0.8rem;color:${verdictColor}">${verdictText}</span>
            <span style="font-size:0.68rem;color:#475569">완료: ${doneTime}</span>
        </div>
        <div style="font-size:0.68rem;color:#64748b;margin-bottom:6px">드론 ${r.droneId} · 확인된 위치: ${r.foundItems}/${r.foundItems + r.missingItems}</div>
        <div style="margin-top:4px">${rows}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
// COMPARE VIEW
// ══════════════════════════════════════════════════════════════

function _buildCompareData() {
    const missing = [], decreased = [], increased = [], unchanged = [], needsRescan = [];
    Object.keys(inventoryDay1).forEach(shelfId => {
        const day1 = inventoryDay1[shelfId];
        const day2 = inventoryDay2[shelfId];
        if (day1.qty > 0 && day2.qty === 0) {
            missing.push({ shelfId, day1, day2 });
            needsRescan.push({ shelfId, reason: 'Missing item — physical verification required', severity: 'high' });
        } else if (day1.qty > day2.qty) {
            const delta = day1.qty - day2.qty;
            decreased.push({ shelfId, day1, day2, delta });
            if (delta > 5) needsRescan.push({ shelfId, reason: `Large decrease (−${delta}) — possible scan error`, severity: 'medium' });
        } else if (day1.qty < day2.qty) {
            increased.push({ shelfId, day1, day2, delta: day2.qty - day1.qty });
        } else if (day1.qty === day2.qty && day1.qty > 0) {
            unchanged.push({ shelfId, day1 });
        }
    });
    const totalItems  = Object.keys(inventoryDay1).length;
    const changedPct  = ((missing.length + decreased.length + increased.length) / totalItems * 100).toFixed(1);
    const accuracyRate = (100 - parseFloat(changedPct)).toFixed(1);
    return { missing, decreased, increased, unchanged, needsRescan, totalItems, changedPct, accuracyRate };
}

function showCompareView() {
    state.view = 'compare';
    const content = document.getElementById('dashboardContent');
    const { missing, decreased, increased, needsRescan, totalItems, accuracyRate } = _buildCompareData();

    // Count completed rescans
    const rescanDone    = Object.values(rescanStatus).filter(s => s === 'done').length;
    const rescanTotal   = Object.keys(rescanStatus).length;
    const rescanPending = rescanTotal - rescanDone;

    content.innerHTML = `
    <div style="background:rgba(15,23,42,0.8);border-radius:12px;padding:20px;border:1px solid rgba(99,102,241,0.2)">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div>
                <h2 style="color:#6366f1;font-size:1.2rem;margin:0">📊 ERP 비교 보고서 — Day 1 vs Day 2</h2>
                <div style="color:#64748b;font-size:0.75rem;margin-top:4px">Samsung Semiconductor Warehouse · 15 Aisles × 20 Racks × 15 Levels</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn-start" onclick="switchDay(1)">Day 1</button>
                <button class="btn-start" onclick="switchDay(2)">Day 2</button>
                <button class="btn-start" onclick="showDailyReportModal()" style="background:linear-gradient(135deg,#34d399,#059669)">📄 일일 종합보고서</button>
                <button class="btn-start" onclick="showPatrolView()">← 순찰 뷰로</button>
            </div>
        </div>

        <!-- Summary Cards -->
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:20px">
            <div style="background:rgba(99,102,241,0.1);border:1px solid #6366f1;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#6366f1;font-size:1.6rem;font-weight:700">${totalItems}</div>
                <div style="color:#94a3b8;font-size:0.7rem">총 위치</div>
            </div>
            <div style="background:rgba(248,113,113,0.1);border:1px solid #f87171;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#f87171;font-size:1.6rem;font-weight:700">${missing.length}</div>
                <div style="color:#94a3b8;font-size:0.7rem">분실</div>
            </div>
            <div style="background:rgba(251,191,36,0.1);border:1px solid #fbbf24;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#fbbf24;font-size:1.6rem;font-weight:700">${decreased.length}</div>
                <div style="color:#94a3b8;font-size:0.7rem">수량 감소</div>
            </div>
            <div style="background:rgba(52,211,153,0.1);border:1px solid #34d399;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#34d399;font-size:1.6rem;font-weight:700">${increased.length}</div>
                <div style="color:#94a3b8;font-size:0.7rem">수량 증가</div>
            </div>
            <div style="background:rgba(34,211,238,0.1);border:1px solid #22d3ee;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#22d3ee;font-size:1.6rem;font-weight:700">${accuracyRate}%</div>
                <div style="color:#94a3b8;font-size:0.7rem">정확도</div>
            </div>
            <div style="background:rgba(167,139,250,0.1);border:1px solid #a78bfa;border-radius:8px;padding:12px;text-align:center">
                <div style="color:#a78bfa;font-size:1.6rem;font-weight:700">${rescanDone}/${rescanTotal || '–'}</div>
                <div style="color:#94a3b8;font-size:0.7rem">재스캔 완료</div>
            </div>
        </div>

        <!-- Action Required (Re-scan Queue) -->
        ${needsRescan.length > 0 ? `
        <div style="background:rgba(251,191,36,0.08);border:2px solid #fbbf24;border-radius:8px;padding:15px;margin-bottom:20px">
            <h3 style="color:#fbbf24;font-size:0.95rem;margin-bottom:10px;display:flex;align-items:center;gap:8px">
                ⚠️ 재스캔 필요 — ${needsRescan.length}개 위치
                <span style="font-size:0.72rem;color:#94a3b8;font-weight:400">🔁 클릭하면 드론 즉시 출동</span>
            </h3>
            <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
                ${needsRescan.map(item => `
                <div id="rescan-row-${item.shelfId}" style="background:rgba(0,0,0,0.25);padding:10px 14px;border-radius:6px;border-left:3px solid ${item.severity === 'high' ? '#f87171' : '#fbbf24'};display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                    <div style="flex:1;min-width:0">
                        <div style="font-size:0.82rem;color:#e2e8f0;font-weight:700;font-family:monospace">${item.shelfId}</div>
                        <div style="font-size:0.7rem;color:#94a3b8;margin-top:2px">
                            ${item.reason}
                            <span style="background:${item.severity === 'high' ? '#7f1d1d' : '#78350f'};padding:1px 6px;border-radius:3px;margin-left:6px;font-size:0.65rem;color:${item.severity === 'high' ? '#fca5a5' : '#fde68a'}">${item.severity.toUpperCase()}</span>
                        </div>
                        <!-- Rescan Result Detail (injected after rescan) -->
                        <div id="rescan-detail-${item.shelfId}"></div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-top:2px">
                        <span id="rescan-badge-${item.shelfId}" style="background:#78350f;color:#fbbf24;padding:3px 10px;border-radius:4px;font-size:0.68rem;font-weight:700;white-space:nowrap">⏸ 대기</span>
                        <button onclick="dispatchRescan('${item.shelfId}')"
                            style="background:linear-gradient(135deg,#6366f1,#22d3ee);color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700;white-space:nowrap;transition:transform 0.15s"
                            onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                            🔁 재스캔
                        </button>
                    </div>
                </div>
                `).join('')}
            </div>
        </div>
        ` : `<div style="background:rgba(52,211,153,0.08);border:1px solid #34d399;border-radius:8px;padding:12px;margin-bottom:20px;text-align:center;color:#34d399;font-size:0.85rem">✅ 모든 위치 정상 — 재스캔 필요 없음</div>`}

        <!-- Rescan Results Summary (shown only if rescan was done) -->
        ${rescanTotal > 0 ? `
        <div id="rescanResultsSection" style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.4);border-radius:8px;padding:15px;margin-bottom:20px">
            <h3 style="color:#a78bfa;font-size:0.95rem;margin-bottom:12px">🔁 재스캔 결과 요약</h3>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
                <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px;text-align:center">
                    <div style="color:#34d399;font-size:1.4rem;font-weight:700">${Object.values(rescanResults).filter(r=>r.verdict==='all_found').length}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">✅ 재고 확인됨</div>
                </div>
                <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px;text-align:center">
                    <div style="color:#fbbf24;font-size:1.4rem;font-weight:700">${Object.values(rescanResults).filter(r=>r.verdict==='partial_found').length}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">⚠️ 일부 확인</div>
                </div>
                <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px;text-align:center">
                    <div style="color:#f87171;font-size:1.4rem;font-weight:700">${Object.values(rescanResults).filter(r=>r.verdict==='confirmed_missing').length}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">🚨 재고 없음 확인</div>
                </div>
            </div>
            ${Object.keys(rescanResults).map(shelfId => {
                const r = rescanResults[shelfId];
                if (!r || !r.after) return '';
                const vColor = { all_found:'#34d399', partial_found:'#fbbf24', confirmed_missing:'#f87171' }[r.verdict] || '#94a3b8';
                const vText  = _verdictLabel(r.verdict);
                const doneTime = r.doneAt ? new Date(r.doneAt).toLocaleString('ko-KR') : '';
                return `
                <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:12px;margin-bottom:8px;border-left:3px solid ${vColor}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                        <span style="font-family:monospace;font-size:0.82rem;color:#e2e8f0;font-weight:700">${shelfId}</span>
                        <div style="display:flex;align-items:center;gap:10px">
                            <span style="font-size:0.78rem;font-weight:700;color:${vColor}">${vText}</span>
                            <span style="font-size:0.68rem;color:#475569">드론 ${r.droneId} · ${doneTime}</span>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                        <div style="background:rgba(248,113,113,0.06);border-radius:4px;padding:8px">
                            <div style="font-size:0.65rem;color:#94a3b8;margin-bottom:4px;font-weight:600">재스캔 전 (Day 2)</div>
                            ${Object.keys(r.before).map(sid => {
                                const b = r.before[sid];
                                return `<div style="font-size:0.7rem;color:#cbd5e1;font-family:monospace">${sid.split('-').slice(1).join('-')}: ${b.sku || 'Empty'} ×${b.qty}</div>`;
                            }).join('')}
                        </div>
                        <div style="background:rgba(52,211,153,0.06);border-radius:4px;padding:8px">
                            <div style="font-size:0.65rem;color:#94a3b8;margin-bottom:4px;font-weight:600">재스캔 후 (결과)</div>
                            ${Object.keys(r.after).map(sid => {
                                const a = r.after[sid];
                                const b = (r.before[sid] || { qty: 0 });
                                const diffColor = a.qty > b.qty ? '#34d399' : a.qty < b.qty ? '#f87171' : '#94a3b8';
                                return `<div style="font-size:0.7rem;color:${diffColor};font-family:monospace">${sid.split('-').slice(1).join('-')}: ${a.sku || 'Empty'} ×${a.qty}</div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </div>
        ` : ''}

        <!-- Detailed Changes Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:20px">
            <!-- Missing Items -->
            <div style="background:rgba(15,23,42,0.5);border-radius:8px;padding:15px;border:1px solid rgba(248,113,113,0.3)">
                <h3 style="color:#f87171;font-size:0.9rem;margin-bottom:10px">🚨 분실 항목 (${missing.length})</h3>
                <div style="max-height:250px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                    ${missing.slice(0, 15).map(item => `
                    <div style="background:rgba(248,113,113,0.05);border-left:3px solid #f87171;padding:8px;border-radius:4px">
                        <div style="font-size:0.78rem;color:#e2e8f0;font-weight:600;font-family:monospace">${item.shelfId}</div>
                        <div style="font-size:0.68rem;color:#64748b;margin-top:2px">${item.day1.location || ''}</div>
                        <div style="font-size:0.72rem;color:#94a3b8;margin-top:3px">
                            Day1: <span style="color:#e2e8f0">${item.day1.sku} ×${item.day1.qty}</span>
                            → Day2: <span style="color:#f87171;font-weight:600">MISSING</span>
                        </div>
                    </div>`).join('')}
                    ${missing.length > 15 ? `<div style="text-align:center;color:#64748b;font-size:0.72rem;padding:4px">+${missing.length-15}개 더…</div>` : ''}
                </div>
            </div>
            <!-- Decreased Items -->
            <div style="background:rgba(15,23,42,0.5);border-radius:8px;padding:15px;border:1px solid rgba(251,191,36,0.3)">
                <h3 style="color:#fbbf24;font-size:0.9rem;margin-bottom:10px">📉 수량 감소 (${decreased.length})</h3>
                <div style="max-height:250px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                    ${decreased.slice(0, 15).map(item => `
                    <div style="background:rgba(251,191,36,0.05);border-left:3px solid #fbbf24;padding:8px;border-radius:4px">
                        <div style="font-size:0.78rem;color:#e2e8f0;font-weight:600;font-family:monospace">${item.shelfId}</div>
                        <div style="font-size:0.68rem;color:#64748b;margin-top:2px">${item.day1.sku}</div>
                        <div style="font-size:0.72rem;color:#94a3b8;margin-top:3px">
                            ${item.day1.qty} → ${item.day2.qty} <span style="color:#fbbf24;font-weight:600">(−${item.delta})</span>
                        </div>
                    </div>`).join('')}
                    ${decreased.length > 15 ? `<div style="text-align:center;color:#64748b;font-size:0.72rem;padding:4px">+${decreased.length-15}개 더…</div>` : ''}
                </div>
            </div>
        </div>

        <!-- Export / Save Actions -->
        <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
            <button class="btn-start" onclick="exportReport('rescan')">📋 재스캔 목록 내보내기</button>
            <button class="btn-start" onclick="exportReport('full')">📊 전체 보고서 내보내기</button>
            <button onclick="runErpCompare()"
                style="background:linear-gradient(135deg,#22d3ee,#6366f1);color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:700;transition:transform 0.15s"
                onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                🏭 Edge ERP 비교 실행
            </button>
            ${state.erpCompareResult ? `<button onclick="showErpCompareModal()" style="background:rgba(34,211,238,0.15);color:#22d3ee;border:1px solid rgba(34,211,238,0.4);padding:8px 18px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600">📊 ERP 비교 결과 보기</button>` : ''}
            <button class="btn-start" onclick="sendToERP()">🔄 Samsung ERP 전송</button>
            <button onclick="showDailyReportModal()"
                style="background:linear-gradient(135deg,#34d399,#059669);color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:700;transition:transform 0.15s"
                onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                📄 일일 종합보고서 생성 & 저장
            </button>
        </div>
    </div>

    <!-- Daily Report Modal -->
    <div id="dailyReportModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;overflow-y:auto;padding:20px">
        <div style="max-width:900px;margin:0 auto;background:#0f172a;border-radius:16px;border:1px solid rgba(99,102,241,0.4);overflow:hidden">
            <div id="dailyReportContent"></div>
        </div>
    </div>
    `;
}

// ══════════════════════════════════════════════════════════════
// DAILY REPORT MODAL
// ══════════════════════════════════════════════════════════════

function showDailyReportModal() {
    const modal = document.getElementById('dailyReportModal');
    if (!modal) return;
    modal.style.display = 'block';

    const { missing, decreased, increased, unchanged, needsRescan, totalItems, accuracyRate } = _buildCompareData();

    const now       = new Date();
    const dateStr   = now.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' });
    const timeStr   = now.toLocaleTimeString('ko-KR');
    const reportId  = `RPT-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}`;

    const totalScanned   = (state.scanEvents.length + state.scanEventsDay2.length);
    const rescanDone     = Object.values(rescanStatus).filter(s => s === 'done').length;
    const rescanTotal    = Object.keys(rescanStatus).length;
    const allFound       = Object.values(rescanResults).filter(r => r.verdict === 'all_found').length;
    const partialFound   = Object.values(rescanResults).filter(r => r.verdict === 'partial_found').length;
    const confirmedMiss  = Object.values(rescanResults).filter(r => r.verdict === 'confirmed_missing').length;

    // AI Recommendations
    const recommendations = [];
    if (confirmedMiss > 0)  recommendations.push({ level:'🔴 긴급', text:`${confirmedMiss}개 위치에서 재고 없음 확인 → 물리적 현장 점검 즉시 실시` });
    if (partialFound > 0)   recommendations.push({ level:'🟡 주의', text:`${partialFound}개 위치 일부만 확인 → 추가 재스캔 또는 수동 검증 필요` });
    if (missing.length > confirmedMiss) {
        const unscanned = missing.length - confirmedMiss;
        recommendations.push({ level:'🟡 주의', text:`${unscanned}개 분실 위치 미재스캔 → 순찰 후 재확인 권장` });
    }
    if (decreased.filter(d => d.delta > 5).length > 0)
        recommendations.push({ level:'🟠 권고', text:`대량 감소(−5 초과) ${decreased.filter(d=>d.delta>5).length}건 → 출고 기록과 대조 확인` });
    if (parseFloat(accuracyRate) >= 95)
        recommendations.push({ level:'🟢 양호', text:`재고 정확도 ${accuracyRate}% — 현재 운영 상태 우수` });

    // Top changed SKUs
    const skuChanges = {};
    [...missing, ...decreased].forEach(({ shelfId, day1, delta }) => {
        const sku = day1.sku || 'Unknown';
        if (!skuChanges[sku]) skuChanges[sku] = { missing: 0, decreased: 0, totalLoss: 0 };
        if (!delta) { skuChanges[sku].missing++; skuChanges[sku].totalLoss += (day1.qty || 0); }
        else        { skuChanges[sku].decreased++; skuChanges[sku].totalLoss += delta; }
    });
    const topSKUs = Object.entries(skuChanges).sort((a,b) => b[1].totalLoss - a[1].totalLoss).slice(0, 5);

    const reportHTML = `
    <!-- Report Header -->
    <div style="background:linear-gradient(135deg,rgba(99,102,241,0.3),rgba(34,211,238,0.2));padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
            <div>
                <div style="font-size:0.75rem;color:#22d3ee;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px">Samsung Semiconductor · 자동화 창고 드론 순찰 시스템</div>
                <h1 style="color:#fff;font-size:1.6rem;font-weight:800;margin:0">📋 일일 재고 종합 보고서</h1>
                <div style="color:#94a3b8;font-size:0.85rem;margin-top:6px">${dateStr} ${timeStr} 기준</div>
            </div>
            <div style="text-align:right">
                <div style="font-size:0.7rem;color:#64748b;margin-bottom:4px">보고서 ID</div>
                <div style="font-family:monospace;color:#a78bfa;font-size:0.95rem;font-weight:700">${reportId}</div>
                <div style="font-size:0.7rem;color:#64748b;margin-top:8px">드론 편대</div>
                <div style="color:#22d3ee;font-size:0.85rem">Drone A · Drone B</div>
            </div>
        </div>
        <!-- KPI Row -->
        <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px">
            ${[
                { v: totalItems,     l: '총 위치',     c: '#6366f1' },
                { v: totalScanned,   l: '스캔 건수',   c: '#22d3ee' },
                { v: accuracyRate+'%', l: '재고 정확도', c: parseFloat(accuracyRate)>=95?'#34d399':'#fbbf24' },
                { v: missing.length, l: '분실',         c: '#f87171' },
                { v: decreased.length,l: '수량 감소',  c: '#fbbf24' },
                { v: `${rescanDone}/${rescanTotal||0}`, l: '재스캔 완료', c: '#a78bfa' },
            ].map(k => `
            <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(255,255,255,0.07)">
                <div style="color:${k.c};font-size:1.5rem;font-weight:800">${k.v}</div>
                <div style="color:#64748b;font-size:0.65rem;margin-top:3px">${k.l}</div>
            </div>`).join('')}
        </div>
    </div>

    <!-- Body -->
    <div style="padding:24px 32px;display:flex;flex-direction:column;gap:24px">

        <!-- 1. AI 권고 사항 -->
        <section>
            <h2 style="color:#a78bfa;font-size:0.95rem;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">
                🤖 AI 분석 & 권고 사항
            </h2>
            <div style="display:flex;flex-direction:column;gap:8px">
                ${recommendations.length > 0
                    ? recommendations.map(r => `
                    <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:12px;border:1px solid rgba(255,255,255,0.05)">
                        <span style="font-size:0.95rem;flex-shrink:0">${r.level}</span>
                        <span style="color:#cbd5e1;font-size:0.82rem">${r.text}</span>
                    </div>`).join('')
                    : '<div style="color:#34d399;font-size:0.82rem;padding:10px">✅ 이상 사항 없음 — 모든 재고 정상</div>'}
            </div>
        </section>

        <!-- 2. 재스캔 결과 상세 -->
        ${rescanTotal > 0 ? `
        <section>
            <h2 style="color:#22d3ee;font-size:0.95rem;font-weight:700;margin-bottom:12px">🔁 재스캔 수행 결과</h2>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
                <div style="background:rgba(52,211,153,0.1);border:1px solid #34d399;border-radius:8px;padding:12px;text-align:center">
                    <div style="color:#34d399;font-size:1.4rem;font-weight:800">${allFound}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">✅ 재고 확인됨</div>
                </div>
                <div style="background:rgba(251,191,36,0.1);border:1px solid #fbbf24;border-radius:8px;padding:12px;text-align:center">
                    <div style="color:#fbbf24;font-size:1.4rem;font-weight:800">${partialFound}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">⚠️ 일부 확인</div>
                </div>
                <div style="background:rgba(248,113,113,0.1);border:1px solid #f87171;border-radius:8px;padding:12px;text-align:center">
                    <div style="color:#f87171;font-size:1.4rem;font-weight:800">${confirmedMiss}</div>
                    <div style="color:#94a3b8;font-size:0.7rem">🚨 재고 없음 확인</div>
                </div>
            </div>
            ${Object.keys(rescanResults).map(shelfId => {
                const r = rescanResults[shelfId];
                if (!r || !r.after) return `<div style="color:#64748b;font-size:0.8rem;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;margin-bottom:6px">🔁 ${shelfId} — 스캔 중 또는 미완료</div>`;
                const vColor = { all_found:'#34d399', partial_found:'#fbbf24', confirmed_missing:'#f87171' }[r.verdict] || '#94a3b8';
                const vText  = _verdictLabel(r.verdict);
                const doneTime = r.doneAt ? new Date(r.doneAt).toLocaleString('ko-KR') : '–';
                // Build before/after rows
                const allSids = [...new Set([...Object.keys(r.before), ...Object.keys(r.after)])];
                return `
                <div style="background:rgba(0,0,0,0.2);border-radius:8px;border-left:4px solid ${vColor};padding:14px;margin-bottom:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                        <span style="font-family:monospace;font-size:0.85rem;color:#e2e8f0;font-weight:700">${shelfId}</span>
                        <div style="display:flex;align-items:center;gap:12px">
                            <span style="font-weight:700;font-size:0.82rem;color:${vColor}">${vText}</span>
                            <span style="font-size:0.7rem;color:#475569">드론 ${r.droneId} · 완료: ${doneTime}</span>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:start;font-size:0.75rem">
                        <div>
                            <div style="color:#94a3b8;font-weight:600;margin-bottom:4px;font-size:0.65rem">재스캔 전</div>
                            ${allSids.map(sid => {
                                const b = r.before[sid] || { sku:null, qty:0 };
                                return `<div style="color:#94a3b8;font-family:monospace;padding:2px 0">${sid.split('-').slice(1).join('-')}: ${b.sku || '빈 칸'} ×${b.qty}</div>`;
                            }).join('')}
                        </div>
                        <div style="color:#475569;align-self:center;font-size:1.2rem">→</div>
                        <div>
                            <div style="color:#94a3b8;font-weight:600;margin-bottom:4px;font-size:0.65rem">재스캔 후</div>
                            ${allSids.map(sid => {
                                const a = r.after[sid]  || { sku:null, qty:0 };
                                const b = r.before[sid] || { qty:0 };
                                const dc = a.qty > b.qty ? '#34d399' : a.qty < b.qty ? '#f87171' : '#94a3b8';
                                return `<div style="color:${dc};font-family:monospace;padding:2px 0">${sid.split('-').slice(1).join('-')}: ${a.sku || '빈 칸'} ×${a.qty}</div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>`;
            }).join('')}
        </section>
        ` : `<section><div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;color:#64748b;font-size:0.82rem;text-align:center">이번 순찰에서 재스캔이 수행되지 않았습니다.</div></section>`}

        <!-- 3. 변동 내역 -->
        <section>
            <h2 style="color:#fbbf24;font-size:0.95rem;font-weight:700;margin-bottom:12px">📊 재고 변동 내역</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
                <!-- Missing -->
                <div style="background:rgba(248,113,113,0.07);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:12px">
                    <div style="color:#f87171;font-weight:700;font-size:0.85rem;margin-bottom:8px">🚨 분실 (${missing.length}건)</div>
                    ${missing.map(i => `
                    <div style="font-size:0.7rem;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#94a3b8">
                        <span style="font-family:monospace;color:#e2e8f0">${i.shelfId}</span><br>
                        ${i.day1.sku} ×${i.day1.qty} → <span style="color:#f87171">MISSING</span>
                    </div>`).join('')}
                </div>
                <!-- Decreased -->
                <div style="background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:12px">
                    <div style="color:#fbbf24;font-weight:700;font-size:0.85rem;margin-bottom:8px">📉 감소 (${decreased.length}건)</div>
                    ${decreased.slice(0,10).map(i => `
                    <div style="font-size:0.7rem;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#94a3b8">
                        <span style="font-family:monospace;color:#e2e8f0">${i.shelfId}</span><br>
                        ${i.day1.qty} → ${i.day2.qty} <span style="color:#fbbf24">(−${i.delta})</span>
                    </div>`).join('')}
                    ${decreased.length > 10 ? `<div style="color:#64748b;font-size:0.68rem;margin-top:6px">+${decreased.length-10}건 더</div>` : ''}
                </div>
                <!-- Increased -->
                <div style="background:rgba(52,211,153,0.07);border:1px solid rgba(52,211,153,0.3);border-radius:8px;padding:12px">
                    <div style="color:#34d399;font-weight:700;font-size:0.85rem;margin-bottom:8px">📈 증가 (${increased.length}건)</div>
                    ${increased.slice(0,10).map(i => `
                    <div style="font-size:0.7rem;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04);color:#94a3b8">
                        <span style="font-family:monospace;color:#e2e8f0">${i.shelfId}</span><br>
                        ${i.day1.qty} → ${i.day2.qty} <span style="color:#34d399">(+${i.delta})</span>
                    </div>`).join('')}
                    ${increased.length > 10 ? `<div style="color:#64748b;font-size:0.68rem;margin-top:6px">+${increased.length-10}건 더</div>` : ''}
                </div>
            </div>
        </section>

        <!-- 4. 주요 SKU 이상 -->
        ${topSKUs.length > 0 ? `
        <section>
            <h2 style="color:#f87171;font-size:0.95rem;font-weight:700;margin-bottom:12px">🏷️ 주요 이상 SKU Top ${topSKUs.length}</h2>
            <div style="display:flex;flex-direction:column;gap:6px">
                ${topSKUs.map(([sku, data], idx) => `
                <div style="background:rgba(0,0,0,0.2);border-radius:6px;padding:10px 14px;display:grid;grid-template-columns:auto 1fr auto auto auto;gap:12px;align-items:center;border:1px solid rgba(255,255,255,0.05)">
                    <span style="background:rgba(99,102,241,0.3);color:#a78bfa;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700">${idx+1}</span>
                    <span style="font-family:monospace;color:#e2e8f0;font-weight:600;font-size:0.82rem">${sku}</span>
                    <span style="font-size:0.72rem;color:#f87171">${data.missing > 0 ? `분실 ${data.missing}건` : ''}</span>
                    <span style="font-size:0.72rem;color:#fbbf24">${data.decreased > 0 ? `감소 ${data.decreased}건` : ''}</span>
                    <span style="background:rgba(248,113,113,0.2);color:#f87171;padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:700">−${data.totalLoss} units</span>
                </div>`).join('')}
            </div>
        </section>
        ` : ''}

        <!-- 5. 드론 운영 요약 -->
        <section>
            <h2 style="color:#22d3ee;font-size:0.95rem;font-weight:700;margin-bottom:12px">🚁 드론 운영 현황</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                ${WAREHOUSE.docks.map(dock => {
                    const droneData = state.drones[dock.id];
                    return `
                    <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:14px;border:1px solid rgba(34,211,238,0.2)">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                            <span style="color:#22d3ee;font-weight:700;font-size:0.88rem">Drone ${dock.id}</span>
                            <span style="background:rgba(52,211,153,0.2);color:#34d399;padding:2px 8px;border-radius:4px;font-size:0.7rem">${droneData?.status === 'standby' ? '✅ 완료' : '🔄 운영 중'}</span>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.75rem">
                            <div><span style="color:#64748b">담당 구역:</span><br><span style="color:#cbd5e1">Aisle ${dock.aisles.join(', ')}</span></div>
                            <div><span style="color:#64748b">스캔 건수:</span><br><span style="color:#22d3ee">${droneData?.scannedCount || 0}건</span></div>
                            <div><span style="color:#64748b">도킹 위치:</span><br><span style="color:#cbd5e1">${dock.name}</span></div>
                            <div><span style="color:#64748b">전원:</span><br><span style="color:#34d399">유선 (100%)</span></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </section>

        <!-- Footer Buttons -->
        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);flex-wrap:wrap">
            <button onclick="closeDailyReportModal()" style="background:rgba(100,116,139,0.3);color:#94a3b8;border:1px solid rgba(100,116,139,0.4);padding:9px 20px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600">✕ 닫기</button>
            <button onclick="printDailyReport()" style="background:rgba(34,211,238,0.15);color:#22d3ee;border:1px solid rgba(34,211,238,0.4);padding:9px 20px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600">🖨️ 인쇄</button>
            <button onclick="exportDailyReportJSON('${reportId}')" style="background:rgba(99,102,241,0.15);color:#a78bfa;border:1px solid rgba(99,102,241,0.4);padding:9px 20px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600">⬇️ JSON 내보내기</button>
            <button onclick="saveDailyReport('${reportId}')"
                style="background:linear-gradient(135deg,#34d399,#059669);color:#fff;border:none;padding:9px 24px;border-radius:8px;cursor:pointer;font-size:0.84rem;font-weight:700;transition:transform 0.15s"
                onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
                💾 보고서 저장 (Report DB)
            </button>
        </div>
    </div>`;

    document.getElementById('dailyReportContent').innerHTML = reportHTML;
}

function closeDailyReportModal() {
    const m = document.getElementById('dailyReportModal');
    if (m) m.style.display = 'none';
}

function printDailyReport() {
    const content = document.getElementById('dailyReportContent');
    if (!content) return;
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>일일 종합보고서</title>
    <style>
        body { background:#0f172a; color:#e2e8f0; font-family:'Segoe UI',sans-serif; padding:20px; }
        * { box-sizing:border-box; }
        @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
    </style></head><body>${content.innerHTML}
    <script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
}

function exportDailyReportJSON(reportId) {
    const { missing, decreased, increased, totalItems, accuracyRate } = _buildCompareData();
    const now = new Date();
    const report = {
        report_id: reportId,
        date: now.toLocaleDateString('ko-KR'),
        time: now.toLocaleTimeString('ko-KR'),
        warehouse: 'Samsung Semiconductor Warehouse',
        drone_id: 'Drone-A & Drone-B',
        total_locations: totalItems,
        total_scanned: state.scanEvents.length + state.scanEventsDay2.length,
        accuracy: parseFloat(accuracyRate),
        missing: missing.length,
        decreased: decreased.length,
        increased: increased.length,
        rescan_total: Object.keys(rescanStatus).length,
        rescan_done: Object.values(rescanStatus).filter(s=>s==='done').length,
        rescan_results: rescanResults,
        changes: inventoryChanges,
        feed_log: state.feedLog.slice(0, 100),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${reportId}.json`;
    a.click();
    addFeed(`⬇️ 보고서 JSON 내보내기 완료: ${reportId}`, 'success');
}

async function saveDailyReport(reportId) {
    const { missing, decreased, increased, totalItems, accuracyRate, needsRescan } = _buildCompareData();
    const now = new Date();
    const btnEls = document.querySelectorAll('[onclick*="saveDailyReport"]');
    btnEls.forEach(b => { b.disabled = true; b.textContent = '⏳ 저장 중…'; });

    const report = {
        report_id: reportId,
        date: now.toLocaleDateString('ko-KR'),
        time: now.toLocaleTimeString('ko-KR'),
        warehouse: 'Samsung-Warehouse-15A',
        drone_id: 'Drone-A/B',
        total_scanned: state.scanEvents.length + state.scanEventsDay2.length,
        accuracy: parseFloat(accuracyRate),
        total_changes: missing.length + decreased.length + increased.length,
        agent_actions: Object.keys(rescanStatus).length,
        missing: missing.length,
        new_items: increased.length,
        changed: decreased.length,
        moved: 0,
        rescan_total: Object.keys(rescanStatus).length,
        rescan_done: Object.values(rescanStatus).filter(s=>s==='done').length,
        rescan_results: rescanResults,
        rescan_log: state.feedLog.filter(f => f.includes('Re-scan') || f.includes('재스캔')),
        needs_rescan_list: needsRescan,
        missing_details: missing.slice(0, 50),
        decreased_details: decreased.slice(0, 50),
        increased_details: increased.slice(0, 20),
        ai_recommendations: [
            Object.values(rescanResults).filter(r=>r.verdict==='confirmed_missing').length > 0
                ? `${Object.values(rescanResults).filter(r=>r.verdict==='confirmed_missing').length}개 위치 재고 없음 확인 → 즉시 현장 점검` : null,
            parseFloat(accuracyRate) >= 95 ? `재고 정확도 ${accuracyRate}% 우수` : `재고 정확도 ${accuracyRate}% — 개선 필요`,
        ].filter(Boolean),
        scan_events_sample: [...state.scanEvents.slice(0, 20), ...state.scanEventsDay2.slice(0, 20)],
    };

    try {
        const resp = await fetch('/api/archive_report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_data: report }),
        });
        const result = await resp.json();
        if (result.ok) {
            btnEls.forEach(b => { b.disabled = false; b.textContent = '✅ 저장 완료!'; b.style.background = 'linear-gradient(135deg,#34d399,#059669)'; });
            addFeed(`💾 보고서 저장 완료: ${result.id}`, 'success');
            setTimeout(() => {
                closeDailyReportModal();
                window.open('/admin/reports', '_blank');
            }, 1200);
        } else {
            throw new Error(result.error || '저장 실패');
        }
    } catch(e) {
        btnEls.forEach(b => { b.disabled = false; b.textContent = '❌ 저장 실패 — 재시도'; b.style.background = 'rgba(248,113,113,0.3)'; });
        addFeed(`⛔ 보고서 저장 실패: ${e.message}`, 'alert');
    }
}

// Close modal on backdrop click
document.addEventListener('click', (e) => {
    const modal = document.getElementById('dailyReportModal');
    if (modal && e.target === modal) closeDailyReportModal();
});

function switchDay(day) {
    state.currentDay = day;
    const dayEl = document.getElementById('currentDay');
    if (dayEl) dayEl.textContent = `Day ${day}`;
    
    addFeed(`📅 Switched to Day ${day} inventory`, 'system');
    
    // If in patrol view, re-render to show updated inventory
    if (state.view === 'patrol') {
        renderPatrolView(document.getElementById('dashboardContent'));
    }
}

function exportReport(type) {
    const timestamp = new Date().toISOString().split('T')[0];
    let reportData = '';
    
    if (type === 'rescan') {
        reportData = '=== Samsung Warehouse Re-scan Report ===\n';
        reportData += `Generated: ${timestamp}\n\n`;
        reportData += 'Locations requiring physical verification:\n\n';
        
        Object.keys(inventoryDay1).forEach(shelfId => {
            const day1 = inventoryDay1[shelfId];
            const day2 = inventoryDay2[shelfId];
            if (day1.qty > 0 && day2.qty === 0) {
                reportData += `${shelfId}: ${day1.sku} - MISSING (was ${day1.qty})\n`;
            } else if (day1.qty > day2.qty && (day1.qty - day2.qty) > 5) {
                reportData += `${shelfId}: ${day1.sku} - Large decrease (${day1.qty} → ${day2.qty})\n`;
            }
        });
    } else {
        reportData = '=== Samsung Warehouse Full Comparison Report ===\n';
        reportData += `Generated: ${timestamp}\n\n`;
        reportData += 'Summary:\n';
        reportData += `Total locations: ${Object.keys(inventoryDay1).length}\n`;
        reportData += `Changes detected: ${inventoryChanges.length}\n\n`;
        reportData += 'Detailed changes:\n';
        inventoryChanges.forEach(change => {
            reportData += `${change.type.toUpperCase()}: ${change.shelfId}\n`;
        });
    }
    
    const blob = new Blob([reportData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `warehouse_${type}_report_${timestamp}.txt`;
    a.click();
    
    addFeed(`📥 Exported ${type} report`, 'success');
}

function sendToERP() {
    addFeed('🔄 Connecting to Samsung ERP...', 'system');
    
    setTimeout(() => {
        addFeed('✅ Data synchronized with ERP system', 'success');
        addFeed(`📊 Sent ${state.scanEvents.length + state.scanEventsDay2.length} scan events`, 'success');
    }, 1500);
}

function showPatrolView() {
    state.view = 'patrol';
    const content = document.getElementById('dashboardContent');
    renderPatrolView(content);
}

// ══════════════════════════════════════════════════════════════
// MCP AUTO-PRINT INTEGRATION
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// ERP COMPARE — Edge에서 스캔 결과 vs Mock ERP 비교
// ══════════════════════════════════════════════════════════════

async function runErpCompare() {
    if (!state.sessionId) {
        addFeed('⚠️ 세션 ID 없음 — 순찰 후 비교 가능', 'alert');
        return null;
    }
    addFeed(`🔄 Edge ERP 비교 시작 (세션: ${state.sessionId})…`, 'system');
    try {
        const resp = await fetch('/api/erp/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: state.sessionId }),
        });
        const data = await resp.json();
        if (data.ok) {
            state.erpCompareResult = data.result;
            const r = data.result;
            addFeed(`✅ ERP 비교 완료 — 정확도: ${r.accuracy_rate}% (일치: ${r.match_count} / 불일치: ${r.mismatch_count} / 미스캔: ${r.missing_scan})`, 'success');
            // 화면에 ERP 결과 배너 표시
            _showErpResultBanner(r);
            return r;
        } else {
            addFeed(`❌ ERP 비교 실패: ${data.error}`, 'alert');
            return null;
        }
    } catch(e) {
        addFeed(`❌ ERP 비교 오류: ${e.message}`, 'alert');
        return null;
    }
}

function _showErpResultBanner(r) {
    // 기존 배너 제거
    const old = document.getElementById('erpResultBanner');
    if (old) old.remove();

    const accColor = r.accuracy_rate >= 95 ? '#34d399' : r.accuracy_rate >= 90 ? '#fbbf24' : '#f87171';
    const accLabel = r.accuracy_rate >= 95 ? '🟢 양호' : r.accuracy_rate >= 90 ? '🟡 주의' : '🔴 긴급';

    const banner = document.createElement('div');
    banner.id = 'erpResultBanner';
    banner.style.cssText = 'margin-top:10px;padding:14px 16px;background:rgba(15,23,42,0.95);border-radius:10px;border:2px solid rgba(34,211,238,0.4);font-size:0.8rem';
    banner.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div style="font-weight:700;color:#22d3ee;font-size:0.92rem">
                📊 Edge ERP 비교 결과 — 세션 <span style="font-family:monospace;font-size:0.78rem;color:#a78bfa">${r.session_id}</span>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:0.78rem;color:#64748b">${new Date(r.compared_at).toLocaleString('ko-KR')}</span>
                <button onclick="showErpCompareModal()" style="background:linear-gradient(135deg,#22d3ee,#6366f1);color:#fff;border:none;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:700">상세 보기 →</button>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px">
            <div style="background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.25);border-radius:6px;padding:10px;text-align:center">
                <div style="color:#22d3ee;font-size:1.3rem;font-weight:800">${r.total_scanned}</div>
                <div style="color:#64748b;font-size:0.65rem">스캔 위치</div>
            </div>
            <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:6px;padding:10px;text-align:center">
                <div style="color:${accColor};font-size:1.3rem;font-weight:800">${r.accuracy_rate}%</div>
                <div style="color:#64748b;font-size:0.65rem">ERP 정확도 ${accLabel}</div>
            </div>
            <div style="background:rgba(52,211,153,0.06);border:1px solid rgba(52,211,153,0.2);border-radius:6px;padding:10px;text-align:center">
                <div style="color:#34d399;font-size:1.3rem;font-weight:800">${r.match_count}</div>
                <div style="color:#64748b;font-size:0.65rem">✅ ERP 일치</div>
            </div>
            <div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:6px;padding:10px;text-align:center">
                <div style="color:#f87171;font-size:1.3rem;font-weight:800">${r.mismatch_count}</div>
                <div style="color:#64748b;font-size:0.65rem">⚠️ 불일치</div>
            </div>
            <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:6px;padding:10px;text-align:center">
                <div style="color:#fbbf24;font-size:1.3rem;font-weight:800">${r.missing_scan}</div>
                <div style="color:#64748b;font-size:0.65rem">📭 미스캔</div>
            </div>
        </div>
        <!-- Summary alerts -->
        <div style="display:flex;flex-direction:column;gap:4px">
            ${(r.summary || []).map(s => `
            <div style="padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:4px;font-size:0.75rem;color:#e2e8f0">
                ${s.level} ${s.msg}
            </div>`).join('')}
        </div>
    `;

    // ── 항상 보이는 고정 위치: body에 fixed 팝업으로 표시 ────────
    banner.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'left:50%',
        'transform:translateX(-50%)',
        'width:min(820px, 95vw)',
        'z-index:9990',
        'padding:14px 16px',
        'background:rgba(10,18,35,0.97)',
        'border-radius:12px',
        'border:2px solid rgba(34,211,238,0.6)',
        'font-size:0.8rem',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    // 닫기 버튼 추가
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:10px;background:none;border:none;color:#64748b;font-size:1rem;cursor:pointer;padding:2px 6px';
    closeBtn.onclick = () => banner.remove();
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);

    // 상단 ERP COMPARE 카드 값 업데이트
    const erpCardVal = document.getElementById('erpCardVal');
    if (erpCardVal) {
        const accColor = r.accuracy_rate >= 95 ? '#34d399' : r.accuracy_rate >= 90 ? '#fbbf24' : '#f87171';
        erpCardVal.style.color = accColor;
        erpCardVal.textContent = `✅ ${r.accuracy_rate}% — 상세보기`;
    }
    const compareCard = document.getElementById('compareCard');
    if (compareCard) {
        compareCard.style.borderColor = 'rgba(34,211,238,0.6)';
    }
    const erpCardHintEdge = document.getElementById('erpCardHint');
    if (erpCardHintEdge) erpCardHintEdge.textContent = '클릭하면 결과 토글';
}

// ERP 비교 상세 모달
function showErpCompareModal() {
    const r = state.erpCompareResult;
    if (!r) {
        addFeed('⚠️ ERP 비교 결과 없음 — 먼저 순찰을 완료하세요', 'alert');
        return;
    }

    // 모달 요소가 없으면 생성
    let modal = document.getElementById('erpCompareModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'erpCompareModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9998;overflow-y:auto;padding:20px';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
    }
    modal.style.display = 'block';

    const accColor = r.accuracy_rate >= 95 ? '#34d399' : r.accuracy_rate >= 90 ? '#fbbf24' : '#f87171';
    const d = r.details || {};
    const mismatches = d.mismatch || [];
    const missingScan = d.missing_scan || [];
    const extraFound  = d.extra_found || [];

    modal.innerHTML = `
    <div style="max-width:950px;margin:0 auto;background:#0f172a;border-radius:16px;border:1px solid rgba(34,211,238,0.3);overflow:hidden">

        <!-- Header -->
        <div style="background:linear-gradient(135deg,rgba(34,211,238,0.15),rgba(99,102,241,0.15));padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.07)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
                <div>
                    <div style="font-size:0.7rem;color:#22d3ee;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:6px">Edge ERP 비교 보고서</div>
                    <h2 style="color:#f1f5f9;font-size:1.3rem;font-weight:800;margin:0">📊 스캔 데이터 vs Mock ERP 재고</h2>
                    <div style="color:#64748b;font-size:0.78rem;margin-top:4px">세션: <span style="color:#a78bfa;font-family:monospace">${r.session_id}</span> · ${new Date(r.compared_at).toLocaleString('ko-KR')}</div>
                </div>
                <button onclick="document.getElementById('erpCompareModal').style.display='none'"
                    style="background:rgba(248,113,113,0.2);color:#f87171;border:1px solid rgba(248,113,113,0.3);padding:8px 16px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600">✕ 닫기</button>
            </div>
            <!-- KPI -->
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:18px">
                ${[
                    { v: r.total_scanned,    l: '스캔 위치',    c: '#22d3ee' },
                    { v: r.total_erp,        l: 'ERP 재고 위치', c: '#818cf8' },
                    { v: r.accuracy_rate+'%', l: 'ERP 정확도',  c: accColor },
                    { v: r.match_count,      l: '✅ 일치',       c: '#34d399' },
                    { v: r.mismatch_count,   l: '⚠️ 불일치',    c: '#f87171' },
                ].map(k => `
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:12px;text-align:center;border:1px solid rgba(255,255,255,0.06)">
                    <div style="color:${k.c};font-size:1.4rem;font-weight:800">${k.v}</div>
                    <div style="color:#64748b;font-size:0.65rem;margin-top:3px">${k.l}</div>
                </div>`).join('')}
            </div>
        </div>

        <!-- Body -->
        <div style="padding:20px 28px;display:flex;flex-direction:column;gap:20px">

            <!-- Summary Alerts -->
            <section>
                <h3 style="color:#a78bfa;font-size:0.85rem;font-weight:700;margin-bottom:8px">💡 Edge AI 분석 요약</h3>
                <div style="display:flex;flex-direction:column;gap:6px">
                    ${(r.summary || []).map(s => `
                    <div style="padding:10px 14px;border-radius:6px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.05);font-size:0.82rem;color:#e2e8f0">
                        ${s.level} &nbsp; ${s.msg}
                    </div>`).join('')}
                </div>
            </section>

            <!-- Mismatches -->
            ${mismatches.length > 0 ? `
            <section>
                <h3 style="color:#f87171;font-size:0.85rem;font-weight:700;margin-bottom:8px">⚠️ PT번호·수량 불일치 (${mismatches.length}건)</h3>
                <div style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:5px">
                    ${mismatches.map(m => `
                    <div style="background:rgba(248,113,113,0.05);border:1px solid rgba(248,113,113,0.2);border-radius:6px;padding:10px 14px;font-size:0.78rem">
                        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                            <span style="font-family:monospace;color:#e2e8f0;font-weight:700">${m.shelf_id}</span>
                            <span style="color:#f87171;font-size:0.72rem">${m.issue}</span>
                        </div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;color:#64748b">
                            <div>📦 스캔: <span style="color:#22d3ee">${m.scan.pt_number || 'Empty'}</span> × ${m.scan.qty}</div>
                            <div>🏭 ERP: <span style="color:#818cf8">${m.erp.pt_number || 'Empty'}</span> × ${m.erp.qty}</div>
                        </div>
                        <div style="font-size:0.68rem;color:#475569;margin-top:3px">${m.location}</div>
                    </div>`).join('')}
                </div>
            </section>` : ''}

            <!-- Missing Scan -->
            ${missingScan.length > 0 ? `
            <section>
                <h3 style="color:#fbbf24;font-size:0.85rem;font-weight:700;margin-bottom:8px">📭 ERP 재고 있으나 미스캔 위치 (${missingScan.length}건)</h3>
                <div style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
                    ${missingScan.map(m => `
                    <div style="background:rgba(251,191,36,0.05);border-left:3px solid #fbbf24;padding:8px 12px;border-radius:4px;font-size:0.78rem">
                        <span style="font-family:monospace;color:#e2e8f0">${m.shelf_id}</span>
                        <span style="color:#fbbf24;margin-left:10px">${m.erp_pt} × ${m.erp_qty}</span>
                        <span style="color:#475569;font-size:0.68rem;margin-left:10px">${m.location}</span>
                    </div>`).join('')}
                </div>
            </section>` : ''}

            <!-- Extra Found (ERP에 없는 재고) -->
            ${extraFound.length > 0 ? `
            <section>
                <h3 style="color:#34d399;font-size:0.85rem;font-weight:700;margin-bottom:8px">📦 ERP 미등록 재고 발견 — 신규 입고 추정 (${extraFound.length}건)</h3>
                <div style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
                    ${extraFound.map(m => `
                    <div style="background:rgba(52,211,153,0.05);border-left:3px solid #34d399;padding:8px 12px;border-radius:4px;font-size:0.78rem">
                        <span style="font-family:monospace;color:#e2e8f0">${m.shelf_id}</span>
                        <span style="color:#34d399;margin-left:10px">${m.scan_pt} × ${m.scan_qty}</span>
                        <span style="color:#475569;font-size:0.68rem;margin-left:10px">${m.location}</span>
                    </div>`).join('')}
                </div>
            </section>` : ''}

            <!-- Footer -->
            <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);flex-wrap:wrap">
                <button onclick="exportErpCompareJSON()" style="background:rgba(99,102,241,0.15);color:#a78bfa;border:1px solid rgba(99,102,241,0.4);padding:8px 18px;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600">⬇️ JSON 내보내기</button>
                <button onclick="document.getElementById('erpCompareModal').style.display='none'" style="background:rgba(100,116,139,0.3);color:#94a3b8;border:1px solid rgba(100,116,139,0.4);padding:8px 18px;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600">✕ 닫기</button>
            </div>
        </div>
    </div>`;
}

function exportErpCompareJSON() {
    const r = state.erpCompareResult;
    if (!r) return;
    const blob = new Blob([JSON.stringify(r, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `erp-compare-${r.session_id || 'result'}.json`;
    a.click();
    addFeed('⬇️ ERP 비교 결과 JSON 내보내기 완료', 'success');
}

// Called when patrol completes (all drones standby) → auto-save + trigger MCP
async function onPatrolComplete() {
    addFeed('🎉 전체 순찰 완료 — 보고서 자동 저장 중…', 'success');

    // Build reportId
    const now = new Date();
    const reportId = `RPT-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    const { missing, decreased, increased, totalItems, accuracyRate, needsRescan } = _buildCompareData();

    const report = {
        report_id:  reportId,
        date:       now.toLocaleDateString('ko-KR'),
        time:       now.toLocaleTimeString('ko-KR'),
        warehouse:  'Samsung-Warehouse-15A',
        drone_id:   'Drone-A/B',
        total_scanned: state.scanEvents.length + state.scanEventsDay2.length,
        accuracy:   parseFloat(accuracyRate),
        total_changes: missing.length + decreased.length + increased.length,
        agent_actions: Object.keys(rescanStatus).length,
        missing:    missing.length,
        new_items:  increased.length,
        changed:    decreased.length,
        moved:      0,
        rescan_total: Object.keys(rescanStatus).length,
        rescan_done:  Object.values(rescanStatus).filter(s => s === 'done').length,
        rescan_results: rescanResults,
        rescan_log: state.feedLog.filter(f => f.includes('Re-scan') || f.includes('재스캔')),
        needs_rescan_list: needsRescan,
        missing_details:   missing.slice(0, 50),
        decreased_details: decreased.slice(0, 50),
        increased_details: increased.slice(0, 20),
        ai_recommendations: [
            Object.values(rescanResults).filter(r => r.verdict === 'confirmed_missing').length > 0
                ? `${Object.values(rescanResults).filter(r => r.verdict === 'confirmed_missing').length}개 위치 재고 없음 확인 → 즉시 현장 점검`
                : null,
            parseFloat(accuracyRate) >= 95
                ? `재고 정확도 ${accuracyRate}% 우수`
                : `재고 정확도 ${accuracyRate}% — 개선 필요`,
        ].filter(Boolean),
        patrol_completed_at: now.toISOString(),
        auto_generated: true,
    };

    // 보고서 저장 (실패해도 ERP 비교는 반드시 실행)
    try {
        const resp = await fetch('/api/archive_report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_data: report }),
        });
        const result = await resp.json();
        if (result.ok) {
            addFeed(`💾 보고서 자동 저장 완료: ${result.id}`, 'success');
            _updateMcpBadge('saved', result.id);
        } else {
            addFeed(`⚠️ 보고서 저장 실패: ${result.error}`, 'alert');
        }
    } catch(e) {
        addFeed(`⚠️ 보고서 저장 오류: ${e.message}`, 'alert');
    }

    // ── ERP 비교 + 결과 배너 — 보고서 저장 성공/실패와 무관하게 항상 실행 ──────
    setTimeout(async () => {
        addFeed('🏭 Edge ERP 자동 비교 시작…', 'system');
        let erpOk = false;
        try {
            const result = await runErpCompare();
            if (result) erpOk = true;
        } catch(e) { /* silent */ }

        // Edge API 실패 시 항상 Day1/Day2 내부 비교 배너 표시
        if (!erpOk) {
            addFeed('ℹ️ Day1/Day2 내부 비교 결과를 표시합니다', 'system');
            _showDay1Day2Banner();
        }
    }, 1200);
}

// ── Day1/Day2 내부 비교 결과 배너 (Edge API 없을 때 fallback) ─────────────
function _showDay1Day2Banner() {
    const { missing, decreased, increased, totalItems, accuracyRate, needsRescan } = _buildCompareData();

    const old = document.getElementById('erpResultBanner');
    if (old) old.remove();

    const acc = parseFloat(accuracyRate);
    const accColor = acc >= 95 ? '#34d399' : acc >= 90 ? '#fbbf24' : '#f87171';
    const accLabel = acc >= 95 ? '🟢 양호' : acc >= 90 ? '🟡 주의' : '🔴 긴급';

    const banner = document.createElement('div');
    banner.id = 'erpResultBanner';
    banner.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'left:50%',
        'transform:translateX(-50%)',
        'width:min(860px, 96vw)',
        'z-index:9990',
        'padding:16px 20px',
        'background:rgba(10,18,35,0.97)',
        'border-radius:14px',
        'border:2px solid rgba(34,211,238,0.7)',
        'font-size:0.82rem',
        'box-shadow:0 8px 40px rgba(0,0,0,0.7)',
    ].join(';');

    banner.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
            <div style="font-weight:800;color:#22d3ee;font-size:1rem">
                📊 순찰 완료 — 재고 비교 결과 (Day ${state.currentDay})
            </div>
            <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:0.75rem;color:#64748b">${new Date().toLocaleString('ko-KR')}</span>
                <button onclick="document.getElementById('erpResultBanner')?.remove(); showCompareView();" style="background:linear-gradient(135deg,#22d3ee,#6366f1);color:#fff;border:none;padding:6px 16px;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:700">📋 상세 보기 →</button>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px">
            <div style="background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.25);border-radius:8px;padding:12px;text-align:center">
                <div style="color:#22d3ee;font-size:1.5rem;font-weight:800">${totalItems}</div>
                <div style="color:#64748b;font-size:0.68rem;margin-top:2px">총 스캔 위치</div>
            </div>
            <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);border-radius:8px;padding:12px;text-align:center">
                <div style="color:${accColor};font-size:1.5rem;font-weight:800">${accuracyRate}%</div>
                <div style="color:#64748b;font-size:0.68rem;margin-top:2px">정확도 ${accLabel}</div>
            </div>
            <div style="background:rgba(248,113,113,0.06);border:1px solid rgba(248,113,113,0.2);border-radius:8px;padding:12px;text-align:center">
                <div style="color:#f87171;font-size:1.5rem;font-weight:800">${missing.length}</div>
                <div style="color:#64748b;font-size:0.68rem;margin-top:2px">❌ 분실/누락</div>
            </div>
            <div style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.2);border-radius:8px;padding:12px;text-align:center">
                <div style="color:#fbbf24;font-size:1.5rem;font-weight:800">${decreased.length}</div>
                <div style="color:#64748b;font-size:0.68rem;margin-top:2px">📉 수량 감소</div>
            </div>
            <div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:8px;padding:12px;text-align:center">
                <div style="color:#818cf8;font-size:1.5rem;font-weight:800">${increased.length}</div>
                <div style="color:#64748b;font-size:0.68rem;margin-top:2px">📈 수량 증가</div>
            </div>
        </div>
        ${needsRescan.length > 0 ? `
        <div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:10px 14px;font-size:0.78rem;color:#fca5a5">
            ⚠️ 재스캔 필요 위치 (${needsRescan.length}개):
            <span style="font-family:monospace;color:#f87171;font-weight:600">${needsRescan.slice(0, 5).map(r => r.shelfId || r).join(', ')}${needsRescan.length > 5 ? ` … 외 ${needsRescan.length - 5}개` : ''}</span>
        </div>` : `
        <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.2);border-radius:8px;padding:10px 14px;font-size:0.78rem;color:#6ee7b7">
            ✅ 재스캔 필요 없음 — 재고 상태 정상
        </div>`}
    `;

    // 닫기 버튼
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position:absolute;top:10px;right:14px;background:none;border:none;color:#64748b;font-size:1.1rem;cursor:pointer;padding:2px 8px;font-weight:700';
    closeBtn.onclick = () => banner.remove();
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);

    // 상단 ERP COMPARE 카드 업데이트
    const erpCardVal = document.getElementById('erpCardVal');
    if (erpCardVal) {
        erpCardVal.style.color = accColor;
        erpCardVal.textContent = `✅ ${accuracyRate}% — 상세보기`;
        erpCardVal.style.cursor = 'pointer';
        erpCardVal.onclick = () => { banner.style.display = banner.style.display === 'none' ? 'block' : 'none'; };
    }
    const compareCard = document.getElementById('compareCard');
    if (compareCard) compareCard.style.borderColor = 'rgba(34,211,238,0.6)';

    const erpCardHint = document.getElementById('erpCardHint');
    if (erpCardHint) erpCardHint.textContent = '클릭하면 결과 토글';
}

// Poll backend for nightly patrol start signal (MCP scheduler)
async function _pollPatrolSignal() {
    try {
        const r = await fetch('/api/mcp/patrol-signal');
        const d = await r.json();
        if (d.ok && d.signal) {
            addFeed(`🌙 MCP 스케줄러: 야간 순찰 자동 시작 신호 수신 (${d.data?.triggered_at || ''})`, 'system');
            if (!state.patrolActive) {
                startPatrol();
                addFeed('🚁 야간 자동 순찰 시작!', 'success');
            }
        }
    } catch(e) {/* silent */}
}

// Update floating MCP badge in header
function _updateMcpBadge(status, info='') {
    const el = document.getElementById('mcpBadge');
    if (!el) return;
    const cfg = {
        idle:   { bg:'rgba(100,116,139,.2)',  color:'#64748b',  text:'🖨️ MCP 대기' },
        saved:  { bg:'rgba(52,211,153,.15)',  color:'#34d399',  text:'💾 저장됨' },
        printing:{ bg:'rgba(34,211,238,.15)', color:'#22d3ee',  text:'🖨️ 출력 중' },
        printed:{ bg:'rgba(52,211,153,.2)',   color:'#34d399',  text:'✅ 출력 완료' },
        offline:{ bg:'rgba(251,191,36,.15)',  color:'#fbbf24',  text:'⚠️ 프린터 오프라인' },
    };
    const c = cfg[status] || cfg.idle;
    el.style.background = c.bg;
    el.style.color      = c.color;
    el.textContent      = info ? `${c.text} · ${info}` : c.text;
}

// Manual print from drone UI
async function mcpManualPrint() {
    _updateMcpBadge('printing');
    addFeed('🖨️ MCP 수동 출력 요청 중…', 'system');
    try {
        const r = await fetch('/api/print/manual', {
            method: 'POST', headers: {'Content-Type':'application/json'}, body:'{}',
        });
        const d = await r.json();
        if (d.ok) {
            _updateMcpBadge('printed');
            addFeed(`✅ MCP 출력 완료 — ${d.bytes} bytes 전송`, 'success');
        } else {
            const st = d.status || '';
            if (st === 'printer_offline') {
                _updateMcpBadge('offline');
                addFeed('⚠️ 프린터 오프라인 — 전원 및 네트워크 확인 필요', 'alert');
            } else {
                _updateMcpBadge('idle');
                addFeed(`❌ 출력 실패: ${d.message}`, 'alert');
            }
        }
    } catch(e) {
        _updateMcpBadge('idle');
        addFeed(`❌ 출력 오류: ${e.message}`, 'alert');
    }
}

// ══════════════════════════════════════════════════════════════
// INITIALIZATION
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('dashboardContent');
    if (content) {
        renderPatrolView(content);
    }
    // Poll for nightly patrol signal every 60s
    setInterval(_pollPatrolSignal, 60000);

    // Refresh MCP config status in header every 30s
    async function _refreshMcpStatus() {
        try {
            const r  = await fetch('/api/mcp/config');
            const d  = await r.json();
            const pr = await fetch('/api/printer/status');
            const pd = await pr.json();
            if (d.ok) {
                const c    = d.config;
                const on   = !!c.auto_print_enabled;
                const pOn  = pd.online;
                const statEl = document.getElementById('mcpStatVal');
                if (statEl) {
                    if (!on) {
                        statEl.textContent = '비활성';
                        statEl.style.color = '#64748b';
                    } else if (!pOn) {
                        statEl.textContent = '⚠️ 프린터 오프라인';
                        statEl.style.color = '#fbbf24';
                    } else {
                        statEl.textContent = `✅ ${c.print_time} 자동 출력`;
                        statEl.style.color = '#34d399';
                    }
                }
                if (!pOn && on) _updateMcpBadge('offline');
                else if (on)    _updateMcpBadge('idle');
            }
        } catch(e) { /* silent */ }
    }
    _refreshMcpStatus();
    setInterval(_refreshMcpStatus, 30000);
});
