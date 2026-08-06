"""
FPV 드론 위협 온톨로지 엔진 (Threat Ontology Engine)
=====================================================
파이프라인:
  1. Observation  — 레이더/RF/EO-IR 다중 센서 융합
  2. Classification — 적/아군/민간/미상 판정 (IFF + RF 지문 + 기동 패턴)
  3. Threat Score — 위협도 계산 (거리·속도·기수각·고도·편대 규모)
  4. ROE Check    — 교전규칙 적용 (WEAPONS_FREE / HOLD / TIGHT)
  5. Intent       — INTERCEPT / MONITOR / IGNORE 명령 생성
  6. Cueing       — 요격 드론(ATK) 배치 좌표·우선순위 반환
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import List, Optional, Dict, Tuple
from datetime import datetime, timezone


# ══════════════════════════════════════════════════════════════════════════════
# 열거형 정의
# ══════════════════════════════════════════════════════════════════════════════

class DroneClass(str, Enum):
    """IFF 분류 결과"""
    HOSTILE   = "HOSTILE"    # 적 (자폭·정찰)
    FRIENDLY  = "FRIENDLY"   # 아군
    CIVILIAN  = "CIVILIAN"   # 민간 (등록 드론 등)
    UNKNOWN   = "UNKNOWN"    # 미상 → 위협 가중 처리


class DroneType(str, Enum):
    """드론 임무 유형 (행동 패턴 분류)"""
    KAMIKAZE   = "KAMIKAZE"   # 자폭형 — 직선 돌진
    SCOUT      = "SCOUT"      # 정찰형 — 선회·호버
    DECOY      = "DECOY"      # 미끼형 — 방공자원 소모
    SWARM      = "SWARM"      # 군집형 — 편대 일원
    CARGO      = "CARGO"      # 물자 수송형
    UNKNOWN    = "UNKNOWN"


class ThreatLevel(str, Enum):
    CRITICAL  = "CRITICAL"   # 즉시 교전
    HIGH      = "HIGH"       # 요격 준비
    MEDIUM    = "MEDIUM"     # 모니터링 강화
    LOW       = "LOW"        # 일반 감시
    NONE      = "NONE"       # 위협 없음


class ROEMode(str, Enum):
    """교전규칙 모드"""
    WEAPONS_FREE  = "WEAPONS_FREE"   # 자유 교전 — 위협 식별 즉시 교전 허가
    WEAPONS_TIGHT = "WEAPONS_TIGHT"  # 제한 교전 — 확실한 적만 교전
    WEAPONS_HOLD  = "WEAPONS_HOLD"   # 교전 보류 — 지휘관 승인 필요


class InterceptDecision(str, Enum):
    ENGAGE      = "ENGAGE"       # 즉시 요격 명령
    INTERCEPT   = "INTERCEPT"    # 요격기 출격 (교전 대기)
    MONITOR     = "MONITOR"      # 추적만 유지
    IGNORE      = "IGNORE"       # 위협 없음, 무시
    HOLD        = "HOLD"         # ROE HOLD — 명령 대기


# ══════════════════════════════════════════════════════════════════════════════
# 데이터 구조
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class DroneTrack:
    """
    단일 드론 항적 (레이더·RF·EO-IR 융합 후 생성)
    """
    track_id:     str
    lat:          float              # WGS-84 위도
    lon:          float              # WGS-84 경도
    alt_m:        float = 100.0      # 고도 (m AGL)
    velocity_kph: float = 0.0        # 속력 (km/h)
    heading_deg:  float = 0.0        # 기수각 (deg, 0=N, 90=E)
    ir_temp_c:    float = 28.0       # 적외선 온도 (°C) — 자폭형 고열 특징
    rf_freq_mhz:  float = 0.0        # RF 제어 주파수
    rf_power_dbm: float = -80.0      # RF 신호 세기
    iff_code:     Optional[str] = None  # IFF 응답 코드 (None=무응답)
    swarm_id:     Optional[str] = None  # 편대 식별자
    timestamp:    str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    # 분류 결과 (엔진이 채움)
    drone_class:  DroneClass  = DroneClass.UNKNOWN
    drone_type:   DroneType   = DroneType.UNKNOWN
    threat_score: float       = 0.0   # 0~100
    threat_level: ThreatLevel = ThreatLevel.NONE

    def to_dict(self) -> dict:
        d = asdict(self)
        d["drone_class"]  = self.drone_class.value
        d["drone_type"]   = self.drone_type.value
        d["threat_level"] = self.threat_level.value
        return d


@dataclass
class InterceptOrder:
    """
    요격 명령서 (ATK 드론에 전달)
    """
    order_id:       str
    target_id:      str              # 표적 항적 ID
    decision:       InterceptDecision
    atk_drone_id:   Optional[str]   # 배정된 요격 드론 ID
    intercept_lat:  Optional[float]  # 요격 예상 좌표
    intercept_lon:  Optional[float]
    intercept_alt_m: Optional[float]
    priority:       int              # 1=최우선
    roe_mode:       ROEMode
    threat_score:   float
    threat_level:   ThreatLevel
    reason:         str              # 판단 근거 (설명 가능 AI)
    issued_at:      str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    ttx_sec:        Optional[float] = None  # 표적까지 도달 예상 시간 (초)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["decision"]     = self.decision.value
        d["roe_mode"]     = self.roe_mode.value
        d["threat_level"] = self.threat_level.value
        return d


@dataclass
class OntologyResult:
    """
    온톨로지 엔진 전체 추론 결과
    """
    tracks:          List[DroneTrack]
    orders:          List[InterceptOrder]
    situation_label: str              # 상황 요약 (COP 표시용)
    overall_threat:  ThreatLevel
    roe_mode:        ROEMode
    active_swarms:   int              # 활성 편대 수
    hostile_count:   int
    processed_at:    str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return {
            "tracks":          [t.to_dict() for t in self.tracks],
            "orders":          [o.to_dict() for o in self.orders],
            "situation_label": self.situation_label,
            "overall_threat":  self.overall_threat.value,
            "roe_mode":        self.roe_mode.value,
            "active_swarms":   self.active_swarms,
            "hostile_count":   self.hostile_count,
            "processed_at":    self.processed_at,
        }


# ══════════════════════════════════════════════════════════════════════════════
# 보호 구역 (No-Fly Zone / Defended Area)
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class DefendedAsset:
    """방어 대상 자산"""
    asset_id:  str
    name:      str
    lat:       float
    lon:       float
    radius_km: float  # 방어 반경

# 기본 방어 자산 목록 (실운용 시 DB/설정파일로 대체)
DEFAULT_ASSETS: List[DefendedAsset] = [
    DefendedAsset("DA-001", "지휘통제소",   37.5665, 126.9780, 5.0),
    DefendedAsset("DA-002", "탄약고",       37.4500, 127.1000, 3.0),
    DefendedAsset("DA-003", "레이더기지",   37.7000, 126.8000, 4.0),
]


# ══════════════════════════════════════════════════════════════════════════════
# 유틸리티 함수
# ══════════════════════════════════════════════════════════════════════════════

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표 간 거리 계산 (km, Haversine)"""
    R = 6371.0
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(dλ/2)**2
    return R * 2 * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """진북 기준 방위각 (deg)"""
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dλ = math.radians(lon2 - lon1)
    x = math.sin(dλ) * math.cos(φ2)
    y = math.cos(φ1)*math.sin(φ2) - math.sin(φ1)*math.cos(φ2)*math.cos(dλ)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def heading_delta(h_drone: float, bearing_to_asset: float) -> float:
    """기수각과 자산 방위 간 각도 차이 (0~180°)"""
    delta = abs(h_drone - bearing_to_asset) % 360
    return delta if delta <= 180 else 360 - delta


def intercept_point(
    t_lat: float, t_lon: float, t_vel_kph: float, t_hdg: float,
    ttx_sec: float
) -> Tuple[float, float]:
    """
    표적 드론의 TTx초 후 예상 위치 계산 (단순 선형 외삽)
    """
    dist_km = t_vel_kph * (ttx_sec / 3600.0)
    hdg_rad = math.radians(t_hdg)
    R = 6371.0
    lat_r = math.radians(t_lat)
    lon_r = math.radians(t_lon)
    dr = dist_km / R
    new_lat = math.asin(math.sin(lat_r)*math.cos(dr) +
                        math.cos(lat_r)*math.sin(dr)*math.cos(hdg_rad))
    new_lon = lon_r + math.atan2(
        math.sin(hdg_rad)*math.sin(dr)*math.cos(lat_r),
        math.cos(dr) - math.sin(lat_r)*math.sin(new_lat)
    )
    return math.degrees(new_lat), math.degrees(new_lon)


# ══════════════════════════════════════════════════════════════════════════════
# Layer 1+2: 분류기 (IFF + RF + 기동 패턴)
# ══════════════════════════════════════════════════════════════════════════════

# 알려진 아군 IFF 코드 (실운용 시 암호화된 DB로 관리)
FRIENDLY_IFF_CODES = {"ALPHA-1", "ALPHA-2", "BRAVO-1", "BRAVO-2", "ECHO-7"}

# 알려진 민간 드론 RF 주파수 대역 (MHz)
CIVILIAN_RF_BANDS = [(2400, 2483), (5725, 5850), (915, 928)]

# 적 드론 RF 지문 (예: 러시아 Lancet 계열 제어 주파수)
HOSTILE_RF_FINGERPRINTS = [(868.0, 5.0), (433.0, 5.0), (1090.0, 10.0)]


def _is_civilian_freq(freq_mhz: float) -> bool:
    for lo, hi in CIVILIAN_RF_BANDS:
        if lo <= freq_mhz <= hi:
            return True
    return False


def _is_hostile_freq(freq_mhz: float) -> bool:
    for center, tol in HOSTILE_RF_FINGERPRINTS:
        if abs(freq_mhz - center) <= tol:
            return True
    return False


def classify_drone(track: DroneTrack, swarm_size: int = 1) -> Tuple[DroneClass, DroneType]:
    """
    Level 1-2: IFF + RF 지문 + 기동 패턴으로 드론 분류

    Returns:
        (DroneClass, DroneType)
    """
    # ── IFF 응답 확인 ─────────────────────────────────────────────────────────
    if track.iff_code and track.iff_code in FRIENDLY_IFF_CODES:
        return DroneClass.FRIENDLY, DroneType.UNKNOWN

    # ── RF 지문 분석 ──────────────────────────────────────────────────────────
    if track.rf_freq_mhz > 0:
        if _is_hostile_freq(track.rf_freq_mhz):
            # 적 RF → 유형 추가 판정
            if track.velocity_kph > 80 and track.ir_temp_c > 34:
                return DroneClass.HOSTILE, DroneType.KAMIKAZE
            return DroneClass.HOSTILE, DroneType.SCOUT

        if _is_civilian_freq(track.rf_freq_mhz) and track.iff_code is None:
            if track.velocity_kph < 30:
                return DroneClass.CIVILIAN, DroneType.CARGO
            return DroneClass.CIVILIAN, DroneType.UNKNOWN

    # ── 기동 패턴 분석 (IFF 없음 + RF 미확인) ─────────────────────────────────
    # 자폭형: 고속(>70kph) + 직선 + 고열(>33°C)
    if track.velocity_kph > 70 and track.ir_temp_c > 33:
        return DroneClass.HOSTILE, DroneType.KAMIKAZE

    # 정찰형: 저속 + 호버링 패턴 (속도 < 20)
    if track.velocity_kph < 20 and track.alt_m > 50:
        return DroneClass.UNKNOWN, DroneType.SCOUT

    # 군집형: 편대 소속
    if swarm_size >= 3:
        if track.velocity_kph > 50:
            return DroneClass.HOSTILE, DroneType.SWARM
        return DroneClass.UNKNOWN, DroneType.SWARM

    # 미끼형: 중속 + 방공 구역 내 선회
    if 20 < track.velocity_kph < 60:
        return DroneClass.UNKNOWN, DroneType.DECOY

    return DroneClass.UNKNOWN, DroneType.UNKNOWN


# ══════════════════════════════════════════════════════════════════════════════
# Layer 3: 위협도 계산 엔진
# ══════════════════════════════════════════════════════════════════════════════

class ThreatScorer:
    """
    다중 요소 위협도 계산 (0~100점)

    가중치 설계:
      - 방어자산 거리    : 30점
      - 기수각 정렬도    : 20점
      - 속도             : 15점
      - 드론 유형        : 20점
      - IR 온도          : 10점
      - 고도             : 5점
    """

    WEIGHTS = {
        "distance":   30,
        "heading":    20,
        "velocity":   15,
        "type":       20,
        "ir_temp":    10,
        "altitude":   5,
    }

    TYPE_SCORES: Dict[DroneType, float] = {
        DroneType.KAMIKAZE: 1.0,
        DroneType.SWARM:    0.85,
        DroneType.SCOUT:    0.55,
        DroneType.DECOY:    0.40,
        DroneType.CARGO:    0.10,
        DroneType.UNKNOWN:  0.60,
    }

    def score(
        self,
        track: DroneTrack,
        assets: List[DefendedAsset] = DEFAULT_ASSETS,
        swarm_size: int = 1,
    ) -> Tuple[float, ThreatLevel, str]:
        """
        Returns:
            (score 0~100, ThreatLevel, reason_text)
        """
        if track.drone_class == DroneClass.FRIENDLY:
            return 0.0, ThreatLevel.NONE, "아군 IFF 확인 — 위협 없음"

        reasons: List[str] = []
        total = 0.0

        # ── 방어자산 최근접 거리 ──────────────────────────────────────────────
        min_dist_km = min(
            haversine_km(track.lat, track.lon, a.lat, a.lon)
            for a in assets
        )
        closest = min(assets, key=lambda a: haversine_km(track.lat, track.lon, a.lat, a.lon))

        if   min_dist_km < 2:   dist_score = 1.00
        elif min_dist_km < 5:   dist_score = 0.85
        elif min_dist_km < 10:  dist_score = 0.65
        elif min_dist_km < 20:  dist_score = 0.40
        elif min_dist_km < 50:  dist_score = 0.20
        else:                   dist_score = 0.05

        total += dist_score * self.WEIGHTS["distance"]
        reasons.append(f"자산 근접 {min_dist_km:.1f}km({closest.name})")

        # ── 기수각 정렬도 (자산을 향해 비행 중인가?) ──────────────────────────
        b = bearing_deg(track.lat, track.lon, closest.lat, closest.lon)
        delta = heading_delta(track.heading_deg, b)

        if   delta < 10:  hdg_score = 1.00
        elif delta < 30:  hdg_score = 0.80
        elif delta < 60:  hdg_score = 0.50
        elif delta < 90:  hdg_score = 0.25
        else:             hdg_score = 0.05

        total += hdg_score * self.WEIGHTS["heading"]
        reasons.append(f"기수각 편차 {delta:.0f}°")

        # ── 속도 ──────────────────────────────────────────────────────────────
        v = track.velocity_kph
        if   v > 100:  vel_score = 1.00
        elif v > 80:   vel_score = 0.85
        elif v > 60:   vel_score = 0.65
        elif v > 40:   vel_score = 0.40
        elif v > 20:   vel_score = 0.20
        else:          vel_score = 0.05

        total += vel_score * self.WEIGHTS["velocity"]
        reasons.append(f"속력 {v:.0f}kph")

        # ── 드론 유형 ──────────────────────────────────────────────────────────
        type_score = self.TYPE_SCORES.get(track.drone_type, 0.6)
        total += type_score * self.WEIGHTS["type"]
        reasons.append(f"유형:{track.drone_type.value}")

        # ── IR 온도 (자폭형은 모터/탄두 고열) ─────────────────────────────────
        ir = track.ir_temp_c
        if   ir > 40:  ir_score = 1.00
        elif ir > 36:  ir_score = 0.80
        elif ir > 33:  ir_score = 0.55
        elif ir > 30:  ir_score = 0.25
        else:          ir_score = 0.05

        total += ir_score * self.WEIGHTS["ir_temp"]
        reasons.append(f"IR {ir:.1f}°C")

        # ── 고도 (저고도 = 방공망 회피 의도) ─────────────────────────────────
        alt = track.alt_m
        if   alt < 30:   alt_score = 1.00
        elif alt < 80:   alt_score = 0.70
        elif alt < 150:  alt_score = 0.40
        else:            alt_score = 0.15

        total += alt_score * self.WEIGHTS["altitude"]
        reasons.append(f"고도 {alt:.0f}m")

        # ── 군집 보정 ─────────────────────────────────────────────────────────
        if swarm_size >= 10:    total *= 1.30
        elif swarm_size >= 5:   total *= 1.15
        elif swarm_size >= 3:   total *= 1.08

        # 미상 드론 불확실성 가중
        if track.drone_class == DroneClass.UNKNOWN:
            total *= 1.10

        total = max(0.0, min(100.0, total))

        # ── 위협 등급 판정 ────────────────────────────────────────────────────
        if   total >= 75:  level = ThreatLevel.CRITICAL
        elif total >= 55:  level = ThreatLevel.HIGH
        elif total >= 30:  level = ThreatLevel.MEDIUM
        elif total >= 10:  level = ThreatLevel.LOW
        else:              level = ThreatLevel.NONE

        return round(total, 1), level, " | ".join(reasons)


# ══════════════════════════════════════════════════════════════════════════════
# Layer 4: ROE 적용 + 교전 결정
# ══════════════════════════════════════════════════════════════════════════════

class ROEDecider:
    """
    교전규칙(ROE)에 따른 InterceptDecision 결정

    ┌─────────────────┬────────────────────────────────────┐
    │ ROE 모드         │ 결정 기준                           │
    ├─────────────────┼────────────────────────────────────┤
    │ WEAPONS_FREE    │ CRITICAL/HIGH → ENGAGE              │
    │                 │ MEDIUM        → INTERCEPT           │
    │                 │ LOW/NONE      → MONITOR             │
    ├─────────────────┼────────────────────────────────────┤
    │ WEAPONS_TIGHT   │ CRITICAL + HOSTILE → ENGAGE         │
    │                 │ HIGH + HOSTILE     → INTERCEPT      │
    │                 │ UNKNOWN           → MONITOR         │
    ├─────────────────┼────────────────────────────────────┤
    │ WEAPONS_HOLD    │ 모든 케이스 → HOLD                  │
    └─────────────────┴────────────────────────────────────┘
    """

    def decide(
        self,
        track: DroneTrack,
        roe: ROEMode,
        reason: str,
    ) -> InterceptDecision:

        if track.drone_class == DroneClass.FRIENDLY:
            return InterceptDecision.IGNORE

        if roe == ROEMode.WEAPONS_HOLD:
            return InterceptDecision.HOLD

        tl = track.threat_level
        dc = track.drone_class

        if roe == ROEMode.WEAPONS_FREE:
            if tl == ThreatLevel.CRITICAL:  return InterceptDecision.ENGAGE
            if tl == ThreatLevel.HIGH:      return InterceptDecision.ENGAGE
            if tl == ThreatLevel.MEDIUM:    return InterceptDecision.INTERCEPT
            return InterceptDecision.MONITOR

        if roe == ROEMode.WEAPONS_TIGHT:
            if tl == ThreatLevel.CRITICAL and dc == DroneClass.HOSTILE:
                return InterceptDecision.ENGAGE
            if tl == ThreatLevel.HIGH and dc == DroneClass.HOSTILE:
                return InterceptDecision.INTERCEPT
            if tl == ThreatLevel.CRITICAL:
                return InterceptDecision.INTERCEPT  # 미상이지만 위험
            if tl == ThreatLevel.HIGH:
                return InterceptDecision.MONITOR
            return InterceptDecision.MONITOR

        return InterceptDecision.MONITOR


# ══════════════════════════════════════════════════════════════════════════════
# Layer 5+6: 큐잉 엔진 (Cueing Engine)
# ══════════════════════════════════════════════════════════════════════════════

class CueingEngine:
    """
    요격 드론(ATK) 배치 및 요격 좌표 계산

    - ATK 드론 풀에서 가장 가까운 유닛을 배정
    - 표적 이동 경로 외삽 → 요격 교점 계산
    - 우선순위 정렬 (위협도 높은 순)
    """

    # ATK 드론 풀 (실운용 시 실시간 위치 DB 연동)
    ATK_DRONES = [
        {"id": "ATK-01", "lat": 37.56, "lon": 126.98, "status": "ready", "speed_kph": 120},
        {"id": "ATK-02", "lat": 37.45, "lon": 127.05, "status": "ready", "speed_kph": 120},
        {"id": "ATK-03", "lat": 37.70, "lon": 126.80, "status": "ready", "speed_kph": 120},
        {"id": "ATK-04", "lat": 37.50, "lon": 126.90, "status": "ready", "speed_kph": 120},
    ]

    def __init__(self):
        self._assigned: Dict[str, str] = {}   # track_id → atk_drone_id

    def assign(self, track: DroneTrack, decision: InterceptDecision) -> Tuple[Optional[str], Optional[float], Optional[float], Optional[float], Optional[float]]:
        """
        Returns:
            (atk_drone_id, intercept_lat, intercept_lon, intercept_alt_m, ttx_sec)
        """
        if decision in (InterceptDecision.MONITOR, InterceptDecision.IGNORE,
                        InterceptDecision.HOLD):
            return None, None, None, None, None

        # 이미 배정된 ATK가 있으면 재사용
        if track.track_id in self._assigned:
            atk_id = self._assigned[track.track_id]
            atk = next((d for d in self.ATK_DRONES if d["id"] == atk_id), None)
            if atk:
                dist_km = haversine_km(atk["lat"], atk["lon"], track.lat, track.lon)
                ttx = (dist_km / atk["speed_kph"]) * 3600
                i_lat, i_lon = intercept_point(track.lat, track.lon, track.velocity_kph, track.heading_deg, ttx)
                return atk_id, i_lat, i_lon, track.alt_m, round(ttx, 1)

        # 가장 가까운 대기 ATK 드론 선택
        available = [d for d in self.ATK_DRONES
                     if d["status"] == "ready" and d["id"] not in self._assigned.values()]
        if not available:
            # 전체 중 가장 가까운 것으로 폴백
            available = self.ATK_DRONES

        closest_atk = min(
            available,
            key=lambda d: haversine_km(d["lat"], d["lon"], track.lat, track.lon)
        )

        dist_km = haversine_km(closest_atk["lat"], closest_atk["lon"], track.lat, track.lon)
        ttx_sec = (dist_km / closest_atk["speed_kph"]) * 3600

        # 표적 이동 경로 외삽 → 요격 교점
        i_lat, i_lon = intercept_point(
            track.lat, track.lon,
            track.velocity_kph, track.heading_deg,
            ttx_sec
        )

        self._assigned[track.track_id] = closest_atk["id"]
        return closest_atk["id"], i_lat, i_lon, track.alt_m, round(ttx_sec, 1)

    def release(self, track_id: str):
        """임무 완료 후 ATK 드론 반환"""
        self._assigned.pop(track_id, None)


# ══════════════════════════════════════════════════════════════════════════════
# 메인 온톨로지 엔진 (통합 파이프라인)
# ══════════════════════════════════════════════════════════════════════════════

class ThreatOntologyEngine:
    """
    FPV 드론 위협 판단 5단계 온톨로지 엔진

    사용법:
        engine = ThreatOntologyEngine(roe=ROEMode.WEAPONS_FREE)
        result = engine.process(tracks_list)
    """

    def __init__(
        self,
        roe: ROEMode = ROEMode.WEAPONS_TIGHT,
        assets: List[DefendedAsset] = None,
    ):
        self.roe      = roe
        self.assets   = assets or DEFAULT_ASSETS
        self._scorer  = ThreatScorer()
        self._decider = ROEDecider()
        self._cueing  = CueingEngine()
        self._order_seq = 0

    def set_roe(self, roe: ROEMode):
        self.roe = roe

    def _next_order_id(self) -> str:
        self._order_seq += 1
        return f"ORD-{self._order_seq:05d}"

    def process(self, raw_tracks: List[dict]) -> OntologyResult:
        """
        단일 처리 사이클 — 센서 데이터 입력 → 요격 명령 출력

        Args:
            raw_tracks: 레이더/RF/EO-IR 융합 후 정규화된 항적 dict 리스트
                필수 키: track_id, lat, lon
                선택 키: alt_m, velocity_kph, heading_deg, ir_temp_c,
                         rf_freq_mhz, rf_power_dbm, iff_code, swarm_id

        Returns:
            OntologyResult
        """
        # ── 편대(swarm) 집계 ──────────────────────────────────────────────────
        swarm_map: Dict[str, List[str]] = {}
        for rd in raw_tracks:
            sid = rd.get("swarm_id")
            if sid:
                swarm_map.setdefault(sid, []).append(rd["track_id"])

        tracks: List[DroneTrack]      = []
        orders: List[InterceptOrder]  = []

        for rd in raw_tracks:
            # DroneTrack 생성
            t = DroneTrack(
                track_id     = rd["track_id"],
                lat          = float(rd.get("lat", 0)),
                lon          = float(rd.get("lon", 0)),
                alt_m        = float(rd.get("alt_m", 100)),
                velocity_kph = float(rd.get("velocity_kph", rd.get("vel", 0))),
                heading_deg  = float(rd.get("heading_deg", rd.get("heading", 0))),
                ir_temp_c    = float(rd.get("ir_temp_c", rd.get("ir_temp", 28))),
                rf_freq_mhz  = float(rd.get("rf_freq_mhz", 0)),
                rf_power_dbm = float(rd.get("rf_power_dbm", -80)),
                iff_code     = rd.get("iff_code"),
                swarm_id     = rd.get("swarm_id"),
            )

            swarm_size = len(swarm_map.get(t.swarm_id, [])) if t.swarm_id else 1

            # ── Level 1+2: 분류 ───────────────────────────────────────────────
            t.drone_class, t.drone_type = classify_drone(t, swarm_size)

            # ── Level 3: 위협도 점수 ───────────────────────────────────────────
            t.threat_score, t.threat_level, reason = self._scorer.score(
                t, self.assets, swarm_size
            )

            # ── Level 4: ROE 적용 → 교전 결정 ────────────────────────────────
            decision = self._decider.decide(t, self.roe, reason)

            # ── Level 5+6: 큐잉 (요격 좌표·ATK 배정) ─────────────────────────
            atk_id, i_lat, i_lon, i_alt, ttx = self._cueing.assign(t, decision)

            # 요격 명령 생성
            order = InterceptOrder(
                order_id      = self._next_order_id(),
                target_id     = t.track_id,
                decision      = decision,
                atk_drone_id  = atk_id,
                intercept_lat = i_lat,
                intercept_lon = i_lon,
                intercept_alt_m = i_alt,
                priority      = self._priority(t.threat_level),
                roe_mode      = self.roe,
                threat_score  = t.threat_score,
                threat_level  = t.threat_level,
                reason        = reason,
                ttx_sec       = ttx,
            )

            tracks.append(t)
            orders.append(order)

        # ── 전체 상황 판단 ────────────────────────────────────────────────────
        hostile_count = sum(1 for t in tracks if t.drone_class == DroneClass.HOSTILE)
        active_swarms = len(swarm_map)
        overall = self._overall_threat(tracks)
        situation = self._situation_label(tracks, orders, overall)

        return OntologyResult(
            tracks          = tracks,
            orders          = sorted(orders, key=lambda o: o.priority),
            situation_label = situation,
            overall_threat  = overall,
            roe_mode        = self.roe,
            active_swarms   = active_swarms,
            hostile_count   = hostile_count,
        )

    def _priority(self, level: ThreatLevel) -> int:
        return {
            ThreatLevel.CRITICAL: 1,
            ThreatLevel.HIGH:     2,
            ThreatLevel.MEDIUM:   3,
            ThreatLevel.LOW:      4,
            ThreatLevel.NONE:     5,
        }.get(level, 5)

    def _overall_threat(self, tracks: List[DroneTrack]) -> ThreatLevel:
        if not tracks:
            return ThreatLevel.NONE
        levels = [t.threat_level for t in tracks]
        for lvl in (ThreatLevel.CRITICAL, ThreatLevel.HIGH,
                    ThreatLevel.MEDIUM,   ThreatLevel.LOW):
            if lvl in levels:
                return lvl
        return ThreatLevel.NONE

    def _situation_label(
        self,
        tracks: List[DroneTrack],
        orders: List[InterceptOrder],
        overall: ThreatLevel,
    ) -> str:
        engage_cnt   = sum(1 for o in orders if o.decision == InterceptDecision.ENGAGE)
        intercept_cnt= sum(1 for o in orders if o.decision == InterceptDecision.INTERCEPT)
        hostile_cnt  = sum(1 for t in tracks if t.drone_class == DroneClass.HOSTILE)
        kamikaze_cnt = sum(1 for t in tracks if t.drone_type  == DroneType.KAMIKAZE)

        if overall == ThreatLevel.CRITICAL:
            return (f"🔴 CRITICAL — 자폭형 {kamikaze_cnt}대 포함 적 드론 {hostile_cnt}대 접근중 "
                    f"| ENGAGE {engage_cnt}건 명령 발령")
        if overall == ThreatLevel.HIGH:
            return (f"🟠 HIGH — 적 드론 {hostile_cnt}대 탐지 "
                    f"| INTERCEPT {intercept_cnt}건 요격 출격")
        if overall == ThreatLevel.MEDIUM:
            return f"🟡 MEDIUM — 미상 드론 {len(tracks)}대 모니터링 중"
        if overall == ThreatLevel.LOW:
            return f"🟢 LOW — 저위협 드론 {len(tracks)}대 감시 중"
        return "⚪ 위협 없음 — 정상 운용"


# ══════════════════════════════════════════════════════════════════════════════
# 모듈 자가 테스트
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import json

    engine = ThreatOntologyEngine(roe=ROEMode.WEAPONS_FREE)

    test_tracks = [
        # 자폭형 — 고속, 고열, 적 RF
        {"track_id": "T-001", "lat": 37.52, "lon": 126.98,
         "velocity_kph": 95, "heading_deg": 180, "ir_temp_c": 42,
         "rf_freq_mhz": 433.2, "alt_m": 30, "swarm_id": "SW-ALPHA"},
        # 정찰형 — 저속, 호버
        {"track_id": "T-002", "lat": 37.60, "lon": 127.05,
         "velocity_kph": 12, "heading_deg": 90, "ir_temp_c": 29,
         "rf_freq_mhz": 2440, "alt_m": 120},
        # 아군
        {"track_id": "T-003", "lat": 37.50, "lon": 126.90,
         "velocity_kph": 60, "heading_deg": 45, "ir_temp_c": 30,
         "iff_code": "ALPHA-1", "alt_m": 100},
        # 군집 편대 2번째
        {"track_id": "T-004", "lat": 37.53, "lon": 126.97,
         "velocity_kph": 88, "heading_deg": 185, "ir_temp_c": 38,
         "rf_freq_mhz": 868.5, "alt_m": 25, "swarm_id": "SW-ALPHA"},
    ]

    result = engine.process(test_tracks)
    print("=" * 70)
    print(f"상황: {result.situation_label}")
    print(f"전체 위협: {result.overall_threat.value}  |  ROE: {result.roe_mode.value}")
    print(f"적 드론: {result.hostile_count}대  |  활성 편대: {result.active_swarms}개")
    print("=" * 70)
    for o in result.orders:
        print(f"[{o.order_id}] {o.decision.value:12s} target={o.target_id} "
              f"score={o.threat_score:.1f} atk={o.atk_drone_id} "
              f"ttx={o.ttx_sec}s")
    print("=" * 70)
