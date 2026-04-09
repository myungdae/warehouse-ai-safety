/* ============================================================
   Drone Inventory Intelligence System
   Drone → Vision AI → Barcode → Inventory DB → Daily Comparison
   + Agentic AI: 자율 판단 → 재스캔 / 보고 / 에스컬레이션
   + 5-Layer 높이 스캔 (L1~L5 = 1m 단위, 총 5m)
   + 양방향 / 단방향 스캔 선택
   + 드론 시작 Layer 조절
   ============================================================ */

'use strict';

// ── Layer 정의 (15개 Layer, 총 15m 높이) ─────────────────
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

// ── 스캔 설정 (사용자 조절 가능) ─────────────────────────────
const SCAN_CONFIG = {
    scanMode:       'both',   // 'both' | 'left' | 'right'
    startLayer:     0,        // 0~4 (LAYERS 인덱스)
    endLayer:       4,        // 0~4
    activeLayerIdx: 0,        // 현재 순찰 중인 layer 인덱스 (런타임)
};

// ── 창고 구조 (15 aisles × 20 racks × 15 levels) ──────────────
const WAREHOUSE = {
    width: 1400,  // 15개 aisle을 수용하기 위해 확장
    height: 620,  // 20 racks를 수용하기 위해 확장
    aisles: [],   // 동적 생성
    shelves: [],  // 동적 생성
    docks: []     // 3개 Dock 위치
};

// 15개 Aisle 생성 (가로 배치)
for (let i = 0; i < 15; i++) {
    WAREHOUSE.aisles.push({
        id: String(i + 1),
        x: 60 + i * 88,
        y: 50,
        w: 70,
        h: 540,
        label: `Aisle-${i + 1}`,
        dockId: i < 5 ? 1 : (i < 10 ? 2 : 3)  // Dock 할당
    });
}

// 3개 Dock 위치 정의
WAREHOUSE.docks = [
    { id: 1, name: 'First Dock',  x: 20,  y: 280, w: 35, h: 60, color: '#22d3ee', aisles: [1,2,3,4,5] },
    { id: 2, name: 'Second Dock', x: 20,  y: 360, w: 35, h: 60, color: '#34d399', aisles: [6,7,8,9,10] },
    { id: 3, name: 'Third Dock',  x: 20,  y: 440, w: 35, h: 60, color: '#a78bfa', aisles: [11,12,13,14,15] },
];

const DRONE = { size: 12, speed: 2.0, scanRadius: 40, batteryDrainRate: 0.037 };  // 27분에 100% 소모

// ── Shelves 자동 생성 (15 aisles × 20 racks × 15 levels × 2 sides) ──────────────────────
WAREHOUSE.aisles.forEach(aisle => {
    const rackCount = 20; // 각 aisle당 20개 rack
    for (let rack = 0; rack < rackCount; rack++) {
        const y = aisle.y + 10 + rack * 26;  // 20개 rack을 수직으로 배치
        LAYERS.forEach((layer, li) => {
            // 좌측 선반
            WAREHOUSE.shelves.push({
                id:    `${aisle.id}-L${rack+1}-${layer.id}`,
                aisle: aisle.id,
                side:  'L',
                layer: layer.id,
                layerIdx: li,
                x: aisle.x - 28,
                y: y,
                w: 24, h: 22,
                rack: rack + 1,
                height_m: layer.height_m,
            });
            // 우측 선반
            WAREHOUSE.shelves.push({
                id:    `${aisle.id}-R${rack+1}-${layer.id}`,
                aisle: aisle.id,
                side:  'R',
                layer: layer.id,
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

// ── 재고 데이터베이스 (Day1 / Day2 시뮬레이션) ──────────────
const ITEMS = [
    'SKU-1001','SKU-1002','SKU-1003','SKU-1004','SKU-1005',
    'SKU-2001','SKU-2002','SKU-2003','SKU-2004','SKU-2005',
    'SKU-3001','SKU-3002','SKU-3003','SKU-3004','SKU-3005',
    'SKU-4001','SKU-4002','SKU-4003','SKU-4004','SKU-4005',
];

function buildInventoryDay(day) {
    const db = {};
    WAREHOUSE.shelves.forEach(shelf => {
        const baseQty   = Math.floor(Math.random() * 20) + 5;
        const hasItem   = Math.random() > 0.15; // 85% 확률로 아이템 존재
        if (!hasItem) {
            db[shelf.id] = { sku: null, qty: 0, confidence: 0 };
            return;
        }
        const itemIdx = Math.abs(
            (shelf.id.charCodeAt(0) * 7 + shelf.id.charCodeAt(1) * 3 + shelf.row * 11) % ITEMS.length
        );
        db[shelf.id] = {
            sku: ITEMS[itemIdx],
            qty: baseQty,
            confidence: 0.92 + Math.random() * 0.07
        };
    });
    return db;
}

// Day1 고정 시드, Day2는 변화 반영
function buildDay2(day1) {
    const day2 = JSON.parse(JSON.stringify(day1));
    const shelfIds = Object.keys(day2);

    // 1) 감소 (출고 시뮬레이션) — 8개 선반
    shuffle(shelfIds).slice(0, 8).forEach(id => {
        if (day2[id].qty > 0) {
            day2[id].qty = Math.max(0, day2[id].qty - Math.floor(Math.random() * 6 + 1));
        }
    });
    // 2) 증가 (입고) — 5개 선반
    shuffle(shelfIds).slice(0, 5).forEach(id => {
        if (day2[id].sku) {
            day2[id].qty += Math.floor(Math.random() * 8 + 2);
        }
    });
    // 3) 완전 소진 — 3개 선반
    shuffle(shelfIds).slice(0, 3).forEach(id => {
        day2[id].qty = 0;
        day2[id].sku = null;
    });
    // 4) 신규 입고 — 2개 빈 선반에 새 SKU
    shelfIds.filter(id => day1[id].qty === 0).slice(0, 2).forEach(id => {
        day2[id].sku = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        day2[id].qty = Math.floor(Math.random() * 12 + 3);
    });
    // 5) 이동 (위치 변경) — 2개
    const withItem = shelfIds.filter(id => day2[id].qty > 0);
    const empty    = shelfIds.filter(id => day2[id].qty === 0);
    if (withItem.length >= 2 && empty.length >= 2) {
        const from = withItem[0];
        const to   = empty[0];
        day2[to]   = { ...day2[from] };
        day2[from] = { sku: null, qty: 0, confidence: 0 };
    }
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

// ── 전역 상태 ─────────────────────────────────────────────────
let inventoryDay1 = buildInventoryDay(1);
let inventoryDay2 = buildDay2(inventoryDay1);

let state = {
    currentView: 'patrol',
    currentDay:  1,
    patrolActive: false,
    patrolDone:   false,
    day2PatrolDone: false,

    drone: { x: 28, y: 240, angle: 0, battery: 100 },
    droneTarget: null,
    patrolPath: [],      // 방문할 선반 순서
    pathIndex: 0,
    scanQueue: [],

    scanEvents: [],      // Day1 스캔 결과
    scanEventsDay2: [],  // Day2 스캔 결과
    changeEvents: [],    // 비교 결과
    agentDecisions: [],  // Agentic AI 결정
    agentActionCount: 0,

    animFrame: null,
    scanCooldown: 0,
    svg: null,
    droneEl: null,
    scanBeamEl: null,
    pathLineEls: [],
    scannedShelves: new Set(),
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    showView('patrol');
});

function updateClock() {
    const el = document.getElementById('currentTime');
    if (el) el.textContent = new Date().toLocaleTimeString('ko-KR');
}

// ── View Router ────────────────────────────────────────────────
function showView(view) {
    state.currentView = view;
    // 모든 menu-item active 제거
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    // data-view 속성으로 정확하게 해당 메뉴 아이템 활성화
    const targetMenu = document.querySelector(`.menu-item[data-view="${view}"]`);
    if (targetMenu) targetMenu.classList.add('active');

    const content = document.getElementById('dashboardContent');
    switch (view) {
        case 'patrol':   renderPatrolView(content);   break;
        case 'scanlog':  renderScanlogView(content);  break;
        case 'compare':  renderCompareView(content);  break;
        case 'agent':    renderAgentView(content);    break;
        case 'ontology': renderOntologyView(content); break;
        case 'report':   renderReportView(content);   break;
        case 'archive':  renderArchiveView(content);  break;
    }
}

// ── Day Selector ───────────────────────────────────────────────
const DAY_DATES = { 1: '2026-04-03', 2: '2026-04-04' };
function selectDay(day) {
    state.currentDay = day;
    document.getElementById('dayBtn1').classList.toggle('active', day === 1);
    document.getElementById('dayBtn2').classList.toggle('active', day === 2);
    document.getElementById('dayInfo').querySelector('.day-label').textContent = `현재: Day ${day}`;
    document.getElementById('dayDate').textContent = DAY_DATES[day];

    if (state.currentView === 'patrol') showView('patrol');
    if (state.currentView === 'scanlog') showView('scanlog');
}

// ── Layer 인디케이터 업데이트 ─────────────────────────────────
function updateLayerIndicator(layerIdx) {
    const lyr = LAYERS[layerIdx];
    const el = document.getElementById('ms-layer');
    if (el) {
        el.textContent = lyr.id;
        el.style.color = lyr.color;
    }
    // 사이드바
    const sbLayer = document.getElementById('sb-layer');
    if (sbLayer) {
        sbLayer.textContent = `${lyr.id} (${lyr.height_m}m)`;
        sbLayer.style.color = lyr.color;
    }
    // Layer 스트립 하이라이트
    document.querySelectorAll('.layer-strip').forEach((s, i) => {
        s.classList.toggle('active-layer', i === layerIdx);
    });
}

// ── 스캔 대상 선반 수 계산 ─────────────────────────────────
function calcTargetShelves() {
    const totalLayers = SCAN_CONFIG.endLayer - SCAN_CONFIG.startLayer + 1;
    const sidesCount  = SCAN_CONFIG.scanMode === 'both' ? 2 : 1;
    return WAREHOUSE.aisles.length * 6 * totalLayers * sidesCount;
}

// ============================================================
// PATROL VIEW
// ============================================================
function renderPatrolView(content) {
    const svgW = WAREHOUSE.width;
    const svgH = WAREHOUSE.height;
    const totalLayers = SCAN_CONFIG.endLayer - SCAN_CONFIG.startLayer + 1;
    const targetShelves = calcTargetShelves();

    // Layer 색상 범례 HTML
    const layerLegend = LAYERS.map((l, i) => {
        const active = (i >= SCAN_CONFIG.startLayer && i <= SCAN_CONFIG.endLayer);
        return `<div class="layer-badge-legend ${active ? 'active' : 'inactive'}"
            style="border-color:${l.color};color:${active?l.color:'#475569'};
                   background:${active?l.colorAlpha:'rgba(255,255,255,0.02)'}">
            ${l.id}<span style="font-size:0.62rem;margin-left:3px;opacity:0.7">${l.height_m}m</span>
        </div>`;
    }).join('');

    content.innerHTML = `
    <div class="patrol-layout">
        <!-- ── 설정 패널 (위쪽) ── -->
        <div class="config-panel" style="grid-column:1/-1">
            <div class="config-row">
                <!-- 스캔 방향 -->
                <div class="config-group">
                    <div class="config-label">📡 스캔 방향 (Scan Direction)</div>
                    <div class="scan-mode-toggle">
                        <button class="smt-btn ${SCAN_CONFIG.scanMode==='both'?'active':''}"
                            onclick="setScanMode('both')" id="smtBoth">
                            ◄ 양방향 ► <span class="smt-sub">Both Sides</span>
                        </button>
                        <button class="smt-btn ${SCAN_CONFIG.scanMode==='left'?'active':''}"
                            onclick="setScanMode('left')" id="smtLeft">
                            ◄ 좌측만 <span class="smt-sub">Left Only</span>
                        </button>
                        <button class="smt-btn ${SCAN_CONFIG.scanMode==='right'?'active':''}"
                            onclick="setScanMode('right')" id="smtRight">
                            우측만 ► <span class="smt-sub">Right Only</span>
                        </button>
                    </div>
                    <div class="config-hint" id="scanModeHint">${getScanModeHint()}</div>
                </div>

                <!-- Layer 범위 -->
                <div class="config-group">
                    <div class="config-label">📐 스캔 Layer 범위 (5m 높이)</div>
                    <div class="layer-range-row">
                        <div style="font-size:0.75rem;color:#64748b;margin-bottom:6px">
                            시작 Layer (드론 출발 높이)
                        </div>
                        <div class="layer-range-ctrl">
                            <label class="layer-range-label">시작:</label>
                            <select id="startLayerSel" onchange="setLayerRange()"
                                style="background:#0f172a;border:1px solid rgba(255,255,255,0.12);
                                       color:#e2e8f0;border-radius:6px;padding:4px 8px;font-size:0.8rem">
                                ${LAYERS.map((l,i)=>`<option value="${i}" ${i===SCAN_CONFIG.startLayer?'selected':''}>
                                    ${l.id} — ${l.label}</option>`).join('')}
                            </select>
                            <label class="layer-range-label">종료:</label>
                            <select id="endLayerSel" onchange="setLayerRange()"
                                style="background:#0f172a;border:1px solid rgba(255,255,255,0.12);
                                       color:#e2e8f0;border-radius:6px;padding:4px 8px;font-size:0.8rem">
                                ${LAYERS.map((l,i)=>`<option value="${i}" ${i===SCAN_CONFIG.endLayer?'selected':''}>
                                    ${l.id} — ${l.label}</option>`).join('')}
                            </select>
                        </div>
                        <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
                            ${layerLegend}
                        </div>
                    </div>
                </div>

                <!-- 미션 요약 -->
                <div class="config-group config-summary">
                    <div class="config-label">🎯 미션 요약</div>
                    <div class="summary-stats">
                        <div class="ss-row"><span>스캔 Layer</span>
                            <b id="cfgLayers" style="color:#a5b4fc">${totalLayers}개
                            (${LAYERS[SCAN_CONFIG.startLayer].id}~${LAYERS[SCAN_CONFIG.endLayer].id})</b>
                        </div>
                        <div class="ss-row"><span>스캔 방향</span>
                            <b id="cfgMode" style="color:#34d399">${getScanModeName()}</b>
                        </div>
                        <div class="ss-row"><span>예상 스캔 수</span>
                            <b id="cfgTotal" style="color:#fbbf24">${targetShelves}개</b>
                        </div>
                        <div class="ss-row"><span>정확도 예상</span>
                            <b id="cfgAccuracy" style="color:${SCAN_CONFIG.scanMode!=='both'?'#34d399':'#fbbf24'}">
                            ${SCAN_CONFIG.scanMode !== 'both' ? '↑ 단방향 고정밀' : '↔ 양방향 표준'}</b>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ── 지도 패널 ── -->
        <div class="map-panel">
            <div class="map-header">
                <span class="map-title">🗺️ 창고 디지털 트윈 — 5-Layer Drone Patrol</span>
                <div style="display:flex;align-items:center;gap:6px;margin-right:8px">
                    <div class="layer-indicator-chip" id="currentLayerChip">
                        <span style="font-size:0.65rem;color:#64748b">현재 Layer</span>
                        <span id="ms-layer" style="font-weight:800;color:${LAYERS[SCAN_CONFIG.startLayer].color}">
                            ${LAYERS[SCAN_CONFIG.startLayer].id}
                        </span>
                    </div>
                </div>
                <div class="map-controls">
                    <button class="btn-start reset-btn" onclick="resetPatrol()">↺ 초기화</button>
                    <button class="btn-start go" id="patrolBtn" onclick="togglePatrol()">▶ 순찰 시작</button>
                </div>
            </div>

            <!-- Layer 스트립 (좌측) -->
            <div style="display:flex">
                <div class="layer-strip-panel">
                    ${LAYERS.map((l,i) => `
                    <div class="layer-strip ${i>=SCAN_CONFIG.startLayer&&i<=SCAN_CONFIG.endLayer?'in-range':''}"
                         id="lstrip-${l.id}" style="border-left:3px solid ${l.color}">
                        <span class="ls-id" style="color:${l.color}">${l.id}</span>
                        <span class="ls-h">${l.height_m}m</span>
                    </div>`).join('')}
                </div>

                <svg id="warehouseMap" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg"
                     style="flex:1">
                    <defs>
                        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
                        </pattern>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                        <filter id="scanGlow">
                            <feGaussianBlur stdDeviation="5" result="coloredBlur"/>
                            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                        <radialGradient id="scanBeamGrad" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
                            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
                        </radialGradient>
                    </defs>
                    <rect width="${svgW}" height="${svgH}" fill="#0d1424"/>
                    <rect width="${svgW}" height="${svgH}" fill="url(#grid)"/>
                    <rect x="10" y="10" width="${svgW-20}" height="${svgH-20}"
                          fill="none" stroke="rgba(99,102,241,0.25)" stroke-width="1.5" rx="4"/>
                    <!-- 도킹 스테이션 -->
                    <rect x="12" y="215" width="32" height="55" rx="4"
                          fill="rgba(34,211,238,0.08)" stroke="rgba(34,211,238,0.4)" stroke-width="1"/>
                    <text x="28" y="236" fill="#22d3ee" font-size="7" text-anchor="middle" font-family="monospace">DOCK</text>
                    <text x="28" y="248" fill="#22d3ee" font-size="6" text-anchor="middle" font-family="monospace">⚡</text>
                    <text x="28" y="260" fill="#22d3ee" font-size="5.5" text-anchor="middle" font-family="monospace">5-Layer</text>
                    <g id="shelvesGroup"></g>
                    <g id="pathGroup"></g>
                    <g id="scanBeamGroup"></g>
                    <g id="droneGroup"></g>
                    <g id="labelsGroup"></g>
                </svg>
            </div>
        </div>

        <div class="right-panel">
            <!-- Mission Progress -->
            <div class="mission-card">
                <div class="mission-card-title">📊 미션 진행 현황</div>
                <div class="progress-bar-wrap">
                    <div class="progress-bar-fill" id="missionProgress" style="width:0%"></div>
                </div>
                <div class="mission-stats-grid" style="grid-template-columns:1fr 1fr 1fr;">
                    <div class="ms-item">
                        <div class="ms-val" id="ms-scanned">0</div>
                        <div class="ms-label">스캔 완료</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-total">${targetShelves}</div>
                        <div class="ms-label">목표 선반</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-battery">100%</div>
                        <div class="ms-label">배터리</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-aisle">—</div>
                        <div class="ms-label">현재 통로</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-layer" style="color:${LAYERS[SCAN_CONFIG.startLayer].color}">
                            ${LAYERS[SCAN_CONFIG.startLayer].id}
                        </div>
                        <div class="ms-label">현재 Layer</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-layerpct">0%</div>
                        <div class="ms-label">Layer 진행</div>
                    </div>
                </div>

                <!-- Layer 진행 바 -->
                <div style="margin-top:10px">
                    <div style="font-size:0.7rem;color:#475569;margin-bottom:5px;font-weight:700;letter-spacing:0.05em">
                        LAYER PROGRESS
                    </div>
                    <div style="display:flex;gap:3px">
                        ${LAYERS.map((l,i) => `
                        <div class="layer-prog-bar" id="lpb-${l.id}"
                            title="${l.label}"
                            style="flex:1;height:8px;border-radius:3px;
                                   background:${i>=SCAN_CONFIG.startLayer&&i<=SCAN_CONFIG.endLayer
                                       ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.02)'};
                                   border:1px solid ${i>=SCAN_CONFIG.startLayer&&i<=SCAN_CONFIG.endLayer
                                       ? l.color+'44' : 'transparent'}">
                            <div id="lpbfill-${l.id}" style="width:0%;height:100%;border-radius:2px;
                                 background:${l.color};transition:width 0.3s"></div>
                        </div>`).join('')}
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-top:3px">
                        ${LAYERS.map(l=>`<span style="font-size:0.6rem;color:#475569">${l.id}</span>`).join('')}
                    </div>
                </div>
            </div>

            <!-- Live Scan Feed -->
            <div class="scan-feed">
                <div class="scan-feed-title">📡 실시간 스캔 피드</div>
                <div class="scan-feed-list" id="liveFeed">
                    <div style="color:#374151; font-size:0.78rem; text-align:center; padding:20px 0;">
                        순찰을 시작하면 실시간 스캔 피드가 표시됩니다
                    </div>
                </div>
            </div>
        </div>
    </div>`;

    // SVG 요소 참조 저장
    state.svg = document.getElementById('warehouseMap');

    // 선반 & 통로 레이블 렌더링
    renderWarehouseElements();

    // 이미 진행 중이면 애니메이션 재개
    if (state.patrolActive) {
        updateDroneElement();
    }
}

// ── 스캔 모드 헬퍼 ────────────────────────────────────────────
function getScanModeName() {
    const m = { both: '양방향 (Both)', left: '좌측만 (Left)', right: '우측만 (Right)' };
    return m[SCAN_CONFIG.scanMode] || '양방향';
}
function getScanModeHint() {
    const hints = {
        both:  '⚡ 양방향: 통로 이동 1회로 좌우 동시 스캔 — 속도 우선. 일부 angle 오차 가능.',
        left:  '🎯 좌측 단방향: 드론이 좌측 선반에 집중 — <b style="color:#34d399">더 높은 정확도</b>. 좌측 선반 전용.',
        right: '🎯 우측 단방향: 드론이 우측 선반에 집중 — <b style="color:#34d399">더 높은 정확도</b>. 우측 선반 전용.',
    };
    return hints[SCAN_CONFIG.scanMode] || '';
}

function setScanMode(mode) {
    if (state.patrolActive) {
        addFeed('⚠️ 순찰 중에는 스캔 방향을 변경할 수 없습니다.', 'alert-item');
        return;
    }
    SCAN_CONFIG.scanMode = mode;
    // 단방향이면 confidence 부스트 효과 안내
    renderPatrolView(document.getElementById('dashboardContent'));
}

function setLayerRange() {
    if (state.patrolActive) {
        addFeed('⚠️ 순찰 중에는 Layer 범위를 변경할 수 없습니다.', 'alert-item');
        return;
    }
    const s = parseInt(document.getElementById('startLayerSel').value);
    const e = parseInt(document.getElementById('endLayerSel').value);
    if (s > e) {
        addFeed('⚠️ 시작 Layer가 종료 Layer보다 클 수 없습니다.', 'alert-item');
        document.getElementById('startLayerSel').value = SCAN_CONFIG.startLayer;
        document.getElementById('endLayerSel').value   = SCAN_CONFIG.endLayer;
        return;
    }
    SCAN_CONFIG.startLayer = s;
    SCAN_CONFIG.endLayer   = e;
    SCAN_CONFIG.activeLayerIdx = s;
    renderPatrolView(document.getElementById('dashboardContent'));
}

function renderWarehouseElements() {
    const shelvesG = document.getElementById('shelvesGroup');
    const labelsG  = document.getElementById('labelsGroup');
    if (!shelvesG) return;

    // 통로 배경 + 레이블
    WAREHOUSE.aisles.forEach(aisle => {
        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: 'rgba(99,102,241,0.04)',
            stroke: 'rgba(99,102,241,0.15)', 'stroke-width': '1', rx: '3'
        });
        shelvesG.appendChild(rect);
        const lbl = createSVG('text', {
            x: aisle.x + aisle.w / 2,
            y: aisle.y + aisle.h + 18,
            fill: '#4b5563', 'font-size': '10',
            'text-anchor': 'middle', 'font-family': 'monospace'
        });
        lbl.textContent = aisle.label;
        labelsG.appendChild(lbl);
    });

    // 선반 렌더링 — 현재 activeLayer(startLayer)만 기본 표시
    // 스캔 범위 내 Layer: Layer 색상으로, 범위 밖: 어둡게
    const inv = getCurrentInventory();
    const startL = SCAN_CONFIG.startLayer;
    const endL   = SCAN_CONFIG.endLayer;

    WAREHOUSE.shelves.forEach(shelf => {
        const item = inv[shelf.id];
        const hasItem = item && item.qty > 0;
        const inRange = (shelf.layerIdx >= startL && shelf.layerIdx <= endL);
        const layerColor = LAYERS[shelf.layerIdx].color;
        const layerAlpha = LAYERS[shelf.layerIdx].colorAlpha;

        // 스캔 모드에 따라 표시 여부 결정
        const mode = SCAN_CONFIG.scanMode;
        const sideVisible = (mode === 'both') ||
                            (mode === 'left'  && shelf.side === 'L') ||
                            (mode === 'right' && shelf.side === 'R');

        let fillColor, strokeColor, opacity;
        if (!inRange || !sideVisible) {
            fillColor   = 'rgba(255,255,255,0.02)';
            strokeColor = 'rgba(255,255,255,0.05)';
            opacity     = '0.4';
        } else if (hasItem) {
            fillColor   = layerAlpha;
            strokeColor = layerColor + '88';
            opacity     = '1';
        } else {
            fillColor   = 'rgba(255,255,255,0.03)';
            strokeColor = layerColor + '33';
            opacity     = '1';
        }

        const rect = createSVG('rect', {
            id: `shelf-${shelf.id}`,
            x: shelf.x, y: shelf.y,
            width: shelf.w, height: shelf.h,
            fill: fillColor, stroke: strokeColor,
            'stroke-width': '1', rx: '2', opacity
        });
        shelvesG.appendChild(rect);

        // Layer ID 미니 라벨 (첫 row만)
        if (shelf.row === 1 && sideVisible && inRange) {
            const ltxt = createSVG('text', {
                x: shelf.x + shelf.w / 2,
                y: shelf.y + shelf.h - 3,
                fill: layerColor,
                'font-size': '4.5',
                'text-anchor': 'middle',
                'font-family': 'monospace',
                opacity: '0.7'
            });
            ltxt.textContent = shelf.layer;
            shelvesG.appendChild(ltxt);
        }
    });

    // 드론 엘리먼트 생성
    const droneG = document.getElementById('droneGroup');
    droneG.innerHTML = '';

    const scanBeam = createSVG('circle', {
        id: 'scanBeam',
        cx: state.drone.x, cy: state.drone.y,
        r: DRONE.scanRadius,
        fill: 'url(#scanBeamGrad)', opacity: '0'
    });
    droneG.appendChild(scanBeam);
    state.scanBeamEl = scanBeam;

    const droneBody = createSVG('g', { id: 'droneBody' });
    [[-8,-8],[8,-8],[-8,8],[8,8]].forEach(([dx,dy]) => {
        const prop = createSVG('ellipse', {
            cx: state.drone.x + dx, cy: state.drone.y + dy,
            rx: '5', ry: '2',
            fill: 'rgba(34,211,238,0.4)', stroke: '#22d3ee', 'stroke-width': '0.5'
        });
        droneBody.appendChild(prop);
    });
    const center = createSVG('circle', {
        cx: state.drone.x, cy: state.drone.y, r: '6',
        fill: '#1e3a5f', stroke: '#6366f1', 'stroke-width': '2', filter: 'url(#glow)'
    });
    droneBody.appendChild(center);
    const led = createSVG('circle', {
        cx: state.drone.x, cy: state.drone.y, r: '2.5', fill: '#22d3ee'
    });
    droneBody.appendChild(led);
    droneG.appendChild(droneBody);
    state.droneEl = droneBody;
}

function getCurrentInventory() {
    return state.currentDay === 1 ? inventoryDay1 : inventoryDay2;
}

function createSVG(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

// ── Patrol Control ─────────────────────────────────────────────
// Layer-by-Layer 순찰:
//   시작 Layer부터 끝 Layer까지 각 Layer를 순서대로 완주
//   각 Layer 내에서 모든 Aisle을 지그재그로 순찰
function buildPatrolPath() {
    const path = [];
    const startL = SCAN_CONFIG.startLayer;
    const endL   = SCAN_CONFIG.endLayer;
    const mode   = SCAN_CONFIG.scanMode; // 'both' | 'left' | 'right'

    for (let li = startL; li <= endL; li++) {
        const layer = LAYERS[li];

        // Layer 전환 알림 포인트 (도킹 스테이션 경유)
        if (li > startL) {
            path.push({
                type: 'layer_change',
                x: 27, y: 240,
                layerIdx: li,
                layerId: layer.id,
                label: layer.label,
                aisle: null
            });
        }

        WAREHOUSE.aisles.forEach((aisle, ai) => {
            // 해당 aisle + 해당 layer의 선반만 필터
            const shelvesL = WAREHOUSE.shelves
                .filter(s => s.aisle === aisle.id && s.side === 'L' && s.layerIdx === li)
                .sort((a,b) => ai % 2 === 0 ? a.y - b.y : b.y - a.y);
            const shelvesR = WAREHOUSE.shelves
                .filter(s => s.aisle === aisle.id && s.side === 'R' && s.layerIdx === li)
                .sort((a,b) => ai % 2 === 0 ? a.y - b.y : b.y - a.y);

            // 통로 진입
            path.push({
                type: 'move',
                x: aisle.x + aisle.w / 2,
                y: ai % 2 === 0 ? aisle.y + 10 : aisle.y + aisle.h - 10,
                aisle: aisle.id,
                layerIdx: li,
                layerId: layer.id
            });

            const count = Math.max(shelvesL.length, shelvesR.length);
            for (let i = 0; i < count; i++) {
                const ri = ai % 2 === 0 ? i : count - 1 - i;
                const sl = shelvesL[ri];
                const sr = shelvesR[ri];
                const refShelf = sl || sr;
                if (!refShelf) continue;

                path.push({
                    type: 'scan',
                    x: aisle.x + aisle.w / 2,
                    y: refShelf.y + 14,
                    aisle: aisle.id,
                    layerIdx: li,
                    layerId: layer.id,
                    // scanMode에 따라 어느 선반을 스캔할지 결정
                    shelfL: (mode === 'right') ? null : sl,
                    shelfR: (mode === 'left')  ? null : sr,
                });
            }
        });
    }

    // 도킹 귀환
    path.push({ type: 'dock', x: 27, y: 240, aisle: null });
    return path;
}

function togglePatrol() {
    if (state.patrolActive) {
        stopPatrol();
    } else {
        startPatrol();
    }
}

function startPatrol() {
    const alreadyDone = state.currentDay === 1 ? state.patrolDone : state.day2PatrolDone;
    if (alreadyDone) {
        addFeed('⚠️ 이미 오늘 순찰이 완료되었습니다. 초기화 후 다시 시작하세요.', 'alert-item');
        return;
    }

    state.patrolActive = true;
    state.patrolPath   = buildPatrolPath();
    state.pathIndex    = 0;
    state.scannedShelves = new Set();
    state.scanCooldown = 0;
    SCAN_CONFIG.activeLayerIdx = SCAN_CONFIG.startLayer;

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '⏸ 순찰 중지'; btn.className = 'btn-start stop'; }

    updateSidebarDroneState('비행 중', 'status-flying');
    updateLayerIndicator(SCAN_CONFIG.startLayer);

    const startLyr = LAYERS[SCAN_CONFIG.startLayer];
    const endLyr   = LAYERS[SCAN_CONFIG.endLayer];
    const totalLayers = SCAN_CONFIG.endLayer - SCAN_CONFIG.startLayer + 1;
    const modeStr  = getScanModeName();
    addFeed(
        `🚁 DRONE-01 순찰 시작 — Day ${state.currentDay} (${DAY_DATES[state.currentDay]})<br>` +
        `<span style="font-size:0.75rem;color:#94a3b8">` +
        `Layer: <b style="color:${startLyr.color}">${startLyr.id}</b> ~ ` +
        `<b style="color:${endLyr.color}">${endLyr.id}</b> (${totalLayers}개 Layer) · ` +
        `방향: <b style="color:#34d399">${modeStr}</b></span>`,
        'agent-action'
    );

    state.animFrame = requestAnimationFrame(droneLoop);
}

function stopPatrol() {
    state.patrolActive = false;
    if (state.animFrame) cancelAnimationFrame(state.animFrame);

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '▶ 순찰 재개'; btn.className = 'btn-start go'; }

    updateSidebarDroneState('일시정지', 'status-standby');
}

function resetPatrol() {
    stopPatrol();
    state.drone = { x: 27, y: 240, angle: 0, battery: 100 };
    state.pathIndex = 0;
    state.scannedShelves = new Set();
    state.scanEvents = [];
    state.scanEventsDay2 = [];
    state.changeEvents = [];
    state.agentDecisions = [];
    state.agentActionCount = 0;
    state.patrolDone = false;
    state.day2PatrolDone = false;
    state.reportGenerated = false;
    inventoryDay1 = buildInventoryDay(1);
    inventoryDay2 = buildDay2(inventoryDay1);
    SCAN_CONFIG.activeLayerIdx = SCAN_CONFIG.startLayer;

    updateBadges(0, 0, 0);
    document.getElementById('totalScanned').textContent = '0';

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '▶ 순찰 시작'; btn.className = 'btn-start go'; }

    updateSidebarDroneState('대기 중', 'status-standby');
    showView('patrol');
    addFeed('↺ 시스템 초기화 완료. 순찰을 다시 시작할 수 있습니다.', 'agent-action');
}

// ── Drone Animation Loop ───────────────────────────────────────
function droneLoop() {
    if (!state.patrolActive) return;

    const path = state.patrolPath;
    if (state.pathIndex >= path.length) {
        finishPatrol();
        return;
    }

    const target = path[state.pathIndex];
    const dx = target.x - state.drone.x;
    const dy = target.y - state.drone.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist < 2.5) {
        // 목표 도달
        if (target.type === 'scan') {
            processScanPoint(target);
        } else if (target.type === 'layer_change') {
            // Layer 전환: 드론이 도킹 스테이션으로 돌아와 높이 재조정 후 재출발
            SCAN_CONFIG.activeLayerIdx = target.layerIdx;
            updateLayerIndicator(target.layerIdx);
            addFeed(
                `🔼 <b>Layer 전환</b>: ${LAYERS[target.layerIdx - 1]?.id || ''} → <span style="color:${LAYERS[target.layerIdx].color}">${target.layerId}</span> (${target.label})`,
                'agent-action'
            );
        } else if (target.type === 'dock') {
            updateSidebarDroneState('충전 중', 'status-charging');
        }
        state.pathIndex++;
        if (target.aisle) {
            updateSidebarAisle(target.aisle);
            document.getElementById('ms-aisle').textContent = `Aisle-${target.aisle}`;
        }
        if (target.layerId) {
            const li = target.layerIdx;
            const lyr = LAYERS[li];
            const layerEl = document.getElementById('ms-layer');
            if (layerEl) layerEl.textContent = `${lyr.id}`;
        }
    } else {
        // 이동
        state.drone.x += (dx / dist) * DRONE.speed;
        state.drone.y += (dy / dist) * DRONE.speed;
        state.drone.angle = Math.atan2(dy, dx) * 180 / Math.PI;
        state.drone.battery = Math.max(0, state.drone.battery - 0.015);
    }

    updateDroneElement();
    updateMissionStats();
    state.animFrame = requestAnimationFrame(droneLoop);
}

function updateDroneElement() {
    const droneEl = state.droneEl;
    if (!droneEl) return;

    const x = state.drone.x;
    const y = state.drone.y;

    // 드론 위치 업데이트 (모든 자식 요소 이동)
    const children = droneEl.children;
    // 프로펠러 4개
    const propOffsets = [[-8,-8],[8,-8],[-8,8],[8,8]];
    for (let i = 0; i < 4; i++) {
        children[i].setAttribute('cx', x + propOffsets[i][0]);
        children[i].setAttribute('cy', y + propOffsets[i][1]);
    }
    // 중심 + LED
    children[4].setAttribute('cx', x); children[4].setAttribute('cy', y);
    children[5].setAttribute('cx', x); children[5].setAttribute('cy', y);

    // 스캔 빔 위치
    if (state.scanBeamEl) {
        state.scanBeamEl.setAttribute('cx', x);
        state.scanBeamEl.setAttribute('cy', y);
    }
}

function processScanPoint(target) {
    const inv = getCurrentInventory();
    const scanTime = new Date().toLocaleTimeString('ko-KR');
    const scanned = [];

    // 단방향 스캔 시 confidence 부스트
    const singleSide = SCAN_CONFIG.scanMode !== 'both';
    const confidenceBoost = singleSide ? 0.04 : 0;

    // 현재 Layer 활성화 색상
    const layerIdx  = target.layerIdx ?? SCAN_CONFIG.startLayer;
    const layerInfo = LAYERS[layerIdx];

    // Layer 인디케이터 업데이트
    SCAN_CONFIG.activeLayerIdx = layerIdx;
    updateLayerIndicator(layerIdx);

    [target.shelfL, target.shelfR].forEach(shelf => {
        if (!shelf || state.scannedShelves.has(shelf.id)) return;
        state.scannedShelves.add(shelf.id);

        const item = inv[shelf.id];
        const rawConf = item?.confidence || 0;
        const finalConf = Math.min(1.0, rawConf + confidenceBoost);

        const event = {
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            day: state.currentDay,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            side: shelf.side,
            layer: shelf.layer,
            layerIdx: shelf.layerIdx,
            height_m: shelf.height_m,
            sku: item?.sku || null,
            qty: item?.qty || 0,
            confidence: finalConf,
            location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'} / ${shelf.layer} (${shelf.height_m}m)`
        };

        if (state.currentDay === 1) {
            state.scanEvents.push(event);
        } else {
            state.scanEventsDay2.push(event);
        }
        scanned.push(event);

        // 선반 색상 업데이트 (스캔 완료 → 녹색/적색)
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', event.sku
                ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.12)');
            shelfEl.setAttribute('stroke', event.sku
                ? 'rgba(52,211,153,0.7)' : 'rgba(248,113,113,0.5)');
            shelfEl.setAttribute('opacity', '1');
        }

        // 피드 업데이트 — Layer 정보 포함
        const skuText = event.sku ? `${event.sku} × ${event.qty}` : '빈 선반';
        const dirClass = shelf.side === 'L' ? 'left-scan' : 'right-scan';
        const dirBadge = shelf.side === 'L'
            ? '<span class="scan-dir dir-L">◄ 좌</span>'
            : '<span class="scan-dir dir-R">우 ►</span>';
        const layerBadge = `<span class="layer-badge" style="background:${layerInfo.colorAlpha};
            color:${layerInfo.color};border:1px solid ${layerInfo.color}44;
            font-size:0.62rem;padding:1px 5px;border-radius:3px;font-weight:700;margin-left:3px">
            ${shelf.layer} ${shelf.height_m}m</span>`;
        const confBoostMark = singleSide ? ' <span style="color:#34d399;font-size:0.68rem">↑정밀</span>' : '';

        addFeed(`${dirBadge}${layerBadge}<span class="scan-barcode" style="margin-left:5px">${shelf.id}</span>
            <br><span class="scan-meta">${skuText} · 신뢰도 ${(finalConf*100).toFixed(1)}%${confBoostMark}</span>`,
            dirClass, scanTime);
    });

    // 스캔 빔 색상을 현재 Layer 색상으로
    if (state.scanBeamEl) {
        state.scanBeamEl.setAttribute('fill', `url(#scanBeamGrad)`);
    }

    // Layer 진행 바 업데이트
    updateLayerProgressBar(layerIdx);

    if (scanned.length > 0) {
        flashScanBeam();
        updateTotalScanned();
    }
}

function updateLayerProgressBar(currentLayerIdx) {
    const startL = SCAN_CONFIG.startLayer;
    const endL   = SCAN_CONFIG.endLayer;
    const mode   = SCAN_CONFIG.scanMode;
    const sidesCount = mode === 'both' ? 2 : 1;

    for (let li = startL; li <= endL; li++) {
        const layer = LAYERS[li];
        const shelvesInLayer = WAREHOUSE.shelves.filter(s =>
            s.layerIdx === li &&
            (mode === 'both' || (mode === 'left' && s.side === 'L') || (mode === 'right' && s.side === 'R'))
        );
        const scannedInLayer = shelvesInLayer.filter(s => state.scannedShelves.has(s.id)).length;
        const pct = shelvesInLayer.length > 0 ? (scannedInLayer / shelvesInLayer.length) * 100 : 0;
        const fillEl = document.getElementById(`lpbfill-${layer.id}`);
        if (fillEl) fillEl.style.width = pct + '%';
    }

    // ms-layerpct 업데이트
    const totalTarget = calcTargetShelves();
    const totalScanned = state.scannedShelves.size;
    const lpctEl = document.getElementById('ms-layerpct');
    if (lpctEl) lpctEl.textContent = Math.round(totalScanned / Math.max(1, totalTarget) * 100) + '%';
}

function flashScanBeam() {
    if (!state.scanBeamEl) return;
    state.scanBeamEl.setAttribute('opacity', '1');
    setTimeout(() => {
        if (state.scanBeamEl) state.scanBeamEl.setAttribute('opacity', '0');
    }, 300);
}

function updateTotalScanned() {
    const total = state.currentDay === 1
        ? state.scanEvents.length : state.scanEventsDay2.length;
    const totalEl = document.getElementById('totalScanned');
    if (totalEl) totalEl.textContent = total;
    const msScanned = document.getElementById('ms-scanned');
    if (msScanned) msScanned.textContent = state.scannedShelves.size;
    const scanBadge = document.getElementById('scanBadge');
    if (scanBadge) scanBadge.textContent = total;
}

function updateMissionStats() {
    const targetShelves = calcTargetShelves();
    const pct = Math.min(100, Math.round(state.scannedShelves.size / Math.max(1, targetShelves) * 100));
    const pb = document.getElementById('missionProgress');
    if (pb) pb.style.width = pct + '%';

    const bat = document.getElementById('ms-battery');
    if (bat) bat.textContent = state.drone.battery.toFixed(0) + '%';
    const sbBat = document.getElementById('sb-battery');
    if (sbBat) sbBat.textContent = state.drone.battery.toFixed(0) + '%';
    const sbScan = document.getElementById('sb-scanCount');
    if (sbScan) sbScan.textContent = state.scannedShelves.size;
}

function updateSidebarDroneState(text, cls) {
    const el = document.getElementById('sb-droneState');
    if (!el) return;
    el.textContent = text;
    el.className = `ds-value ${cls}`;
}
function updateSidebarAisle(aisle) {
    const el = document.getElementById('sb-aisle');
    if (el) el.textContent = aisle ? `Aisle-${aisle}` : '귀환';
}

function addFeed(html, cls = '', time = '') {
    const feed = document.getElementById('liveFeed');
    if (!feed) return;

    // 플레이스홀더 제거
    const placeholder = feed.querySelector('div[style]');
    if (placeholder) placeholder.remove();

    const timeStr = time || new Date().toLocaleTimeString('ko-KR');
    const item = document.createElement('div');
    item.className = `scan-item ${cls}`;
    item.innerHTML = `
        <span class="scan-time">${timeStr}</span>
        <div class="scan-content">${html}</div>`;

    feed.insertBefore(item, feed.firstChild);

    // 최대 50개 유지
    while (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

function finishPatrol() {
    state.patrolActive = false;
    const isDay1 = state.currentDay === 1;

    if (isDay1) state.patrolDone = true;
    else state.day2PatrolDone = true;

    updateSidebarDroneState('귀환 완료', 'status-standby');

    const totalLayers = SCAN_CONFIG.endLayer - SCAN_CONFIG.startLayer + 1;
    const modeStr     = getScanModeName();
    addFeed(
        `✅ DRONE-01 순찰 완료 — ${state.scannedShelves.size}개 선반 스캔<br>` +
        `<span style="font-size:0.75rem;color:#64748b">${totalLayers}개 Layer · ${modeStr}</span>`,
        'agent-action'
    );

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '✅ 순찰 완료'; btn.className = 'btn-start reset-btn'; }

    // 모든 Layer 진행바를 100%로
    LAYERS.forEach((l, li) => {
        if (li >= SCAN_CONFIG.startLayer && li <= SCAN_CONFIG.endLayer) {
            const fillEl = document.getElementById(`lpbfill-${l.id}`);
            if (fillEl) fillEl.style.width = '100%';
        }
    });

    // Day2 완료 시 자동 비교 + Agentic AI 실행
    if (!isDay1) {
        setTimeout(() => {
            addFeed('🤖 Agentic AI: 재고 비교 분석 시작...', 'agent-action');
            runInventoryComparison();
            setTimeout(() => runAgenticAI(), 800);
        }, 600);
    } else {
        addFeed('📅 Day 2로 전환하여 다음날 순찰을 시작하세요.', '');
    }
}

// ============================================================
// SCAN LOG VIEW
// ============================================================
function renderScanlogView(content) {
    const events = state.currentDay === 1 ? state.scanEvents : state.scanEventsDay2;

    const layerCounts = {};
    LAYERS.forEach(l => { layerCounts[l.id] = events.filter(e => e.layer === l.id).length; });

    content.innerHTML = `
    <div class="scanlog-view">
        <div class="log-filter-bar">
            <span style="font-size:0.82rem;color:#64748b;margin-right:4px;">필터:</span>
            <div class="filter-chip active" onclick="filterScanlog(this,'all')">전체 (${events.length})</div>
            <div class="filter-chip" onclick="filterScanlog(this,'L')">◄ 좌측</div>
            <div class="filter-chip" onclick="filterScanlog(this,'R')">우측 ►</div>
            <div class="filter-chip" onclick="filterScanlog(this,'item')">재고 있음</div>
            <div class="filter-chip" onclick="filterScanlog(this,'empty')">빈 선반</div>
            <span style="width:1px;background:rgba(255,255,255,0.08);height:18px;display:inline-block;margin:0 4px"></span>
            ${LAYERS.map(l => `
            <div class="filter-chip layer-filter-chip" onclick="filterScanlog(this,'layer-${l.id}')"
                 style="border-color:${l.color}55;color:${layerCounts[l.id]>0?l.color:'#374151'}">
                ${l.id} <span style="opacity:0.6">(${layerCounts[l.id]})</span>
            </div>`).join('')}
        </div>
        <div class="events-table-wrap">
            <table class="events-table" id="scanlogTable">
                <thead>
                    <tr>
                        <th>이벤트 ID</th>
                        <th>시간</th>
                        <th>위치</th>
                        <th>방향 / Layer</th>
                        <th>SKU</th>
                        <th>수량</th>
                        <th>신뢰도</th>
                    </tr>
                </thead>
                <tbody id="scanlogBody">
                    ${renderScanlogRows(events)}
                </tbody>
            </table>
            ${events.length === 0 ? `
            <div style="padding:40px;text-align:center;color:#374151;font-size:0.85rem;">
                📋 스캔 데이터가 없습니다. 순찰을 먼저 실행하세요.
            </div>` : ''}
        </div>
    </div>`;
}

function renderScanlogRows(events) {
    return events.map(ev => {
        const li = ev.layerIdx ?? 0;
        const lyr = LAYERS[li] || LAYERS[0];
        return `
        <tr data-side="${ev.side}" data-has="${ev.sku ? 'item' : 'empty'}" data-layer="${ev.layer||''}">
            <td><span class="badge-scan">${ev.id.substring(0,14)}…</span></td>
            <td style="font-family:monospace;font-size:0.78rem;color:#64748b">${ev.timestamp}</td>
            <td style="font-size:0.78rem">${ev.location}</td>
            <td>
                <span class="badge-scan ${ev.side === 'L' ? 'badge-left' : 'badge-right'}">
                    ${ev.side === 'L' ? '◄ 좌' : '우 ►'}</span>
                <span style="margin-left:4px;background:${lyr.colorAlpha};color:${lyr.color};
                    border:1px solid ${lyr.color}44;border-radius:3px;font-size:0.68rem;
                    padding:1px 5px;font-weight:700">${ev.layer||'—'} ${ev.height_m!=null?ev.height_m+'m':''}</span>
            </td>
            <td style="font-family:monospace;font-weight:700">${ev.sku || '<span style="color:#374151">—</span>'}</td>
            <td style="font-weight:700;color:${ev.qty > 0 ? '#a5b4fc' : '#374151'}">${ev.qty}</td>
            <td>
                <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px">
                        <div style="width:${(ev.confidence*100).toFixed(0)}%;height:100%;background:#6366f1;border-radius:2px"></div>
                    </div>
                    <span style="font-size:0.72rem;color:#64748b">${(ev.confidence*100).toFixed(1)}%</span>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function filterScanlog(el, filter) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');

    const events = state.currentDay === 1 ? state.scanEvents : state.scanEventsDay2;
    let filtered = events;
    if (filter === 'L')         filtered = events.filter(e => e.side === 'L');
    if (filter === 'R')         filtered = events.filter(e => e.side === 'R');
    if (filter === 'item')      filtered = events.filter(e => e.sku);
    if (filter === 'empty')     filtered = events.filter(e => !e.sku);
    if (filter.startsWith('layer-')) {
        const lid = filter.replace('layer-', '');
        filtered = events.filter(e => e.layer === lid);
    }

    const tbody = document.getElementById('scanlogBody');
    if (tbody) tbody.innerHTML = renderScanlogRows(filtered);
}

// ============================================================
// INVENTORY COMPARISON ENGINE
// ============================================================
function runInventoryComparison() {
    state.changeEvents = [];
    const day1 = inventoryDay1;
    const day2 = inventoryDay2;

    WAREHOUSE.shelves.forEach(shelf => {
        const s1 = day1[shelf.id];
        const s2 = day2[shelf.id];
        if (!s1 || !s2) return;

        // 케이스 분류
        if (s1.qty > 0 && s2.qty === 0 && !s2.sku) {
            // 완전 소진
            state.changeEvents.push({
                type: 'MISSING',
                shelfId: shelf.id,
                location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`,
                sku: s1.sku,
                day1qty: s1.qty,
                day2qty: 0,
                delta: -s1.qty,
                severity: 'high'
            });
        } else if (s1.qty === 0 && s2.qty > 0 && s2.sku) {
            // 신규 입고
            state.changeEvents.push({
                type: 'NEW',
                shelfId: shelf.id,
                location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`,
                sku: s2.sku,
                day1qty: 0,
                day2qty: s2.qty,
                delta: s2.qty,
                severity: 'info'
            });
        } else if (s1.sku && s2.sku && s1.sku === s2.sku && s1.qty !== s2.qty) {
            // 수량 변화
            state.changeEvents.push({
                type: 'CHANGED',
                shelfId: shelf.id,
                location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`,
                sku: s1.sku,
                day1qty: s1.qty,
                day2qty: s2.qty,
                delta: s2.qty - s1.qty,
                severity: Math.abs(s2.qty - s1.qty) > 10 ? 'high' : 'medium'
            });
        } else if (s1.sku && s2.sku && s1.sku !== s2.sku) {
            // SKU 변경 (이동 or 잘못된 입고)
            state.changeEvents.push({
                type: 'MOVED',
                shelfId: shelf.id,
                location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`,
                sku: `${s1.sku}→${s2.sku}`,
                day1qty: s1.qty,
                day2qty: s2.qty,
                delta: s2.qty - s1.qty,
                severity: 'medium'
            });
        }
    });

    const missing = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newItems = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed  = state.changeEvents.filter(e => e.type === 'CHANGED' || e.type === 'MOVED').length;

    updateBadges(missing + changed + newItems, state.agentActionCount, state.agentDecisions.length);

    const alertChip = document.getElementById('alertChip');
    if (alertChip) {
        alertChip.style.display = 'flex';
        document.getElementById('totalAlerts').textContent = state.changeEvents.length;
    }
}

function updateBadges(changeCount, agentCount, decisionCount) {
    const cb = document.getElementById('changeBadge');
    if (cb) {
        cb.textContent = changeCount;
        cb.style.display = changeCount > 0 ? '' : 'none';
    }
    const ab = document.getElementById('agentBadge');
    if (ab) {
        ab.textContent = decisionCount;
        ab.style.display = decisionCount > 0 ? '' : 'none';
    }
}

// ============================================================
// AGENTIC AI ENGINE
// ============================================================
function runAgenticAI() {
    updateSidebarDroneState('AI 분석 중', 'status-agent');
    addFeed('🤖 Agentic AI: Operational Ontology 추론 시작...', 'agent-action');

    const decisions = [];
    const missing = state.changeEvents.filter(e => e.type === 'MISSING');
    const changed  = state.changeEvents.filter(e => e.type === 'CHANGED' && e.delta < -5);
    const moved    = state.changeEvents.filter(e => e.type === 'MOVED');
    const newItems = state.changeEvents.filter(e => e.type === 'NEW');

    // ── Rule 1: HIGH-SEVERITY MISSING → 즉시 재스캔
    if (missing.length > 0) {
        const targets = missing.slice(0, 3);
        decisions.push({
            id: `AGT-${Date.now()}-001`,
            type: 'RESCAN',
            title: `재고 소진 감지 — ${targets.length}개 위치 즉시 재스캔`,
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            reasoning: `[OBSERVATION] ${missing.length}개 선반에서 전일 대비 재고 완전 소진 감지\n[HYPOTHESIS-1] 출고 처리됨 (P=0.65)\n[HYPOTHESIS-2] 비인가 이동 (P=0.20)\n[HYPOTHESIS-3] 스캔 오류 (P=0.15)\n[DECISION] 스캔 오류 가능성 배제를 위해 즉시 재스캔 명령\n[CONFIDENCE] 0.91`,
            actions: [
                { label: `DRONE-01 재출동 → ${targets.map(t=>t.shelfId).join(', ')} 재스캔`, status: 'done' },
                { label: '재스캔 결과와 WMS 출고 기록 대조 중', status: 'done' },
                { label: '불일치 시 보안팀 에스컬레이션 자동 발송', status: 'pending' },
            ]
        });
        state.agentActionCount++;
        addFeed(`🤖 Agent → 재스캔 명령: ${targets.map(t=>t.shelfId).join(', ')}`, 'agent-action');
    }

    // ── Rule 2: LARGE DECREASE → WMS 대조
    if (changed.length > 0) {
        decisions.push({
            id: `AGT-${Date.now()}-002`,
            type: 'CONFIRM',
            title: `대량 감소 감지 — WMS 출고 기록 자동 대조`,
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            reasoning: `[OBSERVATION] ${changed.length}개 SKU에서 단일 사이클 대비 5단위 이상 감소\n[ONTOLOGY RULE] IF qty_delta < -5 AND no_shipment_record → Anomaly_Event\n[ACTION] WMS API 조회 → 출고 기록 매칭\n[RESULT] ${Math.floor(changed.length * 0.7)}건 정상 출고 확인, ${Math.ceil(changed.length * 0.3)}건 미확인\n[CONFIDENCE] 0.88`,
            actions: [
                { label: 'WMS API 출고 기록 조회 완료', status: 'done' },
                { label: `${Math.floor(changed.length * 0.7)}건 정상 출고 확인`, status: 'done' },
                { label: `${Math.ceil(changed.length * 0.3)}건 미확인 → 담당자 알림 발송`, status: 'pending' },
            ]
        });
        state.agentActionCount++;
        addFeed(`🤖 Agent → WMS 대조 완료. 미확인 ${Math.ceil(changed.length * 0.3)}건 알림 발송`, 'agent-action');
    }

    // ── Rule 3: MOVED → 이동 경로 분석
    if (moved.length > 0) {
        decisions.push({
            id: `AGT-${Date.now()}-003`,
            type: 'ALERT',
            title: `SKU 위치 변경 감지 — 비인가 이동 경고`,
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            reasoning: `[OBSERVATION] ${moved.length}개 선반에서 SKU가 변경됨 (전일 대비)\n[ONTOLOGY RULE] IF location_sku_mismatch → Inventory_Move_Event\n[HYPOTHESIS-1] 작업자 수동 재배치 (P=0.55)\n[HYPOTHESIS-2] 시스템 오류 (P=0.25)\n[HYPOTHESIS-3] 비인가 접근 (P=0.20)\n[DECISION] 해당 구역 CCTV 영상 자동 추출 + 감독자 보고서 생성\n[CONFIDENCE] 0.84`,
            actions: [
                { label: `${moved.length}개 위치 CCTV 영상 시간대 추출`, status: 'done' },
                { label: '감독자 보고서 자동 생성 완료', status: 'done' },
                { label: '이동 이력 Audit Trail DB 기록', status: 'done' },
                { label: '보안팀 에스컬레이션 대기 중', status: 'pending' },
            ]
        });
        state.agentActionCount++;
        addFeed(`🤖 Agent → SKU 이동 감지: CCTV 영상 추출 + 보고서 생성 완료`, 'agent-action');
    }

    // ── Rule 4: NEW → 입고 확인
    if (newItems.length > 0) {
        decisions.push({
            id: `AGT-${Date.now()}-004`,
            type: 'CONFIRM',
            title: `신규 입고 감지 — 입고 예정 목록 대조`,
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            reasoning: `[OBSERVATION] ${newItems.length}개 빈 선반에 신규 SKU 입고 확인\n[ONTOLOGY RULE] IF new_sku_at_empty_shelf → New_Arrival_Event\n[ACTION] WMS 입고 예정 목록 자동 대조\n[RESULT] 입고 예정 SKU와 ${Math.floor(newItems.length*0.9)}/${newItems.length}건 매칭 성공\n[CONFIDENCE] 0.95`,
            actions: [
                { label: 'WMS 입고 예정 목록 조회', status: 'done' },
                { label: `${Math.floor(newItems.length*0.9)}건 정상 입고 확인`, status: 'done' },
                { label: '재고 DB 자동 업데이트', status: 'done' },
            ]
        });
        state.agentActionCount++;
    }

    // ── Rule 5: 전체 요약 보고서 생성
    decisions.push({
        id: `AGT-${Date.now()}-005`,
        type: 'ESCALATE',
        title: `일일 재고 인텔리전스 보고서 자동 생성`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        reasoning: `[SUMMARY] Day 2 순찰 완료\n[총 스캔] ${state.scannedShelves.size}개 선반\n[변화 감지] ${state.changeEvents.length}건\n  - 소진: ${missing.length}건 / 신규: ${newItems.length}건\n  - 수량변화: ${changed.length}건 / 이동: ${moved.length}건\n[AI 조치] ${decisions.length}건 자율 처리\n[재고 정확도 추정] 97.3%\n[다음 순찰] ${DAY_DATES[2]} 22:00 예약`,
        actions: [
            { label: 'ERP 시스템 자동 업데이트', status: 'done' },
            { label: '담당자 이메일/Slack 보고서 발송', status: 'done' },
            { label: `다음 순찰 스케줄 예약 (D+1 22:00)`, status: 'done' },
        ]
    });

    state.agentDecisions = decisions;

    // 배지 업데이트
    updateBadges(state.changeEvents.length, state.agentActionCount, decisions.length);
    const agentChip = document.getElementById('agentChip');
    if (agentChip) {
        agentChip.style.display = 'flex';
        document.getElementById('agentActions').textContent = decisions.length;
    }
    document.getElementById('ms-aisle').textContent = '도킹';
    updateSidebarDroneState('임무 완료', 'status-standby');

    addFeed(`✅ Agentic AI 분석 완료 — ${decisions.length}건 자율 조치 완료`, 'agent-action');

    // 3초 후 Agentic AI 뷰로 자동 전환
    setTimeout(() => showView('agent'), 2500);
}

// ============================================================
// COMPARE VIEW
// ============================================================
function renderCompareView(content) {
    if (state.changeEvents.length === 0 && state.day2PatrolDone) {
        runInventoryComparison();
    }

    const missing = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newCnt  = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed = state.changeEvents.filter(e => e.type === 'CHANGED' || e.type === 'MOVED').length;

    const typeLabel = { MISSING:'소진', NEW:'신규', CHANGED:'수량변화', MOVED:'위치변경' };
    const typeClass = { MISSING:'missing-row', NEW:'new-row', CHANGED:'changed-row', MOVED:'moved-row' };
    const typeBadge = { MISSING:'badge-alert', NEW:'badge-agent', CHANGED:'', MOVED:'' };

    content.innerHTML = `
    <div class="compare-view">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div>
                <h2 style="font-size:1.1rem;font-weight:800;color:#e2e8f0">
                    📊 재고 변화 비교 — Day 1 (${DAY_DATES[1]}) vs Day 2 (${DAY_DATES[2]})
                </h2>
                <p style="font-size:0.78rem;color:#64748b;margin-top:4px">
                    Scan_Event 기반 자동 비교 분석 · Operational Ontology 추론 적용
                </p>
            </div>
            ${state.changeEvents.length === 0 ? `
            <div style="padding:8px 16px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.3);border-radius:8px;color:#fbbf24;font-size:0.8rem">
                ⚠️ Day 2 순찰을 먼저 완료하세요
            </div>` : ''}
        </div>

        <div class="compare-header-row">
            <div class="compare-card changed">
                <div class="cc-num changed">${changed}</div>
                <div class="cc-label">수량 변화 / 이동</div>
            </div>
            <div class="compare-card missing">
                <div class="cc-num missing">${missing}</div>
                <div class="cc-label">재고 소진</div>
            </div>
            <div class="compare-card new">
                <div class="cc-num new">${newCnt}</div>
                <div class="cc-label">신규 입고</div>
            </div>
        </div>

        ${state.changeEvents.length > 0 ? `
        <div class="change-hdr">
            <span>위치</span><span>SKU</span>
            <span>Day 1 수량</span><span>Day 2 수량</span>
            <span>변화</span><span>유형</span>
        </div>
        <div class="change-timeline">
            ${state.changeEvents.map(ev => `
            <div class="change-event-row ${typeClass[ev.type]}">
                <span style="font-family:monospace;font-size:0.78rem;color:#64748b">${ev.shelfId}</span>
                <span style="font-family:monospace;font-weight:700;font-size:0.82rem">${ev.sku || '—'}</span>
                <span style="color:#94a3b8">${ev.day1qty}</span>
                <span style="color:#e2e8f0;font-weight:700">${ev.day2qty}</span>
                <span class="qty-delta ${ev.delta >= 0 ? 'pos' : 'neg'}">
                    ${ev.delta >= 0 ? '+' : ''}${ev.delta}
                </span>
                <span>
                    <span class="badge-scan ${typeBadge[ev.type]}">${typeLabel[ev.type]}</span>
                    ${ev.severity === 'high' ? ' <span style="color:#f87171;font-size:0.72rem">⚠ HIGH</span>' : ''}
                </span>
            </div>`).join('')}
        </div>` : `
        <div style="padding:60px;text-align:center;color:#374151;font-size:0.85rem;background:rgba(15,23,42,0.5);border-radius:14px;border:1px dashed rgba(255,255,255,0.08)">
            📊 Day 1 & Day 2 순찰을 모두 완료하면<br>자동으로 변화 비교 분석이 실행됩니다
        </div>`}
    </div>`;
}

// ============================================================
// AGENT VIEW
// ============================================================
function renderAgentView(content) {
    const steps = [
        { label: '1. 센서 수집', active: true },
        { label: '2. Vision AI', active: true },
        { label: '3. Scan_Event', active: true },
        { label: '4. Ontology 추론', active: state.agentDecisions.length > 0 },
        { label: '5. 자율 판단', active: state.agentDecisions.length > 0 },
        { label: '6. 조치 실행', active: state.agentDecisions.length > 0 },
    ];

    content.innerHTML = `
    <div class="agent-view">
        <div class="agent-header-card">
            <div class="agent-icon-big">🤖</div>
            <div class="agent-desc">
                <h2>Agentic AI — Autonomous Inventory Intelligence</h2>
                <p>드론 스캔 데이터를 Operational Ontology로 해석하여 상황을 자율 판단하고,
                재스캔 명령 · WMS 대조 · 보고서 생성 · 에스컬레이션을 자동으로 실행합니다.<br>
                <span style="color:#6366f1">Verity / Gather AI를 넘어서는 의미 기반 추론 레이어</span></p>
            </div>
        </div>

        <div class="agent-pipeline">
            ${steps.map((s, i) => `
                <div class="pipe-step ${s.active ? 'active' : ''}">${s.label}</div>
                ${i < steps.length - 1 ? '<span class="pipe-arrow">→</span>' : ''}
            `).join('')}
        </div>

        ${state.agentDecisions.length === 0 ? `
        <div style="padding:60px;text-align:center;color:#374151;font-size:0.85rem;
                    background:rgba(15,23,42,0.5);border-radius:14px;border:1px dashed rgba(52,211,153,0.15)">
            🤖 Agentic AI는 Day 2 순찰 완료 후 자동으로 활성화됩니다.<br>
            <span style="font-size:0.75rem;color:#374151">
                Operational Ontology 기반 추론 → 자율 재스캔 / WMS 대조 / 보고서 생성
            </span>
        </div>` : `
        <div class="agent-decisions">
            ${state.agentDecisions.map(dec => `
            <div class="agent-decision-card">
                <div class="adc-header">
                    <span class="adc-type type-${dec.type.toLowerCase()}">${dec.type}</span>
                    <span class="adc-title">${dec.title}</span>
                    <span class="adc-time">${dec.timestamp}</span>
                </div>
                <div class="adc-body">
                    <div class="adc-reasoning">${dec.reasoning}</div>
                    <div class="adc-action-list">
                        ${dec.actions.map(act => `
                        <div class="adc-action ${act.status}">
                            <span class="action-icon">${act.status === 'done' ? '✅' : '⏳'}</span>
                            <span>${act.label}</span>
                        </div>`).join('')}
                    </div>
                    ${ dec.type === 'RESCAN' ? `
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
                        <div style="font-size:0.75rem;color:#64748b;margin-bottom:8px">▼ 재스캔 명령 실행 — 드론이 직접 해당 선반으로 비행합니다</div>
                        <button class="rescan-exec-btn" onclick="launchRescanFromDecision('${dec.id}')">
                            🚁 DRONE-01 재출동 — 재스캔 실행
                        </button>
                    </div>` : ''}
                    ${ dec.type === 'ESCALATE' ? `
                    <div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
                        <div style="font-size:0.75rem;color:#64748b;margin-bottom:8px">▼ 보고서 생성 프로세스를 실시간으로 확인합니다</div>
                        <button class="report-exec-btn" onclick="showView('report')">
                            📊 보고서 생성 프로세스 보기
                        </button>
                    </div>` : ''}
                </div>
            </div>`).join('')}
        </div>`}
    </div>`;
}

// ============================================================
// ONTOLOGY VIEW
// ============================================================
function renderOntologyView(content) {
    content.innerHTML = `
    <div class="ontology-view">
        <!-- 클래스 구조 -->
        <div class="onto-card">
            <div class="onto-title">🧠 OWL Class Hierarchy</div>
            <div class="onto-tree">
<span class="class">DroneInventorySystem</span>
  ├─ <span class="class">MobileAgent</span>
  │    └─ <span class="class">InventoryDrone</span>
  │         ├─ <span class="prop">hasLocation</span> : <span class="val">GeoPoint</span>
  │         ├─ <span class="prop">hasBattery</span>  : <span class="val">xsd:float</span>
  │         └─ <span class="prop">carriesSensor</span> : <span class="val">VisionSensor</span>
  │
  ├─ <span class="class">StorageUnit</span>
  │    └─ <span class="class">ShelfLocation</span>
  │         ├─ <span class="prop">hasAisle</span>    : <span class="val">xsd:string</span>  <span class="comment">// A, B, C, D</span>
  │         ├─ <span class="prop">hasRow</span>     : <span class="val">xsd:int</span>     <span class="comment">// 1–6 (통로 방향)</span>
  │         ├─ <span class="prop">hasSide</span>    : <span class="val">{LEFT, RIGHT}</span>
  │         ├─ <span class="prop">hasLayer</span>   : <span class="val">{L1, L2, L3, L4, L5}</span>  <span class="comment">// 높이 Layer</span>
  │         └─ <span class="prop">hasHeight</span>  : <span class="val">xsd:float</span>   <span class="comment">// 0.5m, 1.5m … 4.5m</span>
  │
  ├─ <span class="class">InventoryItem</span>
  │    ├─ <span class="prop">hasSKU</span>      : <span class="val">xsd:string</span>
  │    ├─ <span class="prop">hasQuantity</span> : <span class="val">xsd:int</span>
  │    └─ <span class="prop">storedAt</span>   : <span class="val">ShelfLocation</span>
  │
  └─ <span class="class">Event</span>
       ├─ <span class="class">Scan_Event</span>
       ├─ <span class="class">Inventory_Change_Event</span>
       │    ├─ <span class="class">Missing_Event</span>
       │    ├─ <span class="class">New_Arrival_Event</span>
       │    ├─ <span class="class">Quantity_Change_Event</span>
       │    └─ <span class="class">Location_Move_Event</span>
       └─ <span class="class">Agent_Decision_Event</span>
            ├─ <span class="class">Rescan_Command</span>
            ├─ <span class="class">WMS_Check_Action</span>
            └─ <span class="class">Escalation_Event</span>
            </div>
        </div>

        <!-- SWRL 규칙 -->
        <div class="onto-card">
            <div class="onto-title">📐 SWRL Rules — Operational Ontology</div>
            <div class="onto-tree">
<span class="comment">// Rule 1: 소진 감지</span>
<span class="rule-body">Scan_Event(?e1) ∧ day(?e1, 1) ∧ qty(?e1, ?q1) ∧
Scan_Event(?e2) ∧ day(?e2, 2) ∧ qty(?e2, 0) ∧
sameShelf(?e1, ?e2) ∧ swrlb:greaterThan(?q1, 0)</span>
→ <span class="rule-head">Missing_Event(?m) ∧ severity(?m, HIGH)</span>

<span class="comment">// Rule 2: 대량 감소 → 이상 탐지</span>
<span class="rule-body">Quantity_Change_Event(?e) ∧ delta(?e, ?d) ∧
swrlb:lessThan(?d, -5) ∧ ¬hasShipmentRecord(?e)</span>
→ <span class="rule-head">Anomaly_Event(?a) ∧ triggers(?a, WMS_Check)</span>

<span class="comment">// Rule 3: SKU 위치 불일치 → 이동 의심</span>
<span class="rule-body">ShelfLocation(?s) ∧ expectedSKU(?s, ?sku1) ∧
actualSKU(?s, ?sku2) ∧ swrlb:notEqual(?sku1, ?sku2)</span>
→ <span class="rule-head">Location_Move_Event(?m) ∧ triggers(?m, CCTV_Review)</span>

<span class="comment">// Rule 4: Agentic 재스캔 트리거</span>
<span class="rule-body">Missing_Event(?m) ∧ confidence(?m, ?c) ∧
swrlb:lessThan(?c, 0.95)</span>
→ <span class="rule-head">Rescan_Command(?r) ∧ priority(?r, IMMEDIATE)</span>
            </div>
        </div>

        <!-- 이벤트 흐름 -->
        <div class="onto-card full">
            <div class="onto-title">🔄 Operational Event Flow</div>
            <div class="event-flow">
                <div class="ef-row layer-sensor">
                    <span class="ef-layer" style="color:#22d3ee">SENSOR</span>
                    <span class="ef-content">📷 드론 카메라 → 바코드 이미지 캡처 (고속 셔터 + LED 보조광)</span>
                </div>
                <div class="ef-arrow">↓</div>
                <div class="ef-row layer-vision">
                    <span class="ef-layer" style="color:#a78bfa">VISION</span>
                    <span class="ef-content">🔍 Vision AI → Barcode/QR 디코딩 → SKU + 수량 추출 (Edge AI 실시간 처리)</span>
                </div>
                <div class="ef-arrow">↓</div>
                <div class="ef-row layer-event">
                    <span class="ef-layer" style="color:#6366f1">EVENT</span>
                    <span class="ef-content">📋 Scan_Event 생성: {drone_id, shelf_id, sku, qty, timestamp, confidence, gps_alt}</span>
                </div>
                <div class="ef-arrow">↓</div>
                <div class="ef-row layer-ontology">
                    <span class="ef-layer" style="color:#34d399">ONTOLOGY</span>
                    <span class="ef-content">🧠 Operational Ontology SWRL 추론 → Inventory_Change_Event 분류 (Missing / New / Changed / Moved)</span>
                </div>
                <div class="ef-arrow">↓</div>
                <div class="ef-row layer-action">
                    <span class="ef-layer" style="color:#fbbf24">AGENT</span>
                    <span class="ef-content">🤖 Agentic AI 자율 판단 → 재스캔 / WMS 대조 / CCTV 추출 / 보고서 / 에스컬레이션</span>
                </div>
                <div class="ef-arrow">↓</div>
                <div class="ef-row layer-action" style="border-left-color:#f97316">
                    <span class="ef-layer" style="color:#f97316">OUTPUT</span>
                    <span class="ef-content">📊 ERP 업데이트 / 대시보드 Alert / 이메일 보고서 / 다음 순찰 스케줄 자동 예약</span>
                </div>
            </div>
        </div>
    </div>`;
}

// ── Agent Modal (demo용) ───────────────────────────────────────
function showAgentModal(decisionId) {
    const modal = document.getElementById('agentModal');
    modal.style.display = 'flex';
}
function closeAgentModal() {
    document.getElementById('agentModal').style.display = 'none';
}

// ============================================================
// RESCAN MISSION — 드론이 특정 선반으로 직접 비행
// ============================================================
let rescanQueue    = [];   // 재스캔할 선반 목록
let rescanActive   = false;
let rescanAnimFrame = null;

// Agent Decision 카드에서 호출 — 해당 decision의 타겟 선반 추출
function launchRescanFromDecision(decisionId) {
    const dec = state.agentDecisions.find(d => d.id === decisionId);
    if (!dec) return;

    // MISSING 이벤트에서 선반 ID 추출
    let targets = state.changeEvents
        .filter(e => e.type === 'MISSING')
        .slice(0, 3)
        .map(e => e.shelfId);

    if (targets.length === 0) {
        // 없으면 CHANGED 중 severity high
        targets = state.changeEvents
            .filter(e => e.severity === 'high')
            .slice(0, 3)
            .map(e => e.shelfId);
    }

    if (targets.length === 0) {
        addFeed('⚠️ 재스캔 대상 선반을 찾을 수 없습니다.', 'alert-item');
        return;
    }

    state.rescanResults = []; // 초기화
    launchRescan(targets);
}

function launchRescan(shelfIds) {
    // 순찰 지도 뷰로 전환
    showView('patrol');

    // 짧은 딜레이 후 실행 (DOM 렌더링 기다림)
    setTimeout(() => {
        if (rescanActive) return;

        rescanQueue = shelfIds
            .map(id => WAREHOUSE.shelves.find(s => s.id === id))
            .filter(Boolean);

        if (rescanQueue.length === 0) return;

        rescanActive = true;
        state.patrolActive = false;  // 기존 순찰 중지
        if (state.animFrame) cancelAnimationFrame(state.animFrame);

        updateSidebarDroneState('재스캔 출동', 'status-scanning');
        addFeed(`🚁 DRONE-01 재출동 명령 — 대상: ${shelfIds.join(', ')}`, 'agent-action');

        // 재스캔 경로: Dock → 각 선반 → Dock
        const path = [];
        rescanQueue.forEach(shelf => {
            const aisle = WAREHOUSE.aisles.find(a => a.id === shelf.aisle);
            path.push({
                type: 'rescan_move',
                x: aisle.x + aisle.w / 2,
                y: shelf.y + 15,
                shelf: shelf
            });
        });
        path.push({ type: 'rescan_dock', x: 27, y: 240 });

        state.drone.x = 27;
        state.drone.y = 240;

        // 드론 엘리먼트가 없으면 재생성
        if (!state.droneEl) renderWarehouseElements();

        // 재스캔 진행 표시
        showRescanProgressPanel(shelfIds);

        runRescanLoop(path, 0);
    }, 300);
}

function runRescanLoop(path, idx) {
    if (!rescanActive || idx >= path.length) {
        finishRescan(path);
        return;
    }

    const target = path[idx];
    const dx = target.x - state.drone.x;
    const dy = target.y - state.drone.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2.5) {
        if (target.type === 'rescan_move') {
            executeRescanAtShelf(target.shelf);
            updateRescanProgressStep(target.shelf.id);
        } else if (target.type === 'rescan_dock') {
            updateSidebarDroneState('충전 중', 'status-charging');
        }
        rescanAnimFrame = requestAnimationFrame(() => runRescanLoop(path, idx + 1));
    } else {
        state.drone.x += (dx / dist) * (DRONE.speed * 1.4);  // 재스캔은 더 빠르게
        state.drone.y += (dy / dist) * (DRONE.speed * 1.4);
        updateDroneElement();
        rescanAnimFrame = requestAnimationFrame(() => runRescanLoop(path, idx));
    }
}

function executeRescanAtShelf(shelf) {
    const inv = getCurrentInventory();  // Day2 기준 재스캔
    const item = inv[shelf.id];
    const scanTime = new Date().toLocaleTimeString('ko-KR');

    // 선반 강조 (재스캔 중)
    const shelfEl = document.getElementById(`shelf-${shelf.id}`);
    if (shelfEl) {
        shelfEl.setAttribute('fill', 'rgba(251,191,36,0.35)');
        shelfEl.setAttribute('stroke', '#fbbf24');
        shelfEl.setAttribute('stroke-width', '2');
    }

    flashScanBeam();

    // 재스캔 결과: 90% 확률로 실제로 비어있음 확인, 10%는 스캔오류였음
    const wasError = Math.random() < 0.1;
    const rescanResult = {
        shelfId: shelf.id,
        location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`,
        original: { sku: null, qty: 0 },
        rescan:   wasError
            ? { sku: item?.sku || 'SKU-RECOVERED', qty: item?.qty || 3, note: '⚠️ 초기 스캔 오류 확인됨' }
            : { sku: null, qty: 0, note: '✅ 재고 소진 확인 — 출고/이동 가능성 높음' },
        verdict: wasError ? 'SCAN_ERROR' : 'CONFIRMED_EMPTY',
        timestamp: scanTime
    };

    state.rescanResults = state.rescanResults || [];
    state.rescanResults.push(rescanResult);

    // 선반 색상 최종 업데이트
    setTimeout(() => {
        if (shelfEl) {
            shelfEl.setAttribute('stroke-width', '1');
            if (wasError) {
                shelfEl.setAttribute('fill', 'rgba(52,211,153,0.2)');
                shelfEl.setAttribute('stroke', 'rgba(52,211,153,0.6)');
            } else {
                shelfEl.setAttribute('fill', 'rgba(248,113,113,0.15)');
                shelfEl.setAttribute('stroke', 'rgba(248,113,113,0.5)');
            }
        }
    }, 400);

    addFeed(
        `🔍 재스캔 완료: <span class="scan-barcode">${shelf.id}</span><br>` +
        `<span class="scan-meta">${rescanResult.rescan.note}</span>`,
        wasError ? 'agent-action' : 'alert-item',
        scanTime
    );
}

function finishRescan(path) {
    rescanActive = false;
    if (rescanAnimFrame) cancelAnimationFrame(rescanAnimFrame);
    updateSidebarDroneState('재스캔 완료', 'status-standby');
    addFeed(`✅ 재스캔 임무 완료 — ${(state.rescanResults||[]).length}개 선반 재확인`, 'agent-action');
    finalizeRescanProgressPanel();
}

function showRescanProgressPanel(shelfIds) {
    // 지도 패널 아래에 진행 패널 삽입
    const mapPanel = document.querySelector('.map-panel');
    if (!mapPanel) return;

    const existing = document.getElementById('rescanProgressPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'rescanProgressPanel';
    panel.style.cssText = 'margin-top:12px;background:rgba(15,23,42,0.8);border:1px solid rgba(251,191,36,0.3);border-radius:12px;padding:14px 18px;';
    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:1rem">🚁</span>
            <span style="font-weight:800;color:#fbbf24;font-size:0.9rem">DRONE-01 재스캔 임무 진행 중</span>
            <span style="margin-left:auto;font-size:0.75rem;color:#64748b">Agentic AI 명령</span>
        </div>
        <div id="rescanStepList" style="display:flex;flex-direction:column;gap:6px">
            ${shelfIds.map(id => `
            <div id="rstep-${id}" style="display:flex;align-items:center;gap:10px;padding:7px 12px;
                 background:rgba(255,255,255,0.03);border-radius:7px;border-left:3px solid rgba(255,255,255,0.1);
                 font-size:0.8rem;transition:all 0.3s">
                <span class="rstep-icon" style="font-size:0.9rem">⏳</span>
                <span style="font-family:monospace;color:#e2e8f0;font-weight:700">${id}</span>
                <span style="color:#64748b;flex:1">
                    ${WAREHOUSE.shelves.find(s=>s.id===id)
                        ? `Aisle-${WAREHOUSE.shelves.find(s=>s.id===id).aisle} / Row-${WAREHOUSE.shelves.find(s=>s.id===id).row}`
                        : id}
                </span>
                <span class="rstep-result" style="font-size:0.75rem;color:#374151">대기 중</span>
            </div>`).join('')}
        </div>`;

    // 오른쪽 패널 아래 삽입
    const rightPanel = document.querySelector('.right-panel');
    if (rightPanel) rightPanel.appendChild(panel);
    else mapPanel.parentElement.appendChild(panel);
}

function updateRescanProgressStep(shelfId) {
    const row = document.getElementById(`rstep-${shelfId}`);
    if (!row) return;

    const result = (state.rescanResults || []).find(r => r.shelfId === shelfId);
    if (!result) return;

    const isError   = result.verdict === 'SCAN_ERROR';
    const color     = isError ? '#34d399' : '#f87171';
    const borderClr = isError ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)';
    const icon      = isError ? '⚠️' : '✅';
    const resultTxt = isError ? '초기 스캔 오류' : '소진 확인';

    row.style.borderLeftColor = borderClr;
    row.style.background = isError ? 'rgba(52,211,153,0.05)' : 'rgba(248,113,113,0.05)';
    row.querySelector('.rstep-icon').textContent = icon;
    row.querySelector('.rstep-result').textContent = resultTxt;
    row.querySelector('.rstep-result').style.color = color;
    row.querySelector('.rstep-result').style.fontWeight = '700';
}

function finalizeRescanProgressPanel() {
    const panel = document.getElementById('rescanProgressPanel');
    if (!panel) return;

    const results = state.rescanResults || [];
    const errors   = results.filter(r => r.verdict === 'SCAN_ERROR').length;
    const confirmed = results.filter(r => r.verdict === 'CONFIRMED_EMPTY').length;

    const summary = document.createElement('div');
    summary.style.cssText = 'margin-top:12px;padding:10px 12px;background:rgba(52,211,153,0.07);border-radius:8px;border:1px solid rgba(52,211,153,0.2);font-size:0.8rem;';
    summary.innerHTML = `
        <div style="font-weight:800;color:#34d399;margin-bottom:6px">🤖 재스캔 임무 완료 — AI 최종 판단</div>
        <div style="color:#94a3b8;line-height:1.8">
            ✅ 소진 확인: <b style="color:#f87171">${confirmed}건</b> → 출고기록 대조 후 보안팀 보고<br>
            ⚠️ 초기 스캔 오류: <b style="color:#34d399">${errors}건</b> → 재고 DB 자동 복원<br>
            📋 다음 단계: WMS 출고 기록 매칭 → 에스컬레이션 결정
        </div>`;
    panel.appendChild(summary);
}

// ============================================================
// REPORT VIEW — 보고서 생성 프로세스 실시간 시각화
// ============================================================
const REPORT_STEPS = [
    {
        id: 'step-collect',
        icon: '📡',
        title: '스캔 데이터 수집',
        detail: 'Scan_Event 수집 · Day1/Day2 비교 준비',
        duration: 900
    },
    {
        id: 'step-ontology',
        icon: '🧠',
        title: 'Operational Ontology 추론',
        detail: 'SWRL 규칙 적용 · 이벤트 분류 (Missing/New/Changed/Moved)',
        duration: 1100
    },
    {
        id: 'step-wms',
        icon: '🔗',
        title: 'WMS 출고 기록 대조',
        detail: 'WMS API 조회 → 출고/입고 기록 매칭 · 미확인 건 분리',
        duration: 1300
    },
    {
        id: 'step-cctv',
        icon: '📹',
        title: 'CCTV 영상 분석',
        detail: '위치 변경 감지 구역 시간대 추출 · 이상 접근 여부 확인',
        duration: 1000
    },
    {
        id: 'step-agent',
        icon: '🤖',
        title: 'Agentic AI 자율 판단',
        detail: '재스캔 결과 통합 · 에스컬레이션 우선순위 결정',
        duration: 1200
    },
    {
        id: 'step-report',
        icon: '📄',
        title: '보고서 생성',
        detail: 'Markdown / PDF 보고서 렌더링 · ERP 업데이트 페이로드 생성',
        duration: 800
    },
    {
        id: 'step-send',
        icon: '📤',
        title: '발송 & 저장',
        detail: '이메일 / Slack 발송 · DB Audit Trail 기록 · 다음 순찰 예약',
        duration: 700
    }
];

function renderReportView(content) {
    const canGenerate = state.day2PatrolDone;
    const alreadyGenerated = !!state.reportGenerated;

    content.innerHTML = `
    <div class="report-view">
        <!-- 헤더 -->
        <div class="report-header-card">
            <div style="display:flex;align-items:center;gap:16px">
                <span style="font-size:2.5rem">📊</span>
                <div style="flex:1">
                    <h2 style="font-size:1.1rem;font-weight:800;color:#e2e8f0;margin-bottom:4px">
                        일일 재고 인텔리전스 보고서 생성 프로세스
                    </h2>
                    <p style="font-size:0.8rem;color:#64748b">
                        Drone → Scan_Event → Ontology → AI 판단 → 보고서 → ERP / 이메일 발송
                    </p>
                </div>
                <button class="btn-start go" id="reportGenBtn"
                    onclick="startReportGeneration()"
                    ${(!canGenerate || alreadyGenerated) ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
                    ${alreadyGenerated ? '✅ 보고서 완료' : canGenerate ? '▶ 보고서 생성' : '⚠️ Day2 순찰 필요'}
                </button>
            </div>
        </div>

        <!-- 프로세스 파이프라인 -->
        <div class="report-pipeline" id="reportPipeline">
            ${REPORT_STEPS.map((step, i) => `
            <div class="rp-step" id="${step.id}">
                <div class="rp-step-num">${i+1}</div>
                <div class="rp-step-body">
                    <div class="rp-step-header">
                        <span class="rp-step-icon">${step.icon}</span>
                        <span class="rp-step-title">${step.title}</span>
                        <span class="rp-step-status" id="${step.id}-status">대기</span>
                    </div>
                    <div class="rp-step-detail">${step.detail}</div>
                    <div class="rp-step-bar"><div class="rp-step-bar-fill" id="${step.id}-bar"></div></div>
                    <div class="rp-step-result" id="${step.id}-result" style="display:none"></div>
                </div>
                ${i < REPORT_STEPS.length - 1 ? '<div class="rp-arrow">↓</div>' : ''}
            </div>`).join('')}
        </div>

        <!-- 최종 보고서 (생성 후 표시) -->
        <div id="finalReport" style="display:none;margin-top:24px"></div>
    </div>`;

    // 이미 생성된 보고서 있으면 바로 표시
    if (alreadyGenerated) renderFinalReport();
}

function startReportGeneration() {
    if (!state.day2PatrolDone) return;

    const btn = document.getElementById('reportGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⚙️ 생성 중...'; }

    runReportStep(0);
}

function runReportStep(idx) {
    if (idx >= REPORT_STEPS.length) {
        finishReportGeneration();
        return;
    }

    const step   = REPORT_STEPS[idx];
    const stepEl = document.getElementById(step.id);
    const statusEl = document.getElementById(`${step.id}-status`);
    const barEl    = document.getElementById(`${step.id}-bar`);
    const resultEl = document.getElementById(`${step.id}-result`);

    if (!stepEl) { runReportStep(idx + 1); return; }

    // 활성화
    stepEl.classList.add('rp-active');
    statusEl.textContent  = '처리 중...';
    statusEl.className    = 'rp-step-status rp-status-running';

    // 프로그레스 바 애니메이션
    let pct = 0;
    const interval = setInterval(() => {
        pct = Math.min(100, pct + (100 / (step.duration / 30)));
        barEl.style.width = pct + '%';
        if (pct >= 100) clearInterval(interval);
    }, 30);

    setTimeout(() => {
        clearInterval(interval);
        barEl.style.width = '100%';

        // 완료
        stepEl.classList.remove('rp-active');
        stepEl.classList.add('rp-done');
        statusEl.textContent = '완료 ✓';
        statusEl.className   = 'rp-step-status rp-status-done';

        // 결과 메시지
        resultEl.style.display = 'block';
        resultEl.innerHTML = getStepResult(step.id);

        // 다음 스텝
        setTimeout(() => runReportStep(idx + 1), 200);
    }, step.duration);
}

function getStepResult(stepId) {
    const missing = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newCnt  = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed = state.changeEvents.filter(e => e.type === 'CHANGED').length;
    const moved   = state.changeEvents.filter(e => e.type === 'MOVED').length;
    const total   = state.scannedShelves.size || WAREHOUSE.shelves.length;
    const rescanResults = state.rescanResults || [];

    const results = {
        'step-collect': `<span class="rp-result-ok">✓ Scan_Event ${state.scanEvents.length}건 (Day1) + ${state.scanEventsDay2.length}건 (Day2) 수집 완료</span>`,
        'step-ontology': `<span class="rp-result-ok">✓ 변화 이벤트 ${state.changeEvents.length}건 분류: 소진 ${missing}건 · 신규 ${newCnt}건 · 수량변화 ${changed}건 · 이동 ${moved}건</span>`,
        'step-wms': `<span class="rp-result-ok">✓ WMS 출고기록 ${missing + changed}건 대조 → 정상 ${Math.floor((missing+changed)*0.7)}건 확인, </span><span class="rp-result-warn">미확인 ${Math.ceil((missing+changed)*0.3)}건 → 에스컬레이션 대상</span>`,
        'step-cctv': moved > 0
            ? `<span class="rp-result-warn">⚠️ ${moved}개 위치 SKU 변경 구역 CCTV 영상 ${moved*2}건 추출 완료</span>`
            : `<span class="rp-result-ok">✓ 비인가 이동 없음 확인</span>`,
        'step-agent': `<span class="rp-result-ok">✓ Agentic AI ${state.agentDecisions.length}건 결정 완료</span>` +
            (rescanResults.length > 0 ? ` · 재스캔 ${rescanResults.length}건 포함` : ''),
        'step-report': `<span class="rp-result-ok">✓ 보고서 생성 완료 (Markdown · PDF · ERP payload)</span>`,
        'step-send': `<span class="rp-result-ok">✓ 이메일 발송 완료 · Slack 알림 전송 · DB 기록 완료 · 다음 순찰 D+1 22:00 예약</span>`
    };
    return results[stepId] || '';
}

function finishReportGeneration() {
    state.reportGenerated = true;
    const btn = document.getElementById('reportGenBtn');
    if (btn) { btn.textContent = '✅ 보고서 완료'; }
    renderFinalReport();
}

function renderFinalReport() {
    const el = document.getElementById('finalReport');
    if (!el) return;

    const missing = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newCnt  = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed = state.changeEvents.filter(e => e.type === 'CHANGED').length;
    const moved   = state.changeEvents.filter(e => e.type === 'MOVED').length;
    const total   = state.scannedShelves.size || WAREHOUSE.shelves.length;
    const accuracy = (((total - missing - moved) / total) * 100).toFixed(1);
    const now     = new Date();
    const dateStr = now.toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' });
    const timeStr = now.toLocaleTimeString('ko-KR');
    const rescanResults = state.rescanResults || [];
    const errCount = rescanResults.filter(r => r.verdict === 'SCAN_ERROR').length;
    const confirmCount = rescanResults.filter(r => r.verdict === 'CONFIRMED_EMPTY').length;

    el.style.display = 'block';
    el.innerHTML = `
    <div class="final-report-card">
        <!-- 프린트/저장 액션 바 -->
        <div class="fr-actions-bar">
            <button class="fr-print-btn" onclick="printReport()">🖨️ 인쇄 (Print)</button>
            <button class="fr-archive-btn" id="archiveReportBtn" onclick="archiveReport()">🗂️ 기록 저장</button>
            <span class="fr-archive-status" id="archiveStatus"></span>
        </div>

        <!-- 보고서 헤더 -->
        <div class="fr-header">
            <div style="display:flex;align-items:flex-start;justify-content:space-between">
                <div>
                    <div class="fr-badge">CONFIDENTIAL · INTERNAL USE ONLY</div>
                    <h1 class="fr-title">일일 재고 인텔리전스 보고서</h1>
                    <div class="fr-subtitle">Daily Inventory Intelligence Report — Drone Autonomous Patrol System</div>
                </div>
                <div style="text-align:right">
                    <div class="fr-meta">생성일시: ${dateStr} ${timeStr}</div>
                    <div class="fr-meta">드론 ID: DRONE-01</div>
                    <div class="fr-meta">대상 창고: Warehouse-A (4 Aisles × 6 Rows × ${SCAN_CONFIG.endLayer - SCAN_CONFIG.startLayer + 1} Layers)</div>
                <div class="fr-meta">스캔 설정: ${LAYERS[SCAN_CONFIG.startLayer].id}~${LAYERS[SCAN_CONFIG.endLayer].id} · ${getScanModeName()}</div>
                    <div class="fr-meta">보고서 ID: RPT-${Date.now().toString(36).toUpperCase()}</div>
                </div>
            </div>
        </div>

        <!-- 핵심 KPI -->
        <div class="fr-section">
            <div class="fr-section-title">📊 핵심 지표 (Key Performance Indicators)</div>
            <div class="fr-kpi-grid">
                <div class="fr-kpi">
                    <div class="fr-kpi-val" style="color:#a5b4fc">${total}</div>
                    <div class="fr-kpi-label">총 스캔 선반</div>
                </div>
                <div class="fr-kpi">
                    <div class="fr-kpi-val" style="color:#34d399">${accuracy}%</div>
                    <div class="fr-kpi-label">재고 정확도</div>
                </div>
                <div class="fr-kpi">
                    <div class="fr-kpi-val" style="color:#fbbf24">${state.changeEvents.length}</div>
                    <div class="fr-kpi-label">변화 감지 건수</div>
                </div>
                <div class="fr-kpi">
                    <div class="fr-kpi-val" style="color:#a78bfa">${state.agentDecisions.length}</div>
                    <div class="fr-kpi-label">AI 자율 조치</div>
                </div>
            </div>
        </div>

        <!-- 변화 요약 -->
        <div class="fr-section">
            <div class="fr-section-title">🔍 재고 변화 요약</div>
            <div class="fr-change-grid">
                <div class="fr-change-row" style="border-left-color:#f87171">
                    <span class="fr-change-type" style="color:#f87171">🔴 소진 (Missing)</span>
                    <span class="fr-change-cnt">${missing}건</span>
                    <span class="fr-change-desc">전일 재고 있었으나 당일 스캔 불가 — 출고 또는 이동 추정</span>
                </div>
                <div class="fr-change-row" style="border-left-color:#34d399">
                    <span class="fr-change-type" style="color:#34d399">🟢 신규 입고 (New)</span>
                    <span class="fr-change-cnt">${newCnt}건</span>
                    <span class="fr-change-desc">전일 빈 선반에 신규 SKU 감지 — WMS 입고 기록 매칭 완료</span>
                </div>
                <div class="fr-change-row" style="border-left-color:#fbbf24">
                    <span class="fr-change-type" style="color:#fbbf24">🟡 수량 변화 (Changed)</span>
                    <span class="fr-change-cnt">${changed}건</span>
                    <span class="fr-change-desc">동일 SKU 수량 변동 — 출고 ${Math.floor(changed*0.7)}건 / 입고 ${Math.ceil(changed*0.3)}건</span>
                </div>
                <div class="fr-change-row" style="border-left-color:#22d3ee">
                    <span class="fr-change-type" style="color:#22d3ee">🔵 위치 변경 (Moved)</span>
                    <span class="fr-change-cnt">${moved}건</span>
                    <span class="fr-change-desc">SKU 위치 불일치 — CCTV 확인 요청 발송 완료</span>
                </div>
            </div>
        </div>

        <!-- 재스캔 결과 (있을 경우) -->
        ${rescanResults.length > 0 ? `
        <div class="fr-section">
            <div class="fr-section-title">🚁 Agentic AI 재스캔 임무 결과</div>
            <div class="fr-rescan-summary">
                <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:10px">
                    DRONE-01이 자율 판단으로 ${rescanResults.length}개 위치를 재스캔하여 다음과 같이 확인:
                </div>
                ${rescanResults.map(r => `
                <div class="fr-rescan-row">
                    <span class="fr-rescan-shelf">${r.shelfId}</span>
                    <span class="fr-rescan-loc">${r.location}</span>
                    <span class="fr-rescan-verdict" style="color:${r.verdict==='SCAN_ERROR'?'#34d399':'#f87171'}">
                        ${r.verdict==='SCAN_ERROR' ? '⚠️ 초기 스캔 오류 → 복원' : '✅ 소진 확인'}
                    </span>
                    <span class="fr-rescan-note">${r.rescan.note}</span>
                </div>`).join('')}
                <div style="margin-top:10px;font-size:0.78rem;color:#64748b">
                    결과: 스캔 오류 <b style="color:#34d399">${errCount}건</b> 자동 복원 ·
                    소진 확인 <b style="color:#f87171">${confirmCount}건</b> WMS 대조 완료
                </div>
            </div>
        </div>` : ''}

        <!-- AI 조치 사항 -->
        <div class="fr-section">
            <div class="fr-section-title">🤖 Agentic AI 자율 조치 내역</div>
            ${state.agentDecisions.map(dec => `
            <div class="fr-action-row">
                <span class="fr-action-type adc-type type-${dec.type.toLowerCase()}">${dec.type}</span>
                <span class="fr-action-title">${dec.title}</span>
                <span class="fr-action-time">${dec.timestamp}</span>
            </div>`).join('')}
        </div>

        <!-- 권고 사항 -->
        <div class="fr-section">
            <div class="fr-section-title">💡 권고 사항 (Recommendations)</div>
            <div class="fr-recommendations">
                ${missing > 0 ? `<div class="fr-rec high">🔴 [HIGH] ${missing}개 선반 소진 품목 — 담당 바이어에게 재주문 요청 즉시 발송 권고</div>` : ''}
                ${moved > 0 ? `<div class="fr-rec medium">🟡 [MEDIUM] ${moved}개 위치 SKU 불일치 — 창고 관리자 직접 현장 확인 필요</div>` : ''}
                ${errCount > 0 ? `<div class="fr-rec low">🔵 [LOW] ${errCount}건 스캔 오류 재발 방지 — 해당 위치 조명 및 드론 고도 점검 권고</div>` : ''}
                <div class="fr-rec info">ℹ️ 다음 정기 순찰: ${new Date(Date.now()+86400000).toLocaleDateString('ko-KR')} 22:00 자동 예약됨</div>
            </div>
        </div>

        <!-- 이메일 발송 섹션 -->
        <div class="fr-section email-section">
            <div class="fr-section-title">📧 보고서 이메일 발송</div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:220px;">
                    <input type="email" id="reportEmailInput"
                        value="myungdae.cho@gmail.com"
                        placeholder="수신 이메일 주소"
                        style="width:100%;padding:9px 14px;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.12);border-radius:8px;
                               color:#e2e8f0;font-size:0.85rem;box-sizing:border-box;outline:none;"/>
                </div>
                <button id="sendReportBtn" onclick="sendReportEmail()"
                    style="padding:9px 22px;border-radius:8px;border:1px solid rgba(251,191,36,0.5);
                           background:linear-gradient(135deg,rgba(251,191,36,0.15),rgba(251,191,36,0.08));
                           color:#fbbf24;font-size:0.85rem;font-weight:700;cursor:pointer;
                           transition:all 0.2s;white-space:nowrap;">
                    📤 이메일 발송
                </button>
                <div id="sendReportStatus" style="font-size:0.82rem;color:#64748b;"></div>
            </div>
        </div>

        <!-- 푸터 -->
        <div class="fr-footer">
            <div>자동 생성 by Drone Inventory Intelligence System v1.0</div>
            <div>Powered by Operational Ontology + Agentic AI</div>
            <div style="margin-top:4px;color:#374151">이 보고서는 ERP 시스템 및 담당자 이메일로 자동 발송되었습니다</div>
        </div>
    </div>`;
}

// ============================================================
// EMAIL SEND — POST /api/send_report
// ============================================================
async function sendReportEmail() {
    const btn       = document.getElementById('sendReportBtn');
    const statusEl  = document.getElementById('sendReportStatus');
    const emailEl   = document.getElementById('reportEmailInput');
    const recipient = emailEl ? emailEl.value.trim() : 'myungdae.cho@gmail.com';

    if (!recipient) {
        statusEl.textContent = '⚠️ 이메일 주소를 입력하세요';
        statusEl.style.color = '#fbbf24';
        return;
    }

    // 버튼 비활성화 + 로딩
    btn.disabled = true;
    btn.textContent = '⏳ 발송 중...';
    btn.style.opacity = '0.6';
    statusEl.textContent = '';

    // 보고서 데이터 수집
    const missing  = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newItems = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed  = state.changeEvents.filter(e => e.type === 'CHANGED').length;
    const moved    = state.changeEvents.filter(e => e.type === 'MOVED').length;
    const total    = state.scannedShelves.size || 48;
    const accuracy = (((total - missing - moved) / total) * 100).toFixed(1);
    const now      = new Date();

    // 권고사항 텍스트
    const recs = [];
    if (missing > 0) recs.push(`[HIGH] ${missing}개 선반 소진 품목 — 바이어 재주문 요청 즉시 발송 권고`);
    if (moved > 0)   recs.push(`[MEDIUM] ${moved}개 위치 SKU 불일치 — 창고 관리자 직접 현장 확인 필요`);
    if ((state.rescanResults||[]).filter(r=>r.verdict==='SCAN_ERROR').length > 0)
        recs.push(`[LOW] 스캔 오류 재발 방지 — 해당 위치 조명 및 드론 고도 점검 권고`);
    recs.push(`[INFO] 다음 정기 순찰: ${new Date(Date.now()+86400000).toLocaleDateString('ko-KR')} 22:00 자동 예약됨`);

    const reportData = {
        report_id:       `RPT-${Date.now().toString(36).toUpperCase()}`,
        date:            now.toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'}),
        time:            now.toLocaleTimeString('ko-KR'),
        drone_id:        'DRONE-01',
        total_scanned:   total,
        accuracy:        accuracy,
        total_changes:   state.changeEvents.length,
        agent_actions:   state.agentDecisions.length,
        missing,
        new_items:       newItems,
        changed,
        moved,
        agent_decisions: state.agentDecisions.map(d => ({
            type:      d.type,
            title:     d.title,
            timestamp: d.timestamp
        })),
        rescan_results:  (state.rescanResults || []).map(r => ({
            shelfId:  r.shelfId,
            location: r.location,
            verdict:  r.verdict
        })),
        recommendations: recs
    };

    try {
        const res = await fetch('/api/send_report', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ report_data: reportData, recipient })
        });
        const json = await res.json();

        if (json.ok) {
            btn.textContent = '✅ 발송 완료';
            btn.style.background = 'rgba(52,211,153,0.15)';
            btn.style.borderColor = 'rgba(52,211,153,0.4)';
            btn.style.color = '#34d399';
            btn.style.opacity = '1';

            if (json.demo) {
                statusEl.innerHTML = `<span style="color:#fbbf24;">⚠️ 데모 모드 — App Password 설정 시 실제 발송됩니다</span>`;
            } else {
                statusEl.innerHTML = `<span style="color:#34d399;">✅ ${recipient} 발송 완료 · ID: ${json.report_id}</span>`;
                addFeed(`📧 보고서 이메일 발송 완료 → ${recipient}`, 'agent-action');
            }
        } else {
            throw new Error(json.error || '발송 실패');
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = '📤 이메일 발송';
        btn.style.opacity = '1';
        statusEl.innerHTML = `<span style="color:#f87171;">❌ 오류: ${err.message}</span>`;
        console.error('Email send error:', err);
    }
}

// ============================================================
// PRINT REPORT
// ============================================================
function printReport() {
    // 인쇄 전 문서 타이틀 변경 (PDF 파일명에 반영)
    const origTitle = document.title;
    const now = new Date();
    const dateStr = now.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' })
                        .replace(/\. /g, '-').replace('.', '');
    document.title = `일일재고인텔리전스보고서_${dateStr}`;
    window.print();
    document.title = origTitle;
}

// ============================================================
// ARCHIVE REPORT — POST /api/archive_report
// ============================================================
async function archiveReport() {
    const btn      = document.getElementById('archiveReportBtn');
    const statusEl = document.getElementById('archiveStatus');
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = '⏳ 저장 중...';
    btn.style.opacity = '0.6';
    statusEl.textContent = '';

    // 현재 보고서 데이터 수집 (sendReportEmail과 동일 구조)
    const missing  = state.changeEvents.filter(e => e.type === 'MISSING').length;
    const newItems = state.changeEvents.filter(e => e.type === 'NEW').length;
    const changed  = state.changeEvents.filter(e => e.type === 'CHANGED').length;
    const moved    = state.changeEvents.filter(e => e.type === 'MOVED').length;
    const total    = state.scannedShelves.size || 48;
    const accuracy = (((total - missing - moved) / total) * 100).toFixed(1);
    const now      = new Date();

    const recs = [];
    if (missing > 0) recs.push(`[HIGH] ${missing}개 선반 소진 품목 — 바이어 재주문 요청 즉시 발송 권고`);
    if (moved > 0)   recs.push(`[MEDIUM] ${moved}개 위치 SKU 불일치 — 창고 관리자 직접 현장 확인 필요`);
    if ((state.rescanResults||[]).filter(r=>r.verdict==='SCAN_ERROR').length > 0)
        recs.push(`[LOW] 스캔 오류 재발 방지 — 해당 위치 조명 및 드론 고도 점검 권고`);
    recs.push(`[INFO] 다음 정기 순찰: ${new Date(Date.now()+86400000).toLocaleDateString('ko-KR')} 22:00 자동 예약됨`);

    const reportData = {
        report_id:       `RPT-${Date.now().toString(36).toUpperCase()}`,
        date:            now.toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'}),
        time:            now.toLocaleTimeString('ko-KR'),
        drone_id:        'DRONE-01',
        total_scanned:   total,
        accuracy:        accuracy,
        total_changes:   state.changeEvents.length,
        agent_actions:   state.agentDecisions.length,
        missing,
        new_items:       newItems,
        changed,
        moved,
        agent_decisions: state.agentDecisions.map(d => ({
            type: d.type, title: d.title, timestamp: d.timestamp
        })),
        rescan_results: (state.rescanResults || []).map(r => ({
            shelfId: r.shelfId, location: r.location, verdict: r.verdict
        })),
        recommendations: recs
    };

    try {
        const res  = await fetch('/api/archive_report', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ report_data: reportData })
        });
        const json = await res.json();

        if (json.ok) {
            btn.textContent = '✅ 저장 완료';
            btn.style.background = 'rgba(52,211,153,0.15)';
            btn.style.borderColor = 'rgba(52,211,153,0.4)';
            btn.style.color = '#34d399';
            btn.style.opacity = '1';
            statusEl.innerHTML = `<span style="color:#34d399;">✅ ${json.id} 기록 저장됨 · </span><button onclick="showView('archive')" style="background:rgba(99,102,241,0.18);border:1px solid rgba(99,102,241,0.45);border-radius:6px;color:#a5b4fc;font-size:0.78rem;font-weight:700;padding:3px 12px;cursor:pointer;margin-left:4px;">📂 보고서 기록 바로 보기 →</button>`;
            addFeed(`🗂️ 보고서 기록 저장 완료 → ${json.id}`, 'agent-action');

            // 아카이브 배지 업데이트
            updateArchiveBadge();
        } else {
            throw new Error(json.error || '저장 실패');
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = '🗂️ 기록 저장';
        btn.style.opacity = '1';
        statusEl.innerHTML = `<span style="color:#f87171;">❌ 오류: ${err.message}</span>`;
        console.error('Archive error:', err);
    }
}

// ─── 아카이브 배지 업데이트 ──────────────────────────────────────
async function updateArchiveBadge() {
    try {
        const res  = await fetch('/api/reports?limit=1');
        const json = await res.json();
        if (json.ok) {
            const badge = document.getElementById('archiveBadge');
            if (badge) badge.textContent = json.total;
        }
    } catch (_) {}
}

// ============================================================
// ARCHIVE VIEW — Operational Ontology + Agentic AI + MCP Layer
// ============================================================
async function renderArchiveView(content) {
    content.innerHTML = `
    <div class="archive-view">

      <!-- ── 헤더 ── -->
      <div class="archive-header-card">
        <span style="font-size:2.4rem">🗂️</span>
        <div style="flex:1">
          <h2 style="margin:0 0 4px;font-size:1.25rem;font-weight:900;color:#e2e8f0">
            보고서 기록 Archive
          </h2>
          <p style="margin:0;font-size:0.78rem;color:#64748b">
            Operational Ontology · Agentic AI · MCP 인텔리전스 레이어 통합
          </p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="archive-count-chip" id="arcTotalChip">로딩 중…</span>
          <a href="/archive" target="_blank"
             style="padding:6px 14px;border-radius:8px;font-size:0.75rem;font-weight:700;
                    background:rgba(99,102,241,0.12);color:#a5b4fc;
                    border:1px solid rgba(99,102,241,0.3);text-decoration:none;white-space:nowrap">
            🖥️ 전체 관리 페이지
          </a>
        </div>
      </div>

      <!-- ── Agentic AI 인텔리전스 패널 ── -->
      <div id="arcIntelPanel" style="margin-bottom:16px">
        <div style="text-align:center;padding:20px;color:#475569;font-size:0.82rem">
          ⏳ AI 인텔리전스 분석 중…
        </div>
      </div>

      <!-- ── 보고서 목록 ── -->
      <div style="font-size:0.72rem;font-weight:800;color:#475569;text-transform:uppercase;
                  letter-spacing:0.07em;margin-bottom:10px;padding-left:4px">
        📋 보고서 목록
      </div>
      <div id="archiveListContainer">
        <div style="text-align:center;padding:40px;color:#64748b">⏳ 불러오는 중…</div>
      </div>
    </div>`;

    await loadArchiveList();
    updateArchiveBadge();
}

// ── 보고서 목록 로드 (버그 수정: date_label / time_label 사용) ──
async function loadArchiveList() {
    const container = document.getElementById('archiveListContainer');
    const chipEl    = document.getElementById('arcTotalChip');
    const intelEl   = document.getElementById('arcIntelPanel');
    if (!container) return;

    try {
        const res  = await fetch('/api/reports?limit=100');
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || '목록 로드 실패');

        const reports = json.reports;
        if (chipEl) chipEl.textContent = `총 ${json.total}건`;

        // ── Agentic AI 인텔리전스 분석 ──────────────────────────────
        if (intelEl) renderArcIntelligence(intelEl, reports);

        if (reports.length === 0) {
            container.innerHTML = `
            <div class="archive-empty">
              <div class="archive-empty-icon">📭</div>
              <div>저장된 보고서가 없습니다</div>
              <div style="font-size:0.8rem;color:#475569;margin-top:8px">
                일일 보고서 탭에서 보고서 생성 후 "기록 저장" 버튼을 클릭하세요
              </div>
            </div>`;
            return;
        }

        container.innerHTML = `<div class="archive-list">
          ${reports.map((r, i) => {
            // ── FIX: API가 반환하는 올바른 필드명 사용 ──
            const dateLabel = r.date_label || r.date || '—';
            const timeLabel = r.time_label || r.time || '—';
            const accNum    = parseFloat(r.accuracy || 0);
            const accColor  = accNum >= 98 ? '#34d399' : accNum >= 95 ? '#fbbf24' : '#f87171';
            const riskTag   = computeRiskTag(r);
            return `
            <div class="archive-row" onclick="viewArchivedReport('${r.id}')">
              <div class="archive-row-num">${i + 1}</div>
              <div class="archive-row-meta">
                <div class="archive-row-id">${r.id}</div>
                <div class="archive-row-date">📅 ${dateLabel}</div>
                <div class="archive-row-time">⏰ ${timeLabel}</div>
                ${riskTag}
              </div>
              <div class="archive-row-kpis">
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:#a5b4fc">${r.total_scanned}</div>
                  <div class="arc-kpi-label">스캔</div>
                </div>
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:${accColor}">${accNum.toFixed(1)}%</div>
                  <div class="arc-kpi-label">정확도</div>
                </div>
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:#fbbf24">${r.total_changes}</div>
                  <div class="arc-kpi-label">변화</div>
                </div>
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:#f87171">${r.missing}</div>
                  <div class="arc-kpi-label">소진</div>
                </div>
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:#22d3ee">${r.moved}</div>
                  <div class="arc-kpi-label">이동</div>
                </div>
                <div class="arc-kpi">
                  <div class="arc-kpi-val" style="color:#a78bfa">${r.agent_actions}</div>
                  <div class="arc-kpi-label">AI조치</div>
                </div>
              </div>
              <div class="archive-row-actions">
                <button class="arc-view-btn"
                  onclick="event.stopPropagation(); viewArchivedReport('${r.id}')">👁 상세 보기</button>
                <button class="arc-del-btn"
                  onclick="event.stopPropagation(); deleteArchivedReport('${r.id}')">🗑</button>
              </div>
            </div>`;
          }).join('')}
        </div>`;

    } catch (err) {
        container.innerHTML = `
          <div style="text-align:center;padding:40px;color:#f87171">❌ 오류: ${err.message}</div>`;
    }
}

// ── 리스크 태그 계산 ────────────────────────────────────────────
function computeRiskTag(r) {
    const acc = parseFloat(r.accuracy || 0);
    if (r.missing >= 5 || acc < 95) {
        return `<span style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:4px;
                             font-size:0.64rem;font-weight:700;background:rgba(248,113,113,0.15);
                             color:#f87171;border:1px solid rgba(248,113,113,0.3)">🔴 HIGH RISK</span>`;
    } else if (r.missing >= 3 || r.total_changes >= 15) {
        return `<span style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:4px;
                             font-size:0.64rem;font-weight:700;background:rgba(251,191,36,0.15);
                             color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">🟡 MEDIUM</span>`;
    } else if (acc >= 99 && r.missing === 0) {
        return `<span style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:4px;
                             font-size:0.64rem;font-weight:700;background:rgba(52,211,153,0.12);
                             color:#34d399;border:1px solid rgba(52,211,153,0.3)">🟢 OPTIMAL</span>`;
    }
    return '';
}

// ── Agentic AI + Ontology + MCP 인텔리전스 패널 렌더링 ───────────
function renderArcIntelligence(el, reports) {
    if (!reports || reports.length === 0) {
        el.innerHTML = '';
        return;
    }

    // 통계 계산
    const totalReports  = reports.length;
    const avgAcc        = reports.reduce((s, r) => s + parseFloat(r.accuracy||0), 0) / totalReports;
    const totalMissing  = reports.reduce((s, r) => s + (r.missing||0), 0);
    const totalChanges  = reports.reduce((s, r) => s + (r.total_changes||0), 0);
    const totalAI       = reports.reduce((s, r) => s + (r.agent_actions||0), 0);

    // 트렌드 분석
    const trend = reports.length >= 2
        ? (parseFloat(reports[0].accuracy) - parseFloat(reports[reports.length-1].accuracy)).toFixed(1)
        : null;
    const trendTxt  = trend !== null
        ? (parseFloat(trend) >= 0
            ? `<span style="color:#34d399">▲ +${trend}%</span>`
            : `<span style="color:#f87171">▼ ${trend}%</span>`)
        : '<span style="color:#64748b">—</span>';

    // 이상 탐지
    const highRiskCount = reports.filter(r =>
        parseFloat(r.accuracy||0) < 95 || (r.missing||0) >= 5).length;
    const anomalyHTML   = highRiskCount > 0
        ? `<div style="margin-top:6px;padding:8px 12px;border-radius:8px;
                       background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.25);
                       font-size:0.78rem;color:#fca5a5">
             🚨 Agentic AI 이상 탐지: <strong>${highRiskCount}건</strong> 고위험 순찰 감지 — 즉시 점검 권고
           </div>`
        : `<div style="margin-top:6px;padding:8px 12px;border-radius:8px;
                       background:rgba(52,211,153,0.07);border:1px solid rgba(52,211,153,0.2);
                       font-size:0.78rem;color:#6ee7b7">
             ✅ 이상 없음 — 모든 순찰 정상 범위
           </div>`;

    // Ontology 분류 요약
    const ontClasses = [];
    const missingSum = totalMissing;
    if (missingSum > 0)    ontClasses.push(`StockDepletionEvent(${missingSum})`);
    const movedSum   = reports.reduce((s, r) => s + (r.moved||0), 0);
    if (movedSum > 0)      ontClasses.push(`LocationMismatchEvent(${movedSum})`);
    const newSum     = reports.reduce((s, r) => s + (r.new_items||0), 0);
    if (newSum > 0)        ontClasses.push(`NewStockArrivalEvent(${newSum})`);
    const changedSum = reports.reduce((s, r) => s + (r.changed||0), 0);
    if (changedSum > 0)    ontClasses.push(`QuantityChangeEvent(${changedSum})`);

    // MCP 컨텍스트 프로토콜 요약
    const mcpTools = [
        { name: 'query_report_archive', desc: `${totalReports}개 보고서 쿼리 가능` },
        { name: 'detect_anomalies',     desc: `임계값 95% 이하 / missing≥5 탐지` },
        { name: 'classify_events',      desc: `OWL 온톨로지 기반 4종 분류` },
        { name: 'generate_summary',     desc: `크로스-리포트 트렌드 요약 생성` },
    ];

    el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">

      <!-- Agentic AI 패널 -->
      <div style="background:rgba(167,139,250,0.06);border:1px solid rgba(167,139,250,0.2);
                  border-radius:12px;padding:16px">
        <div style="font-size:0.7rem;font-weight:800;color:#7c3aed;text-transform:uppercase;
                    letter-spacing:0.07em;margin-bottom:10px">🤖 Agentic AI 크로스-리포트 분석</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
          ${[
            ['순찰 횟수', totalReports, '#a5b4fc'],
            ['평균 정확도', `${avgAcc.toFixed(1)}%`, avgAcc>=98?'#34d399':avgAcc>=95?'#fbbf24':'#f87171'],
            ['누적 변화', totalChanges, '#fbbf24'],
            ['누적 AI 조치', totalAI, '#a78bfa'],
          ].map(([l,v,c])=>`
          <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1.3rem;font-weight:900;color:${c}">${v}</div>
            <div style="font-size:0.67rem;color:#64748b;margin-top:2px">${l}</div>
          </div>`).join('')}
        </div>
        <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:4px">
          📈 정확도 트렌드: ${trendTxt}
        </div>
        ${anomalyHTML}
      </div>

      <!-- Operational Ontology 패널 -->
      <div style="background:rgba(34,211,238,0.05);border:1px solid rgba(34,211,238,0.18);
                  border-radius:12px;padding:16px">
        <div style="font-size:0.7rem;font-weight:800;color:#0891b2;text-transform:uppercase;
                    letter-spacing:0.07em;margin-bottom:10px">🧠 Operational Ontology 이벤트 분류</div>
        <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:8px">
          OWL 클래스 기반 자동 분류 — InventoryEvent 상위 클래스
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
          ${ontClasses.length > 0 ? ontClasses.map(cls => {
            const [name, countStr] = cls.replace(')', '').split('(');
            const colorMap = {
              StockDepletionEvent: '#f87171',
              LocationMismatchEvent: '#22d3ee',
              NewStockArrivalEvent: '#34d399',
              QuantityChangeEvent: '#fbbf24'
            };
            const c = colorMap[name] || '#94a3b8';
            return `<div style="display:flex;align-items:center;justify-content:space-between;
                                padding:6px 10px;border-radius:6px;
                                background:rgba(255,255,255,0.02);border-left:2px solid ${c}">
              <span style="font-family:monospace;font-size:0.72rem;color:${c}">${name}</span>
              <span style="font-size:0.8rem;font-weight:700;color:${c}">${countStr}건</span>
            </div>`;
          }).join('') : '<div style="color:#475569;font-size:0.78rem">이벤트 없음</div>'}
        </div>
        <div style="font-size:0.7rem;color:#475569;font-style:italic">
          📌 owl:InventoryEvent → DronePatrolReport → WarehouseOntology v2.1
        </div>
      </div>
    </div>

    <!-- MCP 컨텍스트 프로토콜 도구 패널 -->
    <div style="background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.18);
                border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:0.7rem;font-weight:800;color:#4f46e5;text-transform:uppercase;
                  letter-spacing:0.07em;margin-bottom:10px">
        🔌 MCP (Model Context Protocol) — 아카이브 인텔리전스 도구
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        ${mcpTools.map(t => `
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(99,102,241,0.15);
                    border-radius:8px;padding:10px">
          <div style="font-family:monospace;font-size:0.7rem;color:#818cf8;margin-bottom:4px;
                      font-weight:700">${t.name}()</div>
          <div style="font-size:0.67rem;color:#64748b">${t.desc}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:10px;font-size:0.7rem;color:#475569">
        💡 MCP 서버 연동 시 LLM 에이전트가 위 도구를 호출하여 실시간 창고 인텔리전스 생성
        — <span style="color:#818cf8">warehouse-drone-mcp v1.0</span>
      </div>
    </div>`;
}

// ── 보고서 상세 보기 오버레이 ────────────────────────────────────
async function viewArchivedReport(reportId) {
    try {
        const res  = await fetch(`/api/reports/${reportId}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);

        const r = json.report;
        // payload 우선, data fallback
        const d = r.data && Object.keys(r.data).length > 0 ? r.data : r;

        const missing  = parseInt(d.missing  || r.missing  || 0);
        const newItems = parseInt(d.new_items || r.new_items|| 0);
        const changed  = parseInt(d.changed  || r.changed  || 0);
        const moved    = parseInt(d.moved    || r.moved    || 0);
        const accuracy = d.accuracy || r.accuracy || 0;
        const totalSc  = d.total_scanned || r.total_scanned || 0;
        const totalCh  = d.total_changes  || r.total_changes  || 0;
        const agAct    = d.agent_actions  || r.agent_actions  || 0;
        const dateStr  = d.date || r.date_label || '—';
        const timeStr  = d.time || r.time_label || '—';
        const reportId2= d.report_id || r.id || reportId;
        const decisions= d.agent_decisions || [];
        const recs     = d.recommendations || [];

        // OWL 온톨로지 이벤트 클래스
        const ontEvents = [
            missing  > 0 ? { cls:'StockDepletionEvent',   cnt:missing,  c:'#f87171' } : null,
            newItems > 0 ? { cls:'NewStockArrivalEvent',   cnt:newItems, c:'#34d399' } : null,
            changed  > 0 ? { cls:'QuantityChangeEvent',    cnt:changed,  c:'#fbbf24' } : null,
            moved    > 0 ? { cls:'LocationMismatchEvent',  cnt:moved,    c:'#22d3ee' } : null,
        ].filter(Boolean);

        let overlay = document.getElementById('archiveDetailOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'archiveDetailOverlay';
            overlay.className = 'archive-detail-overlay';
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';

        overlay.innerHTML = `
        <div class="archive-detail-box">
          <div class="archive-detail-header">
            <span style="font-size:1.1rem">🗂️</span>
            <h3 style="flex:1;font-size:0.95rem">${reportId2} &nbsp;—&nbsp; ${dateStr} &nbsp;${timeStr}</h3>
            <button class="arc-close-btn" onclick="closeArchiveDetail()">✕</button>
          </div>
          <div class="archive-detail-body">

            <!-- KPI -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px">
              ${[
                [totalSc, '총 스캔', '#a5b4fc'],
                [`${parseFloat(accuracy).toFixed(1)}%`, '정확도', '#34d399'],
                [totalCh, '변화', '#fbbf24'],
                [agAct,   'AI 조치', '#a78bfa']
              ].map(([v,l,c])=>`
              <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);
                          border-radius:10px;padding:12px;text-align:center">
                <div style="font-size:1.5rem;font-weight:900;color:${c}">${v}</div>
                <div style="font-size:0.68rem;color:#64748b;margin-top:3px">${l}</div>
              </div>`).join('')}
            </div>

            <!-- 재고 변화 요약 -->
            <div style="font-size:0.7rem;font-weight:800;color:#64748b;text-transform:uppercase;
                        letter-spacing:0.06em;margin-bottom:8px">📦 재고 변화 요약</div>
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:16px">
              ${[['#f87171','🔴 소진',missing],['#34d399','🟢 신규 입고',newItems],
                 ['#fbbf24','🟡 수량 변화',changed],['#22d3ee','🔵 위치 변경',moved]
                ].map(([c,l,v])=>`
              <div style="display:flex;justify-content:space-between;align-items:center;
                          padding:7px 12px;border-radius:7px;border-left:3px solid ${c};
                          background:rgba(255,255,255,0.02)">
                <span style="color:${c};font-size:0.8rem;font-weight:700">${l}</span>
                <span style="color:${c};font-size:0.95rem;font-weight:900">${v}건</span>
              </div>`).join('')}
            </div>

            <!-- Ontology 이벤트 분류 -->
            ${ontEvents.length > 0 ? `
            <div style="font-size:0.7rem;font-weight:800;color:#0891b2;text-transform:uppercase;
                        letter-spacing:0.06em;margin-bottom:8px">🧠 Ontology 이벤트 분류</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
              ${ontEvents.map(e=>`
              <span style="padding:4px 10px;border-radius:6px;font-family:monospace;font-size:0.7rem;
                           font-weight:700;background:${e.c}18;color:${e.c};border:1px solid ${e.c}40">
                ${e.cls}(${e.cnt})
              </span>`).join('')}
            </div>` : ''}

            <!-- AI 조치 -->
            ${decisions.length > 0 ? `
            <div style="font-size:0.7rem;font-weight:800;color:#64748b;text-transform:uppercase;
                        letter-spacing:0.06em;margin-bottom:8px">🤖 Agentic AI 조치</div>
            <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:16px">
              ${decisions.map(dec => {
                const tc = {RESCAN:'#a78bfa',CONFIRM:'#34d399',ALERT:'#f87171',ESCALATE:'#fbbf24'}[dec.type]||'#94a3b8';
                return `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;
                                   border-radius:7px;background:rgba(255,255,255,0.02)">
                  <span style="background:${tc}22;color:${tc};padding:2px 8px;border-radius:4px;
                               font-size:0.68rem;font-weight:700;flex-shrink:0">${dec.type}</span>
                  <span style="flex:1;font-size:0.8rem;color:#e2e8f0">${dec.title}</span>
                  <span style="font-family:monospace;font-size:0.7rem;color:#64748b">${dec.timestamp||''}</span>
                </div>`;
              }).join('')}
            </div>` : ''}

            <!-- 권고 사항 -->
            ${recs.length > 0 ? `
            <div style="font-size:0.7rem;font-weight:800;color:#64748b;text-transform:uppercase;
                        letter-spacing:0.06em;margin-bottom:8px">📌 권고 사항</div>
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">
              ${recs.map(rec => {
                const level = rec.includes('[HIGH]')?'HIGH':rec.includes('[MEDIUM]')?'MEDIUM':rec.includes('[LOW]')?'LOW':'INFO';
                const c  = {HIGH:'#f87171',MEDIUM:'#fbbf24',LOW:'#22d3ee',INFO:'#a5b4fc'}[level];
                const bg = {HIGH:'rgba(248,113,113,0.07)',MEDIUM:'rgba(251,191,36,0.07)',
                            LOW:'rgba(34,211,238,0.07)',INFO:'rgba(99,102,241,0.07)'}[level];
                return `<div style="padding:8px 12px;border-radius:7px;border-left:3px solid ${c};
                                   background:${bg};font-size:0.78rem;color:${c}">${rec}</div>`;
              }).join('')}
            </div>` : ''}

            <!-- MCP 도구 호출 미리보기 -->
            <div style="background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.18);
                        border-radius:8px;padding:12px;margin-bottom:16px">
              <div style="font-size:0.68rem;font-weight:800;color:#818cf8;margin-bottom:6px">
                🔌 MCP 컨텍스트 — 이 보고서
              </div>
              <pre style="font-family:monospace;font-size:0.67rem;color:#94a3b8;margin:0;
                          white-space:pre-wrap">get_report("${reportId2}") →
  date: "${dateStr}", accuracy: ${parseFloat(accuracy).toFixed(1)}%
  events: StockDepletion(${missing}), NewArrival(${newItems}), QtyChange(${changed}), LocMismatch(${moved})
  ai_actions: ${agAct}, risk: ${parseFloat(accuracy)<95||missing>=5?'HIGH':missing>=3||totalCh>=15?'MEDIUM':'LOW'}</pre>
            </div>

            <!-- 액션 버튼 -->
            <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:10px;
                        border-top:1px solid rgba(255,255,255,0.05)">
              <button onclick="printArchivedReport('${reportId}')"
                style="padding:8px 18px;border-radius:7px;border:1px solid rgba(99,102,241,0.4);
                       background:rgba(99,102,241,0.1);color:#a5b4fc;font-size:0.8rem;
                       font-weight:700;cursor:pointer">🖨️ 인쇄</button>
              <button onclick="window.open('/archive#${reportId}','_blank')"
                style="padding:8px 18px;border-radius:7px;border:1px solid rgba(34,211,238,0.3);
                       background:rgba(34,211,238,0.07);color:#22d3ee;font-size:0.8rem;
                       font-weight:700;cursor:pointer">🖥️ 관리 페이지</button>
              <button onclick="closeArchiveDetail()"
                style="padding:8px 18px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);
                       background:transparent;color:#64748b;font-size:0.8rem;cursor:pointer">닫기</button>
            </div>
          </div>
        </div>`;

        overlay.onclick = e => { if (e.target === overlay) closeArchiveDetail(); };

    } catch (err) {
        alert(`❌ 보고서 로드 오류: ${err.message}`);
    }
}

function closeArchiveDetail() {
    const ov = document.getElementById('archiveDetailOverlay');
    if (ov) ov.style.display = 'none';
}

async function deleteArchivedReport(reportId) {
    if (!confirm(`보고서 ${reportId}를 삭제하시겠습니까?`)) return;
    try {
        const res  = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        addFeed(`🗑 보고서 삭제: ${reportId}`, 'warning');
        const content = document.getElementById('dashboardContent');
        await renderArchiveView(content);
    } catch (err) {
        alert(`❌ 삭제 오류: ${err.message}`);
    }
}

async function printArchivedReport(reportId) {
    closeArchiveDetail();
    setTimeout(() => window.print(), 300);
}
