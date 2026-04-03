/* ============================================================
   Drone Inventory Intelligence System
   Drone → Vision AI → Barcode → Inventory DB → Daily Comparison
   + Agentic AI: 자율 판단 → 재스캔 / 보고 / 에스컬레이션
   ============================================================ */

'use strict';

// ── 상수 ──────────────────────────────────────────────────────
const WAREHOUSE = {
    width: 760,
    height: 420,
    aisles: [
        { id: 'A', x: 80,  y: 60, w: 100, h: 300, label: 'Aisle-A' },
        { id: 'B', x: 230, y: 60, w: 100, h: 300, label: 'Aisle-B' },
        { id: 'C', x: 380, y: 60, w: 100, h: 300, label: 'Aisle-C' },
        { id: 'D', x: 530, y: 60, w: 100, h: 300, label: 'Aisle-D' },
    ],
    shelves: [] // 자동 생성
};

const DRONE = { size: 14, speed: 1.8, scanRadius: 45 };

// 통로별 선반 위치 자동 생성
WAREHOUSE.aisles.forEach(aisle => {
    const shelfCount = 6;
    for (let i = 0; i < shelfCount; i++) {
        const y = aisle.y + 20 + i * 45;
        // 좌측 선반
        WAREHOUSE.shelves.push({
            id: `${aisle.id}L${i+1}`,
            aisle: aisle.id,
            side: 'L',
            x: aisle.x - 30,
            y: y,
            w: 28, h: 30,
            row: i + 1
        });
        // 우측 선반
        WAREHOUSE.shelves.push({
            id: `${aisle.id}R${i+1}`,
            aisle: aisle.id,
            side: 'R',
            x: aisle.x + aisle.w + 2,
            y: y,
            w: 28, h: 30,
            row: i + 1
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

    drone: { x: 30, y: 210, angle: 0, battery: 100 },
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
    document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));

    const content = document.getElementById('dashboardContent');
    switch (view) {
        case 'patrol':   renderPatrolView(content);   break;
        case 'scanlog':  renderScanlogView(content);  break;
        case 'compare':  renderCompareView(content);  break;
        case 'agent':    renderAgentView(content);    break;
        case 'ontology': renderOntologyView(content); break;
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

// ============================================================
// PATROL VIEW
// ============================================================
function renderPatrolView(content) {
    const svgW = WAREHOUSE.width;
    const svgH = WAREHOUSE.height;

    content.innerHTML = `
    <div class="patrol-layout">
        <div class="map-panel">
            <div class="map-header">
                <span class="map-title">🗺️ 창고 디지털 트윈 — Drone Patrol View</span>
                <div class="map-controls">
                    <button class="btn-start reset-btn" onclick="resetPatrol()">↺ 초기화</button>
                    <button class="btn-start go" id="patrolBtn" onclick="togglePatrol()">▶ 순찰 시작</button>
                </div>
            </div>
            <svg id="warehouseMap" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
                <!-- 배경 격자 -->
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
                <!-- 창고 외곽 -->
                <rect x="10" y="10" width="${svgW-20}" height="${svgH-20}"
                      fill="none" stroke="rgba(99,102,241,0.25)" stroke-width="1.5" rx="4"/>
                <!-- 도킹 스테이션 -->
                <rect x="12" y="185" width="30" height="50" rx="4"
                      fill="rgba(34,211,238,0.08)" stroke="rgba(34,211,238,0.4)" stroke-width="1"/>
                <text x="27" y="205" fill="#22d3ee" font-size="7" text-anchor="middle" font-family="monospace">DOCK</text>
                <text x="27" y="215" fill="#22d3ee" font-size="6" text-anchor="middle" font-family="monospace">⚡</text>
                <!-- SVG 동적 요소들은 JS로 추가 -->
                <g id="shelvesGroup"></g>
                <g id="pathGroup"></g>
                <g id="scanBeamGroup"></g>
                <g id="droneGroup"></g>
                <g id="labelsGroup"></g>
            </svg>
        </div>

        <div class="right-panel">
            <!-- Mission Progress -->
            <div class="mission-card">
                <div class="mission-card-title">📊 미션 진행 현황</div>
                <div class="progress-bar-wrap">
                    <div class="progress-bar-fill" id="missionProgress" style="width:0%"></div>
                </div>
                <div class="mission-stats-grid">
                    <div class="ms-item">
                        <div class="ms-val" id="ms-scanned">0</div>
                        <div class="ms-label">스캔 완료</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-total">${WAREHOUSE.shelves.length}</div>
                        <div class="ms-label">전체 선반</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-battery">100%</div>
                        <div class="ms-label">배터리</div>
                    </div>
                    <div class="ms-item">
                        <div class="ms-val" id="ms-aisle">—</div>
                        <div class="ms-label">현재 통로</div>
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

function renderWarehouseElements() {
    const shelvesG = document.getElementById('shelvesGroup');
    const labelsG  = document.getElementById('labelsGroup');
    if (!shelvesG) return;

    // 통로 배경 + 레이블
    WAREHOUSE.aisles.forEach(aisle => {
        // 통로 바닥
        const rect = createSVG('rect', {
            x: aisle.x, y: aisle.y, width: aisle.w, height: aisle.h,
            fill: 'rgba(99,102,241,0.04)',
            stroke: 'rgba(99,102,241,0.15)', 'stroke-width': '1', rx: '3'
        });
        shelvesG.appendChild(rect);
        // 레이블
        const lbl = createSVG('text', {
            x: aisle.x + aisle.w / 2,
            y: aisle.y + aisle.h + 18,
            fill: '#4b5563',
            'font-size': '10',
            'text-anchor': 'middle',
            'font-family': 'monospace'
        });
        lbl.textContent = aisle.label;
        labelsG.appendChild(lbl);
    });

    // 선반 렌더링
    WAREHOUSE.shelves.forEach(shelf => {
        const inv = getCurrentInventory();
        const item = inv[shelf.id];
        const hasItem = item && item.qty > 0;

        const rect = createSVG('rect', {
            id: `shelf-${shelf.id}`,
            x: shelf.x, y: shelf.y,
            width: shelf.w, height: shelf.h,
            fill: hasItem ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
            stroke: hasItem ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)',
            'stroke-width': '1', rx: '2'
        });
        shelvesG.appendChild(rect);
    });

    // 드론 엘리먼트 생성
    const droneG = document.getElementById('droneGroup');
    droneG.innerHTML = '';

    // 스캔 빔
    const scanBeam = createSVG('circle', {
        id: 'scanBeam',
        cx: state.drone.x, cy: state.drone.y,
        r: DRONE.scanRadius,
        fill: 'url(#scanBeamGrad)',
        opacity: '0'
    });
    droneG.appendChild(scanBeam);
    state.scanBeamEl = scanBeam;

    // 드론 본체
    const droneBody = createSVG('g', { id: 'droneBody' });

    // 프로펠러 4개
    [[-8,-8],[8,-8],[-8,8],[8,8]].forEach(([dx,dy]) => {
        const prop = createSVG('ellipse', {
            cx: state.drone.x + dx,
            cy: state.drone.y + dy,
            rx: '5', ry: '2',
            fill: 'rgba(34,211,238,0.4)',
            stroke: '#22d3ee', 'stroke-width': '0.5'
        });
        droneBody.appendChild(prop);
    });

    // 드론 중심
    const center = createSVG('circle', {
        cx: state.drone.x, cy: state.drone.y,
        r: '6',
        fill: '#1e3a5f',
        stroke: '#6366f1', 'stroke-width': '2',
        filter: 'url(#glow)'
    });
    droneBody.appendChild(center);

    // 드론 LED
    const led = createSVG('circle', {
        cx: state.drone.x, cy: state.drone.y,
        r: '2.5',
        fill: '#22d3ee'
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
function buildPatrolPath() {
    const path = [];
    // 각 통로를 순서대로 순찰 (지그재그)
    WAREHOUSE.aisles.forEach((aisle, ai) => {
        const aisleShelvesL = WAREHOUSE.shelves
            .filter(s => s.aisle === aisle.id && s.side === 'L')
            .sort((a,b) => (ai % 2 === 0 ? a.y - b.y : b.y - a.y));
        const aisleShelvesR = WAREHOUSE.shelves
            .filter(s => s.aisle === aisle.id && s.side === 'R')
            .sort((a,b) => (ai % 2 === 0 ? a.y - b.y : b.y - a.y));

        // 통로 진입점
        path.push({
            type: 'move',
            x: aisle.x + aisle.w / 2,
            y: ai % 2 === 0 ? aisle.y + 10 : aisle.y + aisle.h - 10,
            aisle: aisle.id
        });

        // 선반 순서대로 스캔 포인트
        const count = Math.max(aisleShelvesL.length, aisleShelvesR.length);
        for (let i = 0; i < count; i++) {
            const shelfY = ai % 2 === 0
                ? aisleShelvesL[i]?.y ?? aisleShelvesR[i]?.y
                : aisleShelvesL[count-1-i]?.y ?? aisleShelvesR[count-1-i]?.y;

            path.push({
                type: 'scan',
                x: aisle.x + aisle.w / 2,
                y: (shelfY ?? 0) + 15,
                aisle: aisle.id,
                shelfL: aisleShelvesL[ai%2===0 ? i : count-1-i],
                shelfR: aisleShelvesR[ai%2===0 ? i : count-1-i],
            });
        }
    });

    // 도킹 귀환
    path.push({ type: 'dock', x: 27, y: 210, aisle: null });
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

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '⏸ 순찰 중지'; btn.className = 'btn-start stop'; }

    updateSidebarDroneState('비행 중', 'status-flying');
    addFeed(`🚁 DRONE-01 순찰 시작 — Day ${state.currentDay} (${DAY_DATES[state.currentDay]})`, 'agent-action');

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
    state.drone = { x: 27, y: 210, angle: 0, battery: 100 };
    state.pathIndex = 0;
    state.scannedShelves = new Set();
    state.scanEvents = [];
    state.scanEventsDay2 = [];
    state.changeEvents = [];
    state.agentDecisions = [];
    state.agentActionCount = 0;
    state.patrolDone = false;
    state.day2PatrolDone = false;
    inventoryDay1 = buildInventoryDay(1);
    inventoryDay2 = buildDay2(inventoryDay1);

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
        } else if (target.type === 'dock') {
            updateSidebarDroneState('충전 중', 'status-charging');
        }
        state.pathIndex++;
        if (target.aisle) {
            updateSidebarAisle(target.aisle);
            document.getElementById('ms-aisle').textContent = `Aisle-${target.aisle}`;
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

    [target.shelfL, target.shelfR].forEach(shelf => {
        if (!shelf || state.scannedShelves.has(shelf.id)) return;
        state.scannedShelves.add(shelf.id);

        const item = inv[shelf.id];
        const event = {
            id: `SE-${Date.now()}-${shelf.id}`,
            timestamp: scanTime,
            day: state.currentDay,
            shelfId: shelf.id,
            aisle: shelf.aisle,
            side: shelf.side,
            sku: item?.sku || null,
            qty: item?.qty || 0,
            confidence: item?.confidence || 0,
            location: `Aisle-${shelf.aisle} / Row-${shelf.row} / ${shelf.side === 'L' ? '좌측' : '우측'}`
        };

        if (state.currentDay === 1) {
            state.scanEvents.push(event);
        } else {
            state.scanEventsDay2.push(event);
        }
        scanned.push(event);

        // 선반 색상 업데이트
        const shelfEl = document.getElementById(`shelf-${shelf.id}`);
        if (shelfEl) {
            shelfEl.setAttribute('fill', event.sku
                ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.1)');
            shelfEl.setAttribute('stroke', event.sku
                ? 'rgba(52,211,153,0.6)' : 'rgba(248,113,113,0.4)');
        }

        // 피드 업데이트
        const skuText = event.sku ? `${event.sku} × ${event.qty}` : '빈 선반';
        const dirClass = shelf.side === 'L' ? 'left-scan' : 'right-scan';
        const dirBadge = shelf.side === 'L'
            ? '<span class="scan-dir dir-L">◄ 좌</span>'
            : '<span class="scan-dir dir-R">우 ►</span>';

        addFeed(`${dirBadge}<span class="scan-barcode">${shelf.id}</span>
            <br><span class="scan-meta">${skuText} · 신뢰도 ${((event.confidence||0)*100).toFixed(1)}%</span>`,
            dirClass, scanTime);
    });

    // 스캔 빔 효과
    if (scanned.length > 0) {
        flashScanBeam();
        updateTotalScanned();
    }
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
    document.getElementById('totalScanned').textContent = total;
    document.getElementById('ms-scanned').textContent = state.scannedShelves.size;
    document.getElementById('scanBadge').textContent = total;
}

function updateMissionStats() {
    const pct = Math.min(100, Math.round(state.scannedShelves.size / WAREHOUSE.shelves.length * 100));
    const pb = document.getElementById('missionProgress');
    if (pb) pb.style.width = pct + '%';

    const bat = document.getElementById('ms-battery');
    if (bat) bat.textContent = state.drone.battery.toFixed(0) + '%';
    document.getElementById('sb-battery').textContent = state.drone.battery.toFixed(0) + '%';
    document.getElementById('sb-scanCount').textContent = state.scannedShelves.size;
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
    addFeed(`✅ DRONE-01 순찰 완료 — ${state.scannedShelves.size}개 선반 스캔 완료`, 'agent-action');

    const btn = document.getElementById('patrolBtn');
    if (btn) { btn.textContent = '✅ 순찰 완료'; btn.className = 'btn-start reset-btn'; }

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

    content.innerHTML = `
    <div class="scanlog-view">
        <div class="log-filter-bar">
            <span style="font-size:0.82rem;color:#64748b;margin-right:4px;">필터:</span>
            <div class="filter-chip active" onclick="filterScanlog(this,'all')">전체 (${events.length})</div>
            <div class="filter-chip" onclick="filterScanlog(this,'L')">◄ 좌측 선반</div>
            <div class="filter-chip" onclick="filterScanlog(this,'R')">우측 선반 ►</div>
            <div class="filter-chip" onclick="filterScanlog(this,'item')">아이템 있음</div>
            <div class="filter-chip" onclick="filterScanlog(this,'empty')">빈 선반</div>
        </div>
        <div class="events-table-wrap">
            <table class="events-table" id="scanlogTable">
                <thead>
                    <tr>
                        <th>이벤트 ID</th>
                        <th>시간</th>
                        <th>위치</th>
                        <th>방향</th>
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
    return events.map(ev => `
        <tr data-side="${ev.side}" data-has="${ev.sku ? 'item' : 'empty'}">
            <td><span class="badge-scan">${ev.id.substring(0,14)}…</span></td>
            <td style="font-family:monospace;font-size:0.78rem;color:#64748b">${ev.timestamp}</td>
            <td>${ev.location}</td>
            <td><span class="badge-scan ${ev.side === 'L' ? 'badge-left' : 'badge-right'}">
                ${ev.side === 'L' ? '◄ 좌측' : '우측 ►'}</span></td>
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
        </tr>`).join('');
}

function filterScanlog(el, filter) {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');

    const events = state.currentDay === 1 ? state.scanEvents : state.scanEventsDay2;
    let filtered = events;
    if (filter === 'L')     filtered = events.filter(e => e.side === 'L');
    if (filter === 'R')     filtered = events.filter(e => e.side === 'R');
    if (filter === 'item')  filtered = events.filter(e => e.sku);
    if (filter === 'empty') filtered = events.filter(e => !e.sku);

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
  │         ├─ <span class="prop">hasAisle</span>    : <span class="val">xsd:string</span>
  │         ├─ <span class="prop">hasRow</span>     : <span class="val">xsd:int</span>
  │         └─ <span class="prop">hasSide</span>    : <span class="val">{LEFT, RIGHT}</span>
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
