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
    speed: 3.0,  // Increased speed (was 2.5)
    scanRadius: 40,
    scanDelay: 800,  // ms delay for rack ID and completion pause
};

// ══════════════════════════════════════════════════════════════
// 라벨 유형 정의 (삼성 반도체 창고)
// ──────────────────────────────────────────────────────────────
// 각 라벨 유형별로 드론이 읽어야 할 필드가 다릅니다:
//
//  ┌─────────────┬──────────────────────────────────┬─────────────────┐
//  │ 라벨 유형   │ 읽는 필드 (PRIMARY)              │ 비고            │
//  ├─────────────┼──────────────────────────────────┼─────────────────┤
//  │ 웨이퍼      │ PT번호  (PT64090302)             │ 바코드 하단     │
//  │             │ ← DVC(K93KGD8J0C) 아님!          │ 삼성 요청 확인  │
//  ├─────────────┼──────────────────────────────────┼─────────────────┤
//  │ HBM         │ DVC Part No. (H6-... 형태)       │ 상단 파트번호   │
//  ├─────────────┼──────────────────────────────────┼─────────────────┤
//  │ 브랜드      │ MODEL CODE (MZ-77E1T0B/EU 등)    │ 상단 모델코드   │
//  ├─────────────┼──────────────────────────────────┼─────────────────┤
//  │ 롱시스      │ UPC (887276265858 형태)           │ EAN/UPC 필드    │
//  └─────────────┴──────────────────────────────────┴─────────────────┘
// ══════════════════════════════════════════════════════════════

// ── 라벨 유형 상수 ───────────────────────────────────────────
const LABEL_TYPES = {
    WAFER:  'WAFER',   // 웨이퍼 라벨  → PT번호 읽기
    HBM:    'HBM',    // HBM 라벨    → DVC Part No. 읽기
    BRAND:  'BRAND',  // 브랜드 라벨  → MODEL CODE 읽기
    LONGYS: 'LONGYS', // 롱시스 라벨  → UPC 읽기
};

// ── 라벨 유형별 스캔 필드 설명 ───────────────────────────────
const LABEL_FIELD_MAP = {
    [LABEL_TYPES.WAFER]:  { fieldName: 'PT번호',       fieldKey: 'pt_number',    icon: '🔵', color: '#22d3ee' },
    [LABEL_TYPES.HBM]:   { fieldName: 'DVC Part No.', fieldKey: 'dvc_part',     icon: '🟣', color: '#a78bfa' },
    [LABEL_TYPES.BRAND]: { fieldName: 'MODEL CODE',   fieldKey: 'model_code',   icon: '⚪', color: '#94a3b8' },
    [LABEL_TYPES.LONGYS]:{ fieldName: 'UPC',          fieldKey: 'upc',          icon: '🟡', color: '#fbbf24' },
};

// ══════════════════════════════════════════════════════════════
// MOCK INVENTORY — 삼성 반도체 라벨 체계 반영
// ══════════════════════════════════════════════════════════════

// ── 웨이퍼 라벨: PT번호 목록 (삼성 요청 기준) ────────────────
// DVC(K93KGD8J0C) 가 아닌 PT번호(PT64090302 등)를 읽어야 함
const WAFER_PT_LIST = [
    'PT64090302', 'PT64090303', 'PT64090304', 'PT64090305',
    'PT64090306', 'PT64090307', 'PT64090308', 'PT64090309',
    'PT64090310', 'PT64090311',
];

// ── HBM 라벨: DVC Part No. 목록 ─────────────────────────────
const HBM_DVC_LIST = [
    'H6-HX01AAGP16-H29', 'H6-HX02AAGP24-H36',
    'H6-HX04BAGT32-H48', 'H6-HX08CAGU64-H96',
];

// ── 브랜드 라벨: MODEL CODE 목록 ─────────────────────────────
const BRAND_MODEL_LIST = [
    'MZ-77E1T0B/EU', 'MZ-77E2T0B/KR', 'MZ-V8P1T0B/AM',
    'MZ-V9P2T0B/JP', 'MUF-128BE3/AM',
];

// ── 롱시스 라벨: UPC 목록 ────────────────────────────────────
const LONGYS_UPC_LIST = [
    '887276265858', '887276265865', '887276265872',
    '887276265889', '887276265896',
];

// ── 창고 구역별 라벨 유형 배정 ───────────────────────────────
// Aisle 1~4:  웨이퍼 라벨  (PT번호)
// Aisle 5~8:  HBM 라벨    (DVC Part No.)
// Aisle 9~12: 브랜드 라벨  (MODEL CODE)
// Aisle 13~15:롱시스 라벨  (UPC)
function getLabelTypeForAisle(aisleId) {
    const id = parseInt(aisleId);
    if (id >= 1  && id <= 4)  return LABEL_TYPES.WAFER;
    if (id >= 5  && id <= 8)  return LABEL_TYPES.HBM;
    if (id >= 9  && id <= 12) return LABEL_TYPES.BRAND;
    return LABEL_TYPES.LONGYS;
}

// ── 라벨 유형별 스캔 ID 생성 ─────────────────────────────────
// 각 박스마다 라벨 유형에 맞는 필드를 읽어 고유 ID 반환
function generateScanId(shelf, labelType) {
    const seed = Math.abs(shelf.id.charCodeAt(0) * 13 + shelf.rack * 7 + shelf.layerIdx * 3);
    switch (labelType) {
        case LABEL_TYPES.WAFER:
            // 삼성 요청: DVC(K93KGD8J0C) 아닌 PT번호 읽기
            return WAFER_PT_LIST[seed % WAFER_PT_LIST.length];
        case LABEL_TYPES.HBM:
            return HBM_DVC_LIST[seed % HBM_DVC_LIST.length];
        case LABEL_TYPES.BRAND:
            return BRAND_MODEL_LIST[seed % BRAND_MODEL_LIST.length];
        case LABEL_TYPES.LONGYS:
            return LONGYS_UPC_LIST[seed % LONGYS_UPC_LIST.length];
        default:
            return `ID-${seed}`;
    }
}

function buildInventory() {
    const db = {};
    WAREHOUSE.shelves.forEach(shelf => {
        const hasItem = Math.random() > 0.15;
        const labelType = getLabelTypeForAisle(shelf.aisle);
        const labelMeta = LABEL_FIELD_MAP[labelType];
        if (!hasItem) {
            db[shelf.id] = { sku: null, qty: 0, labelType, labelMeta };
            return;
        }
        const scanId = generateScanId(shelf, labelType);
        db[shelf.id] = {
            // sku 필드에 라벨 유형별 스캔 ID 저장 (하위 호환 유지)
            sku: scanId,
            // 라벨 유형 메타
            labelType,
            labelMeta,
            // 실제 스캔한 필드값 (labelType에 따라 다름)
            scannedField: labelMeta.fieldKey,
            scannedValue: scanId,
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
            // Check if ALL drones are now standby → trigger auto-report
            const allDone = Object.values(state.drones).every(d => d.status === 'standby');
            if (allDone && state.patrolActive) {
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
    
    // ── 공통: 선반 스캔 처리 함수 (라벨 유형별 필드 구별) ──────
    async function scanShelf(shelf, side) {
        drone.currentLevel = shelf.layer;
        updateDroneElement(droneId);
        if (state.scannedShelves.has(shelf.id)) return;

        state.scannedShelves.add(shelf.id);
        const item = inv[shelf.id];

        // 라벨 유형 & 읽어야 할 필드 결정
        const labelType = item?.labelType || getLabelTypeForAisle(shelf.aisle);
        const labelMeta = LABEL_FIELD_MAP[labelType] || LABEL_FIELD_MAP[LABEL_TYPES.WAFER];
        const scannedValue = item?.scannedValue || item?.sku || null;

        // 라벨 유형별 피드 메시지 구성
        let scanMsg;
        if (item?.qty > 0 && scannedValue) {
            // 라벨 유형에 따라 읽은 필드를 다르게 표시
            scanMsg = `${labelMeta.icon} [${labelType}] ${labelMeta.fieldName}: `
                    + `<b style="color:${labelMeta.color}">${scannedValue}</b>`
                    + ` × ${item.qty}`;
        } else {
            scanMsg = `${labelMeta.icon} [${labelType}] 빈 선반 (Empty)`;
        }

        const event = {
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            droneId,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            rack: shelf.rack,
            side,
            layer: shelf.layer,
            labelType,
            labelMeta,
            // 하위호환: sku 필드 유지
            sku: scannedValue,
            scannedField: labelMeta.fieldKey,
            scannedValue,
            qty: item?.qty || 0,
        };

        if (state.currentDay === 1) {
            state.scanEvents.push(event);
        } else {
            state.scanEventsDay2.push(event);
        }

        drone.scannedCount++;

        // 선반 색상: 라벨 유형별 색상 구분
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            const fillColor = item?.qty > 0
                ? `${labelMeta.color}44`   // 라벨 유형 고유색 반투명
                : 'rgba(248,113,113,0.2)';
            const strokeColor = item?.qty > 0 ? labelMeta.color : '#f87171';
            shelfEl.setAttribute('fill', fillColor);
            shelfEl.setAttribute('stroke', strokeColor);
            shelfEl.setAttribute('stroke-width', '2');
        }

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
    
    // Step 4: Rack complete — 라벨 유형별 통계 포함
    const totalItems = task.shelvesLeft.length + task.shelvesRight.length;
    const tag = task.isRescan ? ' [RE-SCAN]' : '';
    const layerLabel = task.layerId || drone.currentLevel || '?';
    // 이 rack의 구역 라벨 유형 확인
    const aisleId = task.aisleId;
    const rackLabelType = getLabelTypeForAisle(aisleId);
    const rackLabelMeta = LABEL_FIELD_MAP[rackLabelType];
    addFeed(`Drone ${droneId}: ✅ Rack ${task.rack} [${layerLabel}] complete${tag} — ${totalItems}건 스캔 완료 | ${rackLabelMeta.icon} ${rackLabelType} 구역 (${rackLabelMeta.fieldName} 기준)`, 'success');
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
                    <!-- 라벨 유형 범례 (Samsung 요청 기준) -->
                    <div style="padding:8px;background:rgba(30,41,59,0.8);border-radius:6px;border:1px solid rgba(34,211,238,0.25)">
                        <div style="font-size:0.68rem;color:#22d3ee;font-weight:700;margin-bottom:6px">🏷️ 라벨 유형별 읽기 필드</div>
                        <div style="display:flex;flex-direction:column;gap:4px;font-size:0.62rem">
                            <div style="display:flex;align-items:center;gap:5px;padding:3px 5px;background:rgba(34,211,238,0.07);border-radius:3px;border-left:2px solid #22d3ee">
                                <span style="font-size:0.8rem">🔵</span>
                                <div>
                                    <div style="color:#22d3ee;font-weight:700">WAFER (A1−4)</div>
                                    <div style="color:#94a3b8">PT번호 읽기</div>
                                    <div style="color:#64748b;font-family:monospace;font-size:0.58rem">PT64090302 등</div>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:5px;padding:3px 5px;background:rgba(167,139,250,0.07);border-radius:3px;border-left:2px solid #a78bfa">
                                <span style="font-size:0.8rem">🟣</span>
                                <div>
                                    <div style="color:#a78bfa;font-weight:700">HBM (A5−8)</div>
                                    <div style="color:#94a3b8">DVC Part No. 읽기</div>
                                    <div style="color:#64748b;font-family:monospace;font-size:0.58rem">H6-HX01... 등</div>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:5px;padding:3px 5px;background:rgba(148,163,184,0.07);border-radius:3px;border-left:2px solid #94a3b8">
                                <span style="font-size:0.8rem">⚪</span>
                                <div>
                                    <div style="color:#94a3b8;font-weight:700">BRAND (A9−12)</div>
                                    <div style="color:#94a3b8">MODEL CODE 읽기</div>
                                    <div style="color:#64748b;font-family:monospace;font-size:0.58rem">MZ-77E1T0B... 등</div>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:5px;padding:3px 5px;background:rgba(251,191,36,0.07);border-radius:3px;border-left:2px solid #fbbf24">
                                <span style="font-size:0.8rem">🟡</span>
                                <div>
                                    <div style="color:#fbbf24;font-weight:700">LONGYS (A13−15)</div>
                                    <div style="color:#94a3b8">UPC 읽기</div>
                                    <div style="color:#64748b;font-family:monospace;font-size:0.58rem">887276265... 등</div>
                                </div>
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
    
    // 라벨 유형별 배경색 맵
    const AISLE_LABEL_COLORS = {
        [LABEL_TYPES.WAFER]:  { fill: 'rgba(34,211,238,0.04)',  stroke: 'rgba(34,211,238,0.25)' },
        [LABEL_TYPES.HBM]:   { fill: 'rgba(167,139,250,0.04)', stroke: 'rgba(167,139,250,0.25)' },
        [LABEL_TYPES.BRAND]: { fill: 'rgba(148,163,184,0.04)', stroke: 'rgba(148,163,184,0.2)' },
        [LABEL_TYPES.LONGYS]:{ fill: 'rgba(251,191,36,0.04)',  stroke: 'rgba(251,191,36,0.2)' },
    };

    // Render aisles
    WAREHOUSE.aisles.forEach(aisle => {
        const lType  = getLabelTypeForAisle(aisle.id);
        const lColor = AISLE_LABEL_COLORS[lType];
        const lMeta  = LABEL_FIELD_MAP[lType];

        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: lColor.fill, stroke: lColor.stroke, 'stroke-width': '1', rx: '2'
        });
        aislesG.appendChild(rect);

        // 열제목: "Aisle N" 하단에 라벨 유형 표시
        const label = createSVG('text', {
            x: aisle.x + aisle.w / 2, y: aisle.y - 10,
            fill: '#64748b', 'font-size': '8', 'text-anchor': 'middle'
        });
        label.textContent = aisle.label;
        aislesG.appendChild(label);

        // 라벨 유형 라벨 (구역 상단에 아이콘+유형 표시)
        const typeLabel = createSVG('text', {
            x: aisle.x + aisle.w / 2, y: aisle.y - 2,
            fill: lMeta.color, 'font-size': '6', 'text-anchor': 'middle', 'font-weight': '700',
            opacity: '0.85'
        });
        typeLabel.textContent = lMeta.icon + lType.slice(0,3);
        aislesG.appendChild(typeLabel);
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
    
    // Update current aisle + 라벨 유형 표시
    const aisleEl = document.getElementById(`drone${droneId}-aisle`);
    if (aisleEl) {
        if (drone.currentAisle) {
            const lt = getLabelTypeForAisle(drone.currentAisle);
            const lm = LABEL_FIELD_MAP[lt];
            aisleEl.innerHTML = `Current: Aisle ${drone.currentAisle} <span style="color:${lm.color}">${lm.icon}${lt}</span>`;
        } else {
            aisleEl.textContent = 'Current: -';
        }
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

    try {
        const resp = await fetch('/api/archive_report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report_data: report }),
        });
        const result = await resp.json();
        if (result.ok) {
            addFeed(`💾 보고서 자동 저장 완료: ${result.id}`, 'success');
            // Update MCP floating badge
            _updateMcpBadge('saved', result.id);
        } else {
            addFeed(`⚠️ 보고서 저장 실패: ${result.error}`, 'alert');
        }
    } catch(e) {
        addFeed(`⚠️ 보고서 저장 오류: ${e.message}`, 'alert');
    }
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
