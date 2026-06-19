"""
Gotham AIP — FastAPI + Neo4j Backend
=====================================
• Expert KB: 서버 영속 저장 (Neo4j 우선, SQLite 폴백)
• RBAC: 보안등급별 접근 제어 (일반 < 대외비 < 비밀 < 극비)
• MCP Layer: 센서 시뮬레이터 Agentic AI 제어
• MOE Stats: 기여자 통계 트래킹
• Threat Ontology: FPV 드론 위협 탐지→분류→ROE→INTERCEPT 파이프라인
"""

import subprocess, sys

def _ensure_pkg(pkg, import_name=None):
    """설치 안 된 패키지를 자동 설치"""
    import_name = import_name or pkg
    try:
        __import__(import_name)
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "-q"])

# WebSocket 지원 라이브러리 자동 설치
_ensure_pkg("websockets")
_ensure_pkg("uvicorn[standard]", "uvicorn")

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import sqlite3
import json
import asyncio
import random
import math
import time
from datetime import datetime, timezone
from pathlib import Path
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gotham")

# ─── Threat Ontology Engine ───────────────────────────────────────────────────
from threat_ontology import (
    ThreatOntologyEngine, ROEMode, DroneClass, DroneType,
    ThreatLevel, InterceptDecision, DroneTrack, DEFAULT_ASSETS
)

_threat_engine = ThreatOntologyEngine(roe=ROEMode.WEAPONS_TIGHT)

# ─── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Gotham AIP API",
    version="3.0.0",
    description="작전 상황인식 플랫폼 — Expert KB · RBAC · MCP · MOE Stats · Threat Ontology"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── DB Setup ─────────────────────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "gotham.db"

CLEARANCE_RANK = {"일반": 0, "대외비": 1, "비밀": 2, "극비": 3}
ROLE_CLEARANCE = {
    "analyst":      "일반",
    "officer":      "대외비",
    "commander":    "비밀",
    "super":        "극비",
}

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 위협 항적 테이블 (Threat Tracks)
    c.execute("""
        CREATE TABLE IF NOT EXISTS threat_tracks (
            track_id      TEXT NOT NULL,
            lat           REAL,
            lon           REAL,
            alt_m         REAL,
            velocity_kph  REAL,
            heading_deg   REAL,
            ir_temp_c     REAL,
            rf_freq_mhz   REAL,
            drone_class   TEXT,
            drone_type    TEXT,
            threat_score  REAL,
            threat_level  TEXT,
            swarm_id      TEXT,
            created_at    TEXT NOT NULL
        )
    """)

    # 요격 명령 테이블 (Intercept Orders)
    c.execute("""
        CREATE TABLE IF NOT EXISTS intercept_orders (
            order_id        TEXT PRIMARY KEY,
            target_id       TEXT NOT NULL,
            decision        TEXT NOT NULL,
            atk_drone_id    TEXT,
            intercept_lat   REAL,
            intercept_lon   REAL,
            intercept_alt_m REAL,
            priority        INTEGER,
            roe_mode        TEXT,
            threat_score    REAL,
            threat_level    TEXT,
            reason          TEXT,
            ttx_sec         REAL,
            issued_at       TEXT NOT NULL
        )
    """)


    # Expert KB 테이블
    c.execute("""
        CREATE TABLE IF NOT EXISTS expert_kb (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            content     TEXT NOT NULL,
            domain      TEXT NOT NULL,
            contributor TEXT NOT NULL,
            clearance   TEXT NOT NULL DEFAULT '일반',
            tags        TEXT DEFAULT '[]',
            source      TEXT DEFAULT '전문가',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            view_count  INTEGER DEFAULT 0,
            active      INTEGER DEFAULT 1
        )
    """)

    # 기여자 통계 (MOE Stats)
    c.execute("""
        CREATE TABLE IF NOT EXISTS moe_contributors (
            contributor TEXT PRIMARY KEY,
            entry_count INTEGER DEFAULT 0,
            total_views INTEGER DEFAULT 0,
            domains     TEXT DEFAULT '[]',
            last_active TEXT,
            role        TEXT DEFAULT 'analyst'
        )
    """)

    # 사용자/역할 (RBAC)
    c.execute("""
        CREATE TABLE IF NOT EXISTS rbac_users (
            username    TEXT PRIMARY KEY,
            role        TEXT NOT NULL DEFAULT 'analyst',
            clearance   TEXT NOT NULL DEFAULT '일반',
            active      INTEGER DEFAULT 1,
            created_at  TEXT NOT NULL
        )
    """)

    # 센서 상태 (MCP / Hydration Layer)
    c.execute("""
        CREATE TABLE IF NOT EXISTS sensor_state (
            sensor_id   TEXT PRIMARY KEY,
            sensor_type TEXT NOT NULL,
            status      TEXT DEFAULT 'active',
            confidence  REAL DEFAULT 0.9,
            last_reading TEXT,
            controlled_by TEXT DEFAULT 'manual',
            updated_at  TEXT NOT NULL
        )
    """)

    # 세션 토큰 (간단한 JWT-less 세션)
    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            username    TEXT NOT NULL,
            role        TEXT NOT NULL,
            clearance   TEXT NOT NULL,
            expires_at  TEXT NOT NULL
        )
    """)

    # 기본 사용자 삽입
    now = datetime.now(timezone.utc).isoformat()
    default_users = [
        ("analyst1",    "analyst",   "일반",  now),
        ("officer1",    "officer",   "대외비", now),
        ("commander1",  "commander", "비밀",  now),
        ("super1",      "super",     "극비",  now),
    ]
    for u, r, cl, t in default_users:
        c.execute("""
            INSERT OR IGNORE INTO rbac_users (username, role, clearance, active, created_at)
            VALUES (?, ?, ?, 1, ?)
        """, (u, r, cl, t))

    # 기본 센서 삽입
    sensors = [
        ("SAR-01",    "satellite", "active",   0.85),
        ("OPT-02",    "satellite", "active",   0.83),
        ("RAD-01",    "radar",     "active",   0.92),
        ("RAD-02",    "radar",     "active",   0.91),
        ("RF-SENSE",  "rf",        "active",   0.78),
        ("DF-01",     "rf",        "standby",  0.72),
        ("EO-A1",     "eo_ir",     "active",   0.88),
        ("IR-B2",     "eo_ir",     "active",   0.86),
        ("AIS",       "ais",       "active",   0.95),
        ("ADS-B",     "adsb",      "active",   0.94),
        ("HUMINT-01", "humint",    "standby",  0.65),
        ("WX-01",     "weather",   "active",   0.70),
    ]
    for sid, stype, st, conf in sensors:
        c.execute("""
            INSERT OR IGNORE INTO sensor_state
            (sensor_id, sensor_type, status, confidence, controlled_by, updated_at)
            VALUES (?, ?, ?, ?, 'manual', ?)
        """, (sid, stype, st, conf, now))

    conn.commit()
    conn.close()
    logger.info(f"DB initialized at {DB_PATH}")

init_db()

# ─── Models ───────────────────────────────────────────────────────────────────
class ExpertKBCreate(BaseModel):
    title:       str
    content:     str
    domain:      str
    contributor: str
    clearance:   str = "일반"
    tags:        List[str] = []

class ExpertKBUpdate(BaseModel):
    title:       Optional[str] = None
    content:     Optional[str] = None
    domain:      Optional[str] = None
    clearance:   Optional[str] = None
    tags:        Optional[List[str]] = None

# ── Threat Ontology Models ────────────────────────────────────────────────────
class ThreatTrackInput(BaseModel):
    """단일 드론 항적 입력 (다중 센서 융합 후)"""
    track_id:     str
    lat:          float
    lon:          float
    alt_m:        float = 100.0
    velocity_kph: float = 0.0
    heading_deg:  float = 0.0
    ir_temp_c:    float = 28.0
    rf_freq_mhz:  float = 0.0
    rf_power_dbm: float = -80.0
    iff_code:     Optional[str] = None
    swarm_id:     Optional[str] = None

class ThreatBatchInput(BaseModel):
    """다중 항적 배치 입력"""
    tracks:  List[ThreatTrackInput]
    roe:     Optional[str] = None   # WEAPONS_FREE | WEAPONS_TIGHT | WEAPONS_HOLD

class ROEChangeRequest(BaseModel):
    roe: str   # WEAPONS_FREE | WEAPONS_TIGHT | WEAPONS_HOLD

# ── Sensor Models ─────────────────────────────────────────────────────────────
class SensorCommand(BaseModel):
    sensor_id:  str
    action:     str          # activate | deactivate | set_confidence | request_data
    value:      Optional[Any] = None
    priority:   str = "NORMAL"   # LOW | NORMAL | HIGH | CRITICAL

class MCPAgentCommand(BaseModel):
    agent_id:   str = "AGENTIC-AI-01"
    command:    str          # scan_all | focus | jam_rf | request_sensor
    targets:    List[str] = []
    params:     Dict[str, Any] = {}

class LoginRequest(BaseModel):
    username: str
    role:     Optional[str] = None   # override for demo

# ─── DB Helpers ───────────────────────────────────────────────────────────────
def get_conn():
    return sqlite3.connect(DB_PATH)

def next_exp_id(conn) -> str:
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM expert_kb")
    n = c.fetchone()[0]
    return f"EXP{str(n+1).padStart_equiv(3)}"

def padded(n: int, width=3) -> str:
    return str(n).zfill(width)

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def update_contributor(conn, contributor: str, domain: str, role: str = "analyst"):
    c = conn.cursor()
    c.execute("SELECT contributor FROM moe_contributors WHERE contributor=?", (contributor,))
    row = c.fetchone()
    if row:
        c.execute("""
            UPDATE moe_contributors
            SET entry_count = entry_count + 1,
                last_active = ?,
                domains = (
                    SELECT json(json_insert(domains, '$[#]', ?))
                    FROM moe_contributors WHERE contributor=?
                )
            WHERE contributor=?
        """, (now_iso(), domain, contributor, contributor))
    else:
        c.execute("""
            INSERT INTO moe_contributors (contributor, entry_count, domains, last_active, role)
            VALUES (?, 1, ?, ?, ?)
        """, (contributor, json.dumps([domain]), now_iso(), role))
    conn.commit()

# ─── RBAC Auth (간단한 토큰 기반) ─────────────────────────────────────────────
DEMO_TOKENS: Dict[str, dict] = {}   # token -> {username, role, clearance}

def get_current_user(token: str = "") -> dict:
    """X-Auth-Token 헤더 또는 쿼리로 인증"""
    if not token:
        return {"username": "guest", "role": "analyst", "clearance": "일반"}
    if token in DEMO_TOKENS:
        return DEMO_TOKENS[token]
    # DB 조회
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT username, role, clearance FROM sessions WHERE token=? AND expires_at > ?",
              (token, now_iso()))
    row = c.fetchone()
    conn.close()
    if row:
        return {"username": row[0], "role": row[1], "clearance": row[2]}
    return {"username": "guest", "role": "analyst", "clearance": "일반"}

def check_clearance(user: dict, required: str) -> bool:
    user_rank = CLEARANCE_RANK.get(user.get("clearance", "일반"), 0)
    req_rank  = CLEARANCE_RANK.get(required, 0)
    return user_rank >= req_rank

# ═══════════════════════════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════
import secrets

@app.post("/api/auth/login")
async def login(req: LoginRequest):
    """간단한 데모 로그인 (username으로 역할 자동 할당)"""
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT username, role, clearance FROM rbac_users WHERE username=? AND active=1",
              (req.username,))
    row = c.fetchone()
    conn.close()

    if not row:
        # 게스트 허용
        role      = req.role or "analyst"
        clearance = ROLE_CLEARANCE.get(role, "일반")
        username  = req.username
    else:
        username, role, clearance = row
        if req.role and req.role in ROLE_CLEARANCE:
            role      = req.role
            clearance = ROLE_CLEARANCE[role]

    token = secrets.token_hex(24)
    DEMO_TOKENS[token] = {"username": username, "role": role, "clearance": clearance}

    # DB 세션 저장
    from datetime import timedelta
    expires = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
    conn = get_conn()
    conn.execute("""
        INSERT OR REPLACE INTO sessions (token, username, role, clearance, expires_at)
        VALUES (?, ?, ?, ?, ?)
    """, (token, username, role, clearance, expires))
    conn.commit()
    conn.close()

    return {
        "token":     token,
        "username":  username,
        "role":      role,
        "clearance": clearance,
        "clearance_rank": CLEARANCE_RANK.get(clearance, 0)
    }

@app.get("/api/auth/me")
async def get_me(x_auth_token: str = ""):
    user = get_current_user(x_auth_token)
    return user

# ═══════════════════════════════════════════════════════════════════════════════
# EXPERT KB ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════
@app.get("/api/expert-kb")
async def list_expert_kb(
    domain: str = "",
    tag: str = "",
    clearance_filter: str = "",
    x_auth_token: str = ""
):
    """Expert KB 목록 조회 — 보안등급 RBAC 필터링"""
    user = get_current_user(x_auth_token)
    user_rank = CLEARANCE_RANK.get(user["clearance"], 0)

    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        SELECT id, title, content, domain, contributor, clearance, tags, source, created_at, view_count
        FROM expert_kb
        WHERE active=1
        ORDER BY created_at DESC
    """)
    rows = c.fetchall()
    conn.close()

    result = []
    for row in rows:
        entry_clearance = row[5]
        entry_rank = CLEARANCE_RANK.get(entry_clearance, 0)

        # RBAC: 자신의 등급보다 높은 항목은 내용 마스킹
        if entry_rank > user_rank:
            # 극비/비밀 항목은 제목만 표시 (내용 마스킹)
            masked_entry = {
                "id":          row[0],
                "title":       f"[{entry_clearance} 등급 — 접근 불가]",
                "content":     "⛔ 보안등급 미달. 해당 콘텐츠에 접근할 권한이 없습니다.",
                "domain":      row[3],
                "contributor": "***",
                "clearance":   entry_clearance,
                "tags":        [],
                "source":      row[7],
                "created_at":  row[8],
                "view_count":  row[9],
                "masked":      True
            }
            result.append(masked_entry)
            continue

        tags = json.loads(row[6]) if row[6] else []
        entry = {
            "id":          row[0],
            "title":       row[1],
            "content":     row[2],
            "domain":      row[3],
            "contributor": row[4],
            "clearance":   entry_clearance,
            "tags":        tags,
            "source":      row[7],
            "created_at":  row[8],
            "view_count":  row[9],
            "masked":      False
        }

        # 필터링
        if domain and entry["domain"] != domain:
            continue
        if tag and not any(tag.lower() in t.lower() for t in tags):
            continue

        result.append(entry)

    return {
        "items":        result,
        "total":        len(result),
        "user_role":    user["role"],
        "user_clearance": user["clearance"],
        "accessible":   sum(1 for e in result if not e.get("masked"))
    }


@app.post("/api/expert-kb", status_code=201)
async def create_expert_kb(entry: ExpertKBCreate, x_auth_token: str = ""):
    """Expert KB 등록"""
    user = get_current_user(x_auth_token)

    # 입력 검증
    if not entry.title.strip():
        raise HTTPException(400, "제목을 입력하세요")
    if len(entry.content.strip()) < 20:
        raise HTTPException(400, "내용은 20자 이상이어야 합니다")

    conn = get_conn()
    c = conn.cursor()

    # ID 생성
    c.execute("SELECT COUNT(*) FROM expert_kb")
    n = c.fetchone()[0]
    new_id = f"EXP{padded(n + 1)}"

    now = now_iso()
    c.execute("""
        INSERT INTO expert_kb (id, title, content, domain, contributor, clearance, tags, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '전문가', ?, ?)
    """, (
        new_id,
        entry.title.strip(),
        entry.content.strip(),
        entry.domain,
        entry.contributor.strip() or user["username"],
        entry.clearance,
        json.dumps(entry.tags),
        now, now
    ))
    conn.commit()

    # MOE 기여자 통계 업데이트
    update_contributor(conn, entry.contributor or user["username"], entry.domain, user["role"])
    conn.close()

    logger.info(f"Expert KB created: {new_id} by {entry.contributor}")
    return {
        "id":        new_id,
        "message":   "Expert KB 등록 완료",
        "entry_id":  new_id,
        "created_at": now
    }


@app.get("/api/expert-kb/{entry_id}")
async def get_expert_kb(entry_id: str, x_auth_token: str = ""):
    """단일 Expert KB 조회"""
    user = get_current_user(x_auth_token)
    user_rank = CLEARANCE_RANK.get(user["clearance"], 0)

    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM expert_kb WHERE id=? AND active=1", (entry_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(404, f"Expert KB {entry_id} 없음")

    entry_clearance = row[5]
    entry_rank = CLEARANCE_RANK.get(entry_clearance, 0)

    if entry_rank > user_rank:
        conn.close()
        raise HTTPException(403, f"보안등급 {entry_clearance} 접근 권한 없음 (현재: {user['clearance']})")

    # 조회수 증가
    c.execute("UPDATE expert_kb SET view_count = view_count + 1 WHERE id=?", (entry_id,))
    # 기여자 통계 업데이트
    c.execute("""
        UPDATE moe_contributors SET total_views = total_views + 1 WHERE contributor=?
    """, (row[4],))
    conn.commit()
    conn.close()

    return {
        "id":          row[0],
        "title":       row[1],
        "content":     row[2],
        "domain":      row[3],
        "contributor": row[4],
        "clearance":   row[5],
        "tags":        json.loads(row[6]) if row[6] else [],
        "source":      row[7],
        "created_at":  row[8],
        "updated_at":  row[9],
        "view_count":  row[10] + 1,
    }


@app.delete("/api/expert-kb/{entry_id}")
async def delete_expert_kb(entry_id: str, x_auth_token: str = ""):
    """Expert KB 삭제 (소프트 삭제)"""
    user = get_current_user(x_auth_token)

    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT contributor, clearance FROM expert_kb WHERE id=? AND active=1", (entry_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(404, "항목을 찾을 수 없습니다")

    # 본인 또는 commander 이상만 삭제 가능
    if row[0] != user["username"] and CLEARANCE_RANK.get(user["clearance"], 0) < 2:
        conn.close()
        raise HTTPException(403, "삭제 권한 없음 (본인 또는 비밀 등급 이상)")

    c.execute("UPDATE expert_kb SET active=0 WHERE id=?", (entry_id,))
    conn.commit()
    conn.close()

    return {"message": f"{entry_id} 삭제 완료"}


# ═══════════════════════════════════════════════════════════════════════════════
# MOE CONTRIBUTOR STATS
# ═══════════════════════════════════════════════════════════════════════════════
@app.get("/api/moe/stats")
async def moe_stats(x_auth_token: str = ""):
    """MOE 기여자 통계"""
    conn = get_conn()
    c = conn.cursor()

    # 기여자별 통계
    c.execute("""
        SELECT contributor, entry_count, total_views, domains, last_active, role
        FROM moe_contributors
        ORDER BY entry_count DESC
    """)
    contributors = []
    for row in c.fetchall():
        contributors.append({
            "contributor": row[0],
            "entry_count": row[1],
            "total_views": row[2],
            "domains":     json.loads(row[3]) if row[3] else [],
            "last_active": row[4],
            "role":        row[5],
        })

    # 도메인별 통계
    c.execute("""
        SELECT domain, COUNT(*) as cnt
        FROM expert_kb
        WHERE active=1
        GROUP BY domain
        ORDER BY cnt DESC
    """)
    domain_stats = [{"domain": r[0], "count": r[1]} for r in c.fetchall()]

    # 보안등급별 통계
    c.execute("""
        SELECT clearance, COUNT(*) as cnt
        FROM expert_kb
        WHERE active=1
        GROUP BY clearance
        ORDER BY cnt DESC
    """)
    clearance_stats = [{"clearance": r[0], "count": r[1]} for r in c.fetchall()]

    # 전체 통계
    c.execute("SELECT COUNT(*) FROM expert_kb WHERE active=1")
    total_entries = c.fetchone()[0]

    conn.close()
    return {
        "total_entries":    total_entries,
        "contributors":     contributors,
        "domain_stats":     domain_stats,
        "clearance_stats":  clearance_stats,
        "generated_at":     now_iso()
    }


# ═══════════════════════════════════════════════════════════════════════════════
# SENSOR / MCP ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════
@app.get("/api/sensors")
async def list_sensors(x_auth_token: str = ""):
    """센서 목록 및 상태"""
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM sensor_state ORDER BY sensor_type, sensor_id")
    sensors = []
    for row in c.fetchall():
        sensors.append({
            "sensor_id":     row[0],
            "sensor_type":   row[1],
            "status":        row[2],
            "confidence":    row[3],
            "last_reading":  row[4],
            "controlled_by": row[5],
            "updated_at":    row[6],
        })
    conn.close()
    return {"sensors": sensors, "count": len(sensors)}


@app.post("/api/sensors/command")
async def sensor_command(cmd: SensorCommand, x_auth_token: str = ""):
    """MCP 센서 명령 (Agentic AI 제어)"""
    user = get_current_user(x_auth_token)

    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT * FROM sensor_state WHERE sensor_id=?", (cmd.sensor_id,))
    row = c.fetchone()

    if not row:
        conn.close()
        raise HTTPException(404, f"센서 {cmd.sensor_id} 없음")

    now = now_iso()
    result = {}

    if cmd.action == "activate":
        c.execute("UPDATE sensor_state SET status='active', controlled_by=?, updated_at=? WHERE sensor_id=?",
                  ("agentic-ai" if "AI" in (cmd.value or "") else user["username"], now, cmd.sensor_id))
        result = {"action": "activate", "sensor_id": cmd.sensor_id, "status": "active"}

    elif cmd.action == "deactivate":
        c.execute("UPDATE sensor_state SET status='standby', controlled_by=?, updated_at=? WHERE sensor_id=?",
                  (user["username"], now, cmd.sensor_id))
        result = {"action": "deactivate", "sensor_id": cmd.sensor_id, "status": "standby"}

    elif cmd.action == "set_confidence":
        new_conf = float(cmd.value) if cmd.value else 0.9
        c.execute("UPDATE sensor_state SET confidence=?, updated_at=? WHERE sensor_id=?",
                  (new_conf, now, cmd.sensor_id))
        result = {"action": "set_confidence", "sensor_id": cmd.sensor_id, "confidence": new_conf}

    elif cmd.action == "request_data":
        # 실시간 센서 데이터 시뮬레이션
        reading = _simulate_sensor_reading(row[0], row[1])
        c.execute("UPDATE sensor_state SET last_reading=?, updated_at=? WHERE sensor_id=?",
                  (json.dumps(reading), now, cmd.sensor_id))
        result = {"action": "request_data", "sensor_id": cmd.sensor_id, "reading": reading}

    conn.commit()
    conn.close()
    return result


@app.post("/api/mcp/agent-command")
async def mcp_agent_command(cmd: MCPAgentCommand, x_auth_token: str = ""):
    """Agentic AI MCP 툴 명령"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "대외비"):
        raise HTTPException(403, "MCP 제어는 대외비 등급 이상 필요")

    results = []
    conn = get_conn()
    c = conn.cursor()
    now = now_iso()

    if cmd.command == "scan_all":
        # 모든 활성 센서 스캔
        c.execute("SELECT sensor_id, sensor_type FROM sensor_state WHERE status='active'")
        for row in c.fetchall():
            reading = _simulate_sensor_reading(row[0], row[1])
            c.execute("UPDATE sensor_state SET last_reading=?, controlled_by='agentic-ai', updated_at=? WHERE sensor_id=?",
                      (json.dumps(reading), now, row[0]))
            results.append({"sensor_id": row[0], "reading": reading})

    elif cmd.command == "focus":
        # 특정 센서 집중
        for sid in cmd.targets:
            c.execute("SELECT sensor_type FROM sensor_state WHERE sensor_id=?", (sid,))
            row = c.fetchone()
            if row:
                c.execute("UPDATE sensor_state SET status='active', confidence=?, controlled_by='agentic-ai', updated_at=? WHERE sensor_id=?",
                          (min(0.99, (cmd.params.get("boost", 0.05))), now, sid))
                results.append({"sensor_id": sid, "action": "focused", "priority": cmd.priority})

    elif cmd.command == "jam_rf":
        # RF 재밍 제어
        c.execute("UPDATE sensor_state SET status='jamming', controlled_by='agentic-ai', updated_at=? WHERE sensor_type='rf'",
                  (now,))
        results.append({"action": "jam_rf", "status": "jamming activated", "targets": cmd.targets})

    elif cmd.command == "request_sensor":
        # 특정 센서 데이터 요청
        for sid in cmd.targets:
            c.execute("SELECT sensor_id, sensor_type FROM sensor_state WHERE sensor_id=?", (sid,))
            row = c.fetchone()
            if row:
                reading = _simulate_sensor_reading(row[0], row[1])
                c.execute("UPDATE sensor_state SET last_reading=?, updated_at=? WHERE sensor_id=?",
                          (json.dumps(reading), now, row[0]))
                results.append({"sensor_id": row[0], "reading": reading})

    conn.commit()
    conn.close()

    return {
        "agent_id":  cmd.agent_id,
        "command":   cmd.command,
        "results":   results,
        "timestamp": now,
        "executed_by": user["username"]
    }


def _simulate_sensor_reading(sensor_id: str, sensor_type: str) -> dict:
    """센서 데이터 시뮬레이션"""
    base = {
        "sensor_id":  sensor_id,
        "timestamp":  now_iso(),
        "data_quality": round(random.uniform(0.75, 0.99), 3)
    }
    if sensor_type == "radar":
        tracks = []
        for i in range(random.randint(3, 8)):
            tracks.append({
                "track_id":  f"T-{20000 + random.randint(1, 999)}",
                "lat":       round(37.0 + random.uniform(-0.5, 0.5), 5),
                "lon":       round(126.8 + random.uniform(-0.5, 0.5), 5),
                "velocity":  round(random.uniform(20, 120), 1),
                "heading":   random.randint(0, 359),
                "confidence": round(random.uniform(0.82, 0.98), 3)
            })
        base["tracks"] = tracks
        base["track_count"] = len(tracks)
    elif sensor_type in ("satellite", "eo_ir"):
        base["detections"] = random.randint(0, 5)
        base["coverage_km2"] = round(random.uniform(100, 2000), 1)
        base["resolution_m"] = round(random.uniform(0.3, 5.0), 2)
    elif sensor_type == "rf":
        base["signals"] = [
            {"freq_mhz": round(random.uniform(400, 6000), 2),
             "power_dbm": round(random.uniform(-90, -30), 1),
             "type": random.choice(["drone_ctrl", "comms", "radar_emission", "unknown"])}
            for _ in range(random.randint(1, 4))
        ]
    elif sensor_type == "weather":
        base["wind_kts"]   = round(random.uniform(5, 25), 1)
        base["visibility_km"] = round(random.uniform(5, 30), 1)
        base["cloud_ceiling_ft"] = random.randint(2000, 15000)
        base["temperature_c"] = round(random.uniform(5, 25), 1)
    return base


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC / USER MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════
@app.get("/api/rbac/users")
async def list_users(x_auth_token: str = ""):
    """사용자 목록 (commander 이상만)"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "비밀"):
        raise HTTPException(403, "사용자 목록 조회는 비밀 등급 이상 필요")

    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT username, role, clearance, active FROM rbac_users ORDER BY clearance DESC")
    users = [{"username": r[0], "role": r[1], "clearance": r[2], "active": bool(r[3])}
             for r in c.fetchall()]
    conn.close()
    return {"users": users}


@app.get("/api/rbac/roles")
async def list_roles():
    """역할 및 보안등급 정보"""
    return {
        "roles": [
            {"role": "analyst",   "clearance": "일반",  "rank": 0, "desc": "기본 분석관"},
            {"role": "officer",   "clearance": "대외비", "rank": 1, "desc": "작전 장교"},
            {"role": "commander", "clearance": "비밀",  "rank": 2, "desc": "지휘관"},
            {"role": "super",     "clearance": "극비",  "rank": 3, "desc": "최고사령관"},
        ],
        "clearance_levels": CLEARANCE_RANK
    }


# ═══════════════════════════════════════════════════════════════════════════════
# WEBSOCKET — 실시간 센서 스트림
# ═══════════════════════════════════════════════════════════════════════════════
class ConnectionManager:
    def __init__(self):
        self.connections: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, msg: dict):
        dead = []
        for ws in self.connections:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = ConnectionManager()

@app.websocket("/ws/cop")
async def cop_websocket(websocket: WebSocket):
    """COP (Common Operating Picture) WebSocket 스트림"""
    try:
        await ws_manager.connect(websocket)
    except Exception as e:
        logger.warning(f"WS accept failed (websockets 라이브러리 미설치?): {e}")
        return

    logger.info(f"WS connected: {websocket.client}")
    try:
        # 초기 센서 상태 전송
        conn = get_conn()
        c = conn.cursor()
        c.execute("SELECT sensor_id, status, confidence FROM sensor_state")
        sensors = [{"id": r[0], "status": r[1], "conf": r[2]} for r in c.fetchall()]
        conn.close()

        await websocket.send_json({
            "type": "init",
            "sensors": sensors,
            "timestamp": now_iso()
        })

        # 주기적 센서 업데이트 (3초마다)
        tick = 0
        while True:
            await asyncio.sleep(3)
            tick += 1

            # 랜덤 센서 하나 데이터 생성
            sensor_ids = ["RAD-01", "RAD-02", "RF-SENSE", "EO-A1", "AIS"]
            sid = random.choice(sensor_ids)
            stypes = {"RAD-01": "radar", "RAD-02": "radar", "RF-SENSE": "rf",
                      "EO-A1": "eo_ir", "AIS": "ais"}
            reading = _simulate_sensor_reading(sid, stypes.get(sid, "radar"))

            # 드론 위협 시뮬레이션 → 온톨로지 엔진 실제 처리
            raw_tracks = []
            for i in range(random.randint(2, 4)):
                side = random.choice(["E", "W"])
                num  = random.randint(1, 20)
                is_kamikaze = random.random() < 0.4
                raw_tracks.append({
                    "track_id":     f"EG-{side}{str(num).zfill(2)}",
                    "lat":          round(37.0 + random.uniform(-0.3, 0.3), 5),
                    "lon":          round(126.8 + random.uniform(-0.3, 0.3) + (0.5 if side == "E" else -0.5), 5),
                    "alt_m":        round(random.uniform(20, 40) if is_kamikaze else random.uniform(60, 150), 1),
                    "velocity_kph": round(random.uniform(80, 95) if is_kamikaze else random.uniform(15, 55), 1),
                    "heading_deg":  round(random.uniform(160, 200) if side == "E" else random.uniform(340, 380) % 360, 1),
                    "ir_temp_c":    round(random.uniform(38, 45) if is_kamikaze else random.uniform(28, 33), 1),
                    "rf_freq_mhz":  433.0 if is_kamikaze else random.choice([868.0, 2450.0]),
                    "swarm_id":     f"SW-{side}" if random.random() < 0.6 else None,
                })

            threat_result = _threat_engine.process(raw_tracks)

            await websocket.send_json({
                "type":          "sensor_update",
                "sensor_id":     sid,
                "reading":       reading,
                "threat_update": threat_result.to_dict(),
                "tick":          tick,
                "timestamp":     now_iso()
            })

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
        logger.info("WS disconnected")
    except Exception as e:
        ws_manager.disconnect(websocket)
        logger.warning(f"WS error: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# THREAT ONTOLOGY API
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/threat/process")
async def threat_process(body: ThreatBatchInput, x_auth_token: str = ""):
    """
    FPV 드론 위협 온톨로지 파이프라인 실행

    Observation → Classification → Threat Score → ROE → INTERCEPT 명령
    """
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "대외비"):
        raise HTTPException(403, "위협 분석은 대외비 등급 이상 필요")

    # ROE 동적 변경
    if body.roe:
        try:
            _threat_engine.set_roe(ROEMode(body.roe))
        except ValueError:
            raise HTTPException(400, f"유효하지 않은 ROE 모드: {body.roe}")

    raw = [t.dict() for t in body.tracks]
    result = _threat_engine.process(raw)

    # DB 저장
    now = now_iso()
    conn = get_conn()
    c = conn.cursor()
    for t in result.tracks:
        c.execute("""
            INSERT INTO threat_tracks
            (track_id, lat, lon, alt_m, velocity_kph, heading_deg, ir_temp_c,
             rf_freq_mhz, drone_class, drone_type, threat_score, threat_level,
             swarm_id, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (t.track_id, t.lat, t.lon, t.alt_m, t.velocity_kph, t.heading_deg,
               t.ir_temp_c, t.rf_freq_mhz, t.drone_class.value, t.drone_type.value,
               t.threat_score, t.threat_level.value, t.swarm_id, now))
    for o in result.orders:
        c.execute("""
            INSERT OR REPLACE INTO intercept_orders
            (order_id, target_id, decision, atk_drone_id, intercept_lat,
             intercept_lon, intercept_alt_m, priority, roe_mode,
             threat_score, threat_level, reason, ttx_sec, issued_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (o.order_id, o.target_id, o.decision.value, o.atk_drone_id,
               o.intercept_lat, o.intercept_lon, o.intercept_alt_m,
               o.priority, o.roe_mode.value, o.threat_score,
               o.threat_level.value, o.reason, o.ttx_sec, now))
    conn.commit()
    conn.close()

    # WebSocket 브로드캐스트
    await ws_manager.broadcast({
        "type":    "threat_update",
        "payload": result.to_dict(),
    })

    return result.to_dict()


@app.get("/api/threat/roe")
async def get_roe(x_auth_token: str = ""):
    """현재 ROE 모드 조회"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "대외비"):
        raise HTTPException(403, "대외비 등급 이상 필요")
    return {"roe": _threat_engine.roe.value,
            "description": {
                "WEAPONS_FREE":  "자유 교전 — 위협 식별 즉시 교전 허가",
                "WEAPONS_TIGHT": "제한 교전 — 확실한 적만 교전",
                "WEAPONS_HOLD":  "교전 보류 — 지휘관 승인 필요",
            }.get(_threat_engine.roe.value, "")}


@app.post("/api/threat/roe")
async def set_roe(req: ROEChangeRequest, x_auth_token: str = ""):
    """ROE 모드 변경 (commander 이상)"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "비밀"):
        raise HTTPException(403, "ROE 변경은 비밀 등급(commander) 이상 필요")
    try:
        new_roe = ROEMode(req.roe)
    except ValueError:
        raise HTTPException(400, f"유효하지 않은 ROE: {req.roe}. 가능 값: WEAPONS_FREE, WEAPONS_TIGHT, WEAPONS_HOLD")
    _threat_engine.set_roe(new_roe)
    logger.info(f"ROE 변경: {new_roe.value} (by {user['username']})")
    return {"ok": True, "roe": new_roe.value, "changed_by": user["username"]}


@app.get("/api/threat/orders")
async def get_intercept_orders(limit: int = 50, x_auth_token: str = ""):
    """최근 요격 명령 이력 조회"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "대외비"):
        raise HTTPException(403, "대외비 등급 이상 필요")
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        SELECT order_id, target_id, decision, atk_drone_id,
               intercept_lat, intercept_lon, priority, roe_mode,
               threat_score, threat_level, reason, ttx_sec, issued_at
        FROM intercept_orders ORDER BY issued_at DESC LIMIT ?
    """, (limit,))
    cols = ["order_id","target_id","decision","atk_drone_id",
            "intercept_lat","intercept_lon","priority","roe_mode",
            "threat_score","threat_level","reason","ttx_sec","issued_at"]
    rows = [dict(zip(cols, r)) for r in c.fetchall()]
    conn.close()
    return {"orders": rows, "count": len(rows)}


@app.get("/api/threat/tracks")
async def get_threat_tracks(limit: int = 100, x_auth_token: str = ""):
    """최근 위협 항적 이력 조회"""
    user = get_current_user(x_auth_token)
    if not check_clearance(user, "대외비"):
        raise HTTPException(403, "대외비 등급 이상 필요")
    conn = get_conn()
    c = conn.cursor()
    c.execute("""
        SELECT track_id, lat, lon, alt_m, velocity_kph, heading_deg,
               ir_temp_c, drone_class, drone_type, threat_score, threat_level,
               swarm_id, created_at
        FROM threat_tracks ORDER BY created_at DESC LIMIT ?
    """, (limit,))
    cols = ["track_id","lat","lon","alt_m","velocity_kph","heading_deg",
            "ir_temp_c","drone_class","drone_type","threat_score",
            "threat_level","swarm_id","created_at"]
    rows = [dict(zip(cols, r)) for r in c.fetchall()]
    conn.close()
    return {"tracks": rows, "count": len(rows)}


@app.post("/api/threat/simulate")
async def threat_simulate(x_auth_token: str = ""):
    """
    FPV 드론 시나리오 시뮬레이션 (테스트용)
    — 동해 자폭 편대 3대 + 정찰기 1대 + 미끼 1대
    """
    import random as _rnd

    base_lat, base_lon = 37.55, 126.97

    sim_tracks = []
    # 동해 자폭 편대 (SW-EAST)
    for i in range(3):
        sim_tracks.append({
            "track_id":     f"SIM-EG-E{i+1:02d}",
            "lat":          round(base_lat + _rnd.uniform(0.02, 0.08), 5),
            "lon":          round(base_lon + _rnd.uniform(0.05, 0.15), 5),
            "alt_m":        round(_rnd.uniform(20, 40), 1),
            "velocity_kph": round(_rnd.uniform(82, 95), 1),
            "heading_deg":  round(180 + _rnd.uniform(-10, 10), 1),
            "ir_temp_c":    round(_rnd.uniform(38, 45), 1),
            "rf_freq_mhz":  round(433.0 + _rnd.uniform(-1, 1), 2),
            "swarm_id":     "SW-EAST",
        })
    # 정찰기
    sim_tracks.append({
        "track_id":     "SIM-SCOUT-01",
        "lat":          round(base_lat + 0.12, 5),
        "lon":          round(base_lon - 0.05, 5),
        "alt_m":        150,
        "velocity_kph": round(_rnd.uniform(10, 18), 1),
        "heading_deg":  270,
        "ir_temp_c":    29.5,
        "rf_freq_mhz":  2450.0,
    })
    # 미끼
    sim_tracks.append({
        "track_id":     "SIM-DECOY-01",
        "lat":          round(base_lat - 0.05, 5),
        "lon":          round(base_lon + 0.02, 5),
        "alt_m":        80,
        "velocity_kph": round(_rnd.uniform(35, 50), 1),
        "heading_deg":  round(_rnd.uniform(0, 360), 1),
        "ir_temp_c":    31.0,
        "rf_freq_mhz":  868.0,
    })

    result = _threat_engine.process(sim_tracks)

    # WebSocket 브로드캐스트
    await ws_manager.broadcast({
        "type":    "threat_update",
        "payload": result.to_dict(),
    })

    return result.to_dict()


# ═══════════════════════════════════════════════════════════════════════════════
# HEALTH & STATUS
# ═══════════════════════════════════════════════════════════════════════════════
@app.get("/api/health")
async def health():
    conn = get_conn()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM expert_kb WHERE active=1")
    kb_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM sensor_state WHERE status='active'")
    active_sensors = c.fetchone()[0]
    conn.close()
    conn2 = get_conn()
    c2 = conn2.cursor()
    c2.execute("SELECT COUNT(*) FROM intercept_orders")
    order_count = c2.fetchone()[0]
    c2.execute("SELECT COUNT(*) FROM threat_tracks")
    track_count = c2.fetchone()[0]
    conn2.close()
    return {
        "status":              "ok",
        "version":             "3.0.0",
        "expert_kb_count":     kb_count,
        "active_sensors":      active_sensors,
        "threat_ontology":     "active",
        "current_roe":         _threat_engine.roe.value,
        "intercept_orders":    order_count,
        "threat_tracks":       track_count,
        "neo4j":               "sqlite-fallback",
        "timestamp":           now_iso()
    }

@app.get("/api/events")
async def get_events():
    """이벤트 타임라인 (시뮬레이션)"""
    events = [
        {"id": "E001", "time": "T+00:02", "type": "탐지", "msg": "동해 EG-E01 최초 탐지 (RAD-01)", "level": "critical"},
        {"id": "E002", "time": "T+00:05", "type": "분류", "msg": "EG-E 편대 자폭/미끼 분류 완료", "level": "warning"},
        {"id": "E003", "time": "T+00:08", "type": "교전", "msg": "K-LEW 레이저 교전 개시", "level": "info"},
        {"id": "E004", "time": "T+00:12", "type": "격멸", "msg": "EG-E01 격멸 확인", "level": "success"},
        {"id": "E005", "time": "T+00:15", "type": "MCP",  "msg": "Agentic AI RF-SENSE 집중 스캔 명령", "level": "info"},
    ]
    return {"events": events}

@app.get("/api/situations")
async def get_situations():
    """상황 카드 (시뮬레이션)"""
    situations = [
        {"id": "S001", "title": "동해 자폭 편대 접근", "confidence": 0.91, "level": "critical",
         "desc": "EG-E 12대 자폭형 T+16분 도달 예상"},
        {"id": "S002", "title": "서해 미끼 교란 패턴", "confidence": 0.85, "level": "warning",
         "desc": "EG-W 10대 미끼형 방공 소모 전략"},
        {"id": "S003", "title": "2차 편대 가능성", "confidence": 0.55, "level": "warning",
         "desc": "북방 150km SAR 추가 탐지 대기"},
    ]
    return {"situations": situations}


# ═══════════════════════════════════════════════════════════════════════════════
# Neo4j 통합 (옵션 — neo4j 패키지 설치 시 활성화)
# ═══════════════════════════════════════════════════════════════════════════════
NEO4J_AVAILABLE = False
try:
    from neo4j import GraphDatabase
    NEO4J_URI      = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
    NEO4J_USER     = os.getenv("NEO4J_USER",     "neo4j")
    NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "gotham2026")
    neo4j_driver   = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    neo4j_driver.verify_connectivity()
    NEO4J_AVAILABLE = True
    logger.info("✅ Neo4j connected")
except Exception as e:
    logger.info(f"ℹ️  Neo4j 미연결 (SQLite 폴백): {e}")


@app.get("/api/neo4j/status")
async def neo4j_status():
    return {
        "available":  NEO4J_AVAILABLE,
        "fallback":   "sqlite",
        "message":    "Neo4j 연결 시 Expert KB가 그래프 DB에 저장됩니다" if not NEO4J_AVAILABLE else "Neo4j 연결됨"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8766, reload=False)
