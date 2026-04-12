#!/usr/bin/env python3
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  BEI Agent — Battery Edge Intelligence Autonomous Control Agent             ║
# ║  IMC AI Smart Battery Platform · bei_agent.py · v1.0.0                     ║
# ║                                                                              ║
# ║  실행 환경: Raspberry Pi CM4 / Jetson Orin Nano (BEI-1 하드웨어)            ║
# ║  인터페이스: CAN (python-can), SMBus/I²C (smbus2), GPIO (RPi.GPIO/Jetson)   ║
# ║  통신: WiFi 6 → 제조사 클라우드 서버 (MQTT / HTTPS REST)                   ║
# ║                                                                              ║
# ║  아키텍처:                                                                   ║
# ║   센서 수집 → Signal Processing → Operational Ontology →                   ║
# ║   Agentic AI (NPU RUL/RiskScore) → MCP 명령 → CAN 전송 → 클라우드 알림     ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

"""
BEI Agent: 실제 BMS와 연결하는 자율 배터리 제어 에이전트

사용법:
    sudo python3 bei_agent.py --interface can0 --baudrate 500000
    sudo python3 bei_agent.py --interface socketcan --channel can0 --simulate

의존성:
    pip install python-can smbus2 paho-mqtt requests numpy
    # Jetson/RPi GPIO:
    # pip install Jetson.GPIO  (Jetson)
    # pip install RPi.GPIO     (Raspberry Pi)
"""

import argparse
import asyncio
import json
import logging
import math
import random
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, List, Dict, Any

# ─── Optional imports (gracefully degraded) ───────────────────────────────────
try:
    import can                          # python-can
    CAN_AVAILABLE = True
except ImportError:
    CAN_AVAILABLE = False

try:
    import smbus2                       # SMBus / I²C
    SMBUS_AVAILABLE = True
except ImportError:
    SMBUS_AVAILABLE = False

try:
    import paho.mqtt.client as mqtt     # MQTT
    MQTT_AVAILABLE = True
except ImportError:
    MQTT_AVAILABLE = False

try:
    import requests                     # HTTP REST
    HTTP_AVAILABLE = True
except ImportError:
    HTTP_AVAILABLE = False

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] BEI │ %(message)s',
    datefmt='%H:%M:%S.%f'[:-3],
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/tmp/bei_agent.log', encoding='utf-8')
    ]
)
log = logging.getLogger('bei')


# ══════════════════════════════════════════════════════════════════════════════
# CAN Message IDs  (J1939-like 29-bit extended frame)
# ══════════════════════════════════════════════════════════════════════════════
class CANID:
    # ─ RX: BMS → BEI ─────────────────────────────────────────────────────────
    BMS_STATUS         = 0x0CF11E05   # SOC, SOH, 팩 전류, 총 전압
    BMS_CELL_VOLTAGE   = 0x0CF11E06   # 셀별 전압 (2셀/프레임, mV×10)
    BMS_TEMPERATURE    = 0x0CF11E07   # 온도 센서 (2채널/프레임, 0.1°C)
    BMS_IMPEDANCE      = 0x0CF11E08   # 임피던스 EIS (mΩ×10)
    BMS_FAULT          = 0x18FF1400   # 하드웨어 결함 플래그

    # ─ TX: BEI → BMS/Charger ─────────────────────────────────────────────────
    CMD_CHARGE_CURRENT = 0x18FF50E5   # 충전 전류 제한 (A×10, 0=차단)
    CMD_FAN_CONTROL    = 0x18FFA003   # 냉각 팬/Peltier (0=OFF, 100=100%)
    CMD_CELL_BALANCE   = 0x18FFA004   # 셀 밸런싱 (0=OFF, 1=ON)
    CMD_MOSFET_CUT     = 0x18FF1500   # MOSFET 긴급 차단 (0=정상, 1=차단)
    CMD_ALERT_NOTIFY   = 0x18FFFE00   # 상위 시스템 알림 플래그


# ══════════════════════════════════════════════════════════════════════════════
# SMBus / I²C Registers  (SBS 스마트배터리 기준)
# ══════════════════════════════════════════════════════════════════════════════
class SMBusReg:
    TEMPERATURE      = 0x08   # 0.1 K 단위
    VOLTAGE          = 0x09   # mV
    CURRENT          = 0x0A   # mA (signed)
    RELATIVE_SOC     = 0x0D   # %
    ABSOLUTE_SOC     = 0x0E   # %
    REMAINING_CAP    = 0x0F   # mAh
    FULL_CHARGE_CAP  = 0x10   # mAh
    RUN_TIME_TO_EMPTY= 0x11   # min
    AVERAGE_CURRENT  = 0x14   # mA (signed)
    CYCLE_COUNT      = 0x17   # count
    DESIGN_CAP       = 0x18   # mAh
    DESIGN_VOLTAGE   = 0x19   # mV
    MANUFACTURE_DATE = 0x1B
    BMS_STATUS_REG   = 0x16   # bit-field


# ══════════════════════════════════════════════════════════════════════════════
# Operational Ontology Enums
# ══════════════════════════════════════════════════════════════════════════════
class OntologyEvent(Enum):
    NONE                  = "None"
    THERMAL_RISE          = "ThermalRiseEvent"
    THERMAL_RUNAWAY       = "ThermalRunawayEvent"
    VOLTAGE_IMBALANCE     = "VoltageImbalanceEvent"
    IMPEDANCE_ANOMALY     = "ImpedanceAnomalyEvent"
    LITHIUM_PLATING       = "LithiumPlatingEvent"
    OVER_DISCHARGE        = "OverDischargeEvent"
    SEI_GROWTH            = "SEIGrowthEvent"
    FAST_CHARGE_STRESS    = "FastChargeStressEvent"
    INTERNAL_SHORT        = "InternalShortEvent"

class RiskLevel(Enum):
    OK      = "ok"        # 0–24
    WARNING = "warn"      # 25–59
    DANGER  = "danger"    # 60–79
    CRITICAL= "critical"  # 80–100

class MCPAction(Enum):
    NONE              = "none"
    REDUCE_CURRENT_25 = "reduce_current_25pct"
    REDUCE_CURRENT_40 = "reduce_current_40pct"
    REDUCE_CURRENT_60 = "reduce_current_60pct"
    FAN_ON_50         = "fan_on_50pct"
    FAN_ON_100        = "fan_on_100pct"
    CELL_BALANCE_ON   = "cell_balance_on"
    MOSFET_CUT        = "mosfet_emergency_cut"
    CLOUD_ALERT_WARN  = "cloud_alert_warn"
    CLOUD_ALERT_CRIT  = "cloud_alert_critical"


# ══════════════════════════════════════════════════════════════════════════════
# Data Models
# ══════════════════════════════════════════════════════════════════════════════
@dataclass
class SensorReading:
    """Layer 1: 하드웨어 인터페이스 — 원시 센서 데이터"""
    timestamp_ms:    int   = 0
    # 온도
    temp_max:        float = 25.0    # °C, 최고 셀 온도
    temp_avg:        float = 25.0    # °C, 평균 온도
    dtemp_dt:        float = 0.0     # °C/min, 온도 상승률
    cell_temps:      List[float] = field(default_factory=lambda: [25.0]*12)
    # 전압
    cell_volts:      List[float] = field(default_factory=lambda: [3.7]*12)  # V
    pack_voltage:    float = 44.4    # V
    delta_v:         float = 0.0     # mV, 셀 전압 불균형
    # 전류
    current_a:       float = 0.0     # A (+충전, -방전)
    avg_current:     float = 0.0     # A, 이동평균
    # 임피던스
    impedance_mohm:  float = 40.0    # mΩ
    imp_baseline:    float = 40.0    # mΩ, 기준값
    imp_delta_pct:   float = 0.0     # %, 기준 대비 변화
    # SOC / SOH
    soc_pct:         float = 80.0    # %
    soh_pct:         float = 100.0   # %
    cycle_count:     int   = 0
    # 결함 플래그
    bms_fault_bits:  int   = 0


@dataclass
class ProcessedSignal:
    """Layer 2: 신호 처리 — Kalman 필터링, dV/dt, dT/dt"""
    kalman_temp:       float = 25.0
    kalman_impedance:  float = 40.0
    dv_dt:             float = 0.0   # V/s
    dt_dt:             float = 0.0   # °C/min (필터링)
    cell_imbalance:    float = 0.0   # mV
    outliers_removed:  int   = 0
    confidence:        float = 1.0   # 0–1


@dataclass
class OntologyInference:
    """Layer 3: Operational Ontology — 5단계 계층 추론"""
    # Observation (Level 1)
    observation:    str  = "정상 센서 데이터"
    # Event (Level 2)
    events:         List[OntologyEvent] = field(default_factory=list)
    # Situation (Level 3)
    situation:      str  = "정상 운용"
    # Risk (Level 4)
    risk_score:     float = 8.0     # 0–100
    risk_level:     RiskLevel = RiskLevel.OK
    # Intent (Level 5)
    intent:         str  = "계속 모니터링"
    # Predictions
    rul_cycles:     int  = 700
    minutes_to_risk: Optional[int] = None


@dataclass
class MCPCommand:
    """Layer 5: MCP 제어 명령"""
    action:            MCPAction = MCPAction.NONE
    charge_current_a:  float = -1.0   # -1 = 변경 없음
    fan_pct:           int   = 0      # 0–100
    cell_balance:      bool  = False
    mosfet_cut:        bool  = False
    alert_level:       str   = "none" # none/warn/critical
    can_frames:        List[Dict] = field(default_factory=list)
    reason:            str   = ""


# ══════════════════════════════════════════════════════════════════════════════
# Layer 1: Hardware Interface (CAN / SMBus)
# ══════════════════════════════════════════════════════════════════════════════
class HardwareInterface:
    """
    실제 하드웨어와의 인터페이스.
    --simulate 플래그가 있으면 가상 데이터로 동작.
    """

    def __init__(self, interface: str = 'can0', baudrate: int = 500000,
                 smbus_addr: int = 0x0B, simulate: bool = False):
        self.simulate   = simulate
        self.smbus_addr = smbus_addr
        self._can_bus: Optional[Any] = None
        self._smbus:   Optional[Any] = None
        self._sim_time  = 0.0
        self._sim_scenario = 'normal'

        if not simulate:
            self._init_can(interface, baudrate)
            self._init_smbus()

    def _init_can(self, interface: str, baudrate: int):
        if not CAN_AVAILABLE:
            log.warning("python-can 없음 — CAN 비활성화 (pip install python-can)")
            return
        try:
            self._can_bus = can.interface.Bus(
                channel=interface,
                bustype='socketcan',
                bitrate=baudrate
            )
            log.info(f"CAN 버스 연결: {interface} @ {baudrate} bps")
        except Exception as e:
            log.error(f"CAN 초기화 실패: {e}")

    def _init_smbus(self):
        if not SMBUS_AVAILABLE:
            log.warning("smbus2 없음 — SMBus 비활성화 (pip install smbus2)")
            return
        try:
            self._smbus = smbus2.SMBus(1)   # /dev/i2c-1
            log.info(f"SMBus I²C 연결: 버스 1, 주소 0x{self.smbus_addr:02X}")
        except Exception as e:
            log.error(f"SMBus 초기화 실패: {e}")

    # ─── Read ─────────────────────────────────────────────────────────────────
    def read_sensors(self) -> SensorReading:
        self._sim_time += 0.1  # 100ms
        if self.simulate:
            return self._simulate_sensors()
        else:
            return self._read_real_sensors()

    def _read_real_sensors(self) -> SensorReading:
        """실제 BMS에서 CAN / SMBus 데이터 수집"""
        r = SensorReading(timestamp_ms=int(time.time() * 1000))

        # ── SMBus 기본 상태 ─────────────────────────────────────────────────
        if self._smbus:
            try:
                raw_temp  = self._smbus.read_word_data(self.smbus_addr, SMBusReg.TEMPERATURE)
                r.temp_avg = (raw_temp * 0.1) - 273.15    # K → °C

                raw_volt  = self._smbus.read_word_data(self.smbus_addr, SMBusReg.VOLTAGE)
                r.pack_voltage = raw_volt / 1000.0          # mV → V

                raw_curr  = self._smbus.read_word_data(self.smbus_addr, SMBusReg.CURRENT)
                # signed 16-bit
                if raw_curr > 32767: raw_curr -= 65536
                r.current_a = raw_curr / 1000.0             # mA → A

                r.soc_pct   = self._smbus.read_word_data(self.smbus_addr, SMBusReg.RELATIVE_SOC)
                r.cycle_count = self._smbus.read_word_data(self.smbus_addr, SMBusReg.CYCLE_COUNT)
                r.bms_fault_bits = self._smbus.read_word_data(self.smbus_addr, SMBusReg.BMS_STATUS_REG)
            except Exception as e:
                log.warning(f"SMBus 읽기 오류: {e}")

        # ── CAN 프레임 수신 ─────────────────────────────────────────────────
        if self._can_bus:
            try:
                # 비블로킹 수신 (timeout=0)
                msg = self._can_bus.recv(timeout=0.05)
                if msg:
                    self._parse_can_frame(msg, r)
            except Exception as e:
                log.warning(f"CAN 수신 오류: {e}")

        return r

    def _parse_can_frame(self, msg: Any, r: SensorReading):
        """CAN 프레임 파싱"""
        aid = msg.arbitration_id
        d   = msg.data

        if aid == CANID.BMS_STATUS:
            r.soc_pct     = d[0]                              # byte0: SOC %
            r.soh_pct     = d[1]                              # byte1: SOH %
            curr_raw      = (d[2] << 8) | d[3]
            if curr_raw > 32767: curr_raw -= 65536
            r.current_a   = curr_raw * 0.1                    # ×0.1 A
            volt_raw      = (d[4] << 8) | d[5]
            r.pack_voltage= volt_raw * 0.1                    # ×0.1 V

        elif aid == CANID.BMS_CELL_VOLTAGE:
            cell_idx = d[0]   # 시작 셀 번호
            for i in range(min(3, (len(d)-1)//2)):
                v = ((d[1+i*2] << 8) | d[2+i*2]) * 0.001    # mV→V
                if cell_idx + i < len(r.cell_volts):
                    r.cell_volts[cell_idx + i] = v

        elif aid == CANID.BMS_TEMPERATURE:
            for i in range(min(4, len(d)//2)):
                t = ((d[i*2] << 8) | d[i*2+1]) * 0.1 - 273.15  # K→°C
                if i < len(r.cell_temps):
                    r.cell_temps[i] = t

        elif aid == CANID.BMS_IMPEDANCE:
            imp_raw = (d[0] << 8) | d[1]
            r.impedance_mohm = imp_raw * 0.1                  # ×0.1 mΩ

        elif aid == CANID.BMS_FAULT:
            r.bms_fault_bits = (d[0] << 8) | d[1]

    def _simulate_sensors(self) -> SensorReading:
        """개발/테스트용 시뮬레이션 센서 데이터"""
        t  = self._sim_time
        sc = self._sim_scenario

        # 시나리오별 목표값
        scenarios = {
            'normal':     dict(temp=28, dtemp=0.08, delta_v=3.2, imp=42, curr=2.1, soc=87, riskBase=8),
            'heat':       dict(temp=42, dtemp=1.2,  delta_v=8.1, imp=46, curr=2.8, soc=85, riskBase=42),
            'thermal':    dict(temp=56, dtemp=2.1,  delta_v=18,  imp=52, curr=1.2, soc=83, riskBase=78),
            'deep':       dict(temp=32, dtemp=0.3,  delta_v=22,  imp=61, curr=-3.5,soc=12, riskBase=55),
            'fastcharge': dict(temp=48, dtemp=1.8,  delta_v=14,  imp=49, curr=4.8, soc=35, riskBase=65),
        }
        p = scenarios.get(sc, scenarios['normal'])

        noise = lambda amp: (random.random() - 0.5) * amp * 2

        base_v = 3.820 - p['delta_v'] / 1000.0
        cell_v = [base_v + noise(0.001) for _ in range(12)]

        cell_t = []
        for i in range(12):
            offset = 2.5 if i == 6 else (1.2 if i in (3, 9) else noise(0.5))
            cell_t.append(p['temp'] + offset + noise(0.08))

        return SensorReading(
            timestamp_ms   = int(time.time() * 1000),
            temp_max       = max(cell_t),
            temp_avg       = sum(cell_t) / len(cell_t),
            dtemp_dt       = p['dtemp'] + noise(0.01),
            cell_temps     = cell_t,
            cell_volts     = cell_v,
            pack_voltage   = sum(cell_v),
            delta_v        = p['delta_v'] + noise(0.5),
            current_a      = p['curr'] + noise(0.03),
            avg_current    = p['curr'],
            impedance_mohm = p['imp'] + noise(0.05),
            imp_baseline   = 40.0,
            imp_delta_pct  = ((p['imp'] - 40) / 40.0) * 100,
            soc_pct        = p['soc'] + noise(0.2),
            soh_pct        = 94.2 - t * 0.0001,
            cycle_count    = 47,
            bms_fault_bits = 1 if sc == 'thermal' and t > 30 else 0,
        )

    def set_scenario(self, sc: str):
        """시뮬레이션 시나리오 변경"""
        self._sim_scenario = sc
        log.info(f"시뮬레이션 시나리오 전환: {sc}")

    # ─── Write (CAN 명령 전송) ────────────────────────────────────────────────
    def send_can_command(self, arb_id: int, data: List[int]) -> bool:
        """BMS/충전기로 CAN 명령 전송"""
        frame_hex = ' '.join(f'{b:02X}' for b in data)
        log.info(f"CAN TX  0x{arb_id:08X} [{len(data)}] {frame_hex}")

        if self.simulate:
            return True  # 시뮬레이션 모드에서는 항상 성공

        if not self._can_bus:
            log.warning("CAN 버스 없음 — 명령 전송 불가")
            return False

        try:
            msg = can.Message(
                arbitration_id=arb_id,
                data=data,
                is_extended_id=True
            )
            self._can_bus.send(msg)
            return True
        except Exception as e:
            log.error(f"CAN 전송 오류: {e}")
            return False

    def close(self):
        if self._can_bus:
            try: self._can_bus.shutdown()
            except: pass
        if self._smbus:
            try: self._smbus.close()
            except: pass


# ══════════════════════════════════════════════════════════════════════════════
# Layer 2: Signal Processing (Kalman Filter)
# ══════════════════════════════════════════════════════════════════════════════
class SignalProcessor:
    """
    Kalman 필터를 이용한 노이즈 제거, dV/dt·dT/dt 계산, 이상치 제거
    """

    def __init__(self):
        # Kalman states
        self._kf_temp = KalmanFilter(Q=0.01, R=0.5, x0=25.0)
        self._kf_imp  = KalmanFilter(Q=0.005, R=0.3, x0=40.0)
        self._prev_temp = 25.0
        self._prev_volt = 3.7
        self._prev_time = time.time()
        self._temp_history: List[float] = []
        self._imp_history:  List[float] = []

    def process(self, raw: SensorReading) -> ProcessedSignal:
        now = time.time()
        dt  = max(0.001, now - self._prev_time)
        self._prev_time = now

        # Kalman filtering
        k_temp = self._kf_temp.update(raw.temp_max)
        k_imp  = self._kf_imp.update(raw.impedance_mohm)

        # dT/dt (°C/min)
        dt_dt = (k_temp - self._prev_temp) / dt * 60.0
        # 변화가 너무 크면 이상치 제거
        if abs(dt_dt) > 10.0:
            dt_dt = self._prev_dt_dt if hasattr(self, '_prev_dt_dt') else 0.0
        self._prev_dt_dt = dt_dt

        # dV/dt (V/s)
        avg_v = sum(raw.cell_volts) / len(raw.cell_volts) if raw.cell_volts else 3.7
        dv_dt = (avg_v - self._prev_volt) / dt
        self._prev_volt = avg_v

        # 셀 전압 불균형
        if raw.cell_volts:
            cell_imbalance = (max(raw.cell_volts) - min(raw.cell_volts)) * 1000.0  # mV
        else:
            cell_imbalance = raw.delta_v

        self._prev_temp = k_temp
        self._temp_history.append(k_temp)
        self._imp_history.append(k_imp)
        if len(self._temp_history) > 100: self._temp_history.pop(0)
        if len(self._imp_history)  > 100: self._imp_history.pop(0)

        return ProcessedSignal(
            kalman_temp       = k_temp,
            kalman_impedance  = k_imp,
            dv_dt             = dv_dt,
            dt_dt             = dt_dt,
            cell_imbalance    = cell_imbalance,
            confidence        = 1.0,
        )


class KalmanFilter:
    """단순 스칼라 Kalman 필터"""
    def __init__(self, Q: float = 0.01, R: float = 0.5, x0: float = 0.0):
        self.Q = Q    # 프로세스 노이즈
        self.R = R    # 관측 노이즈
        self.x = x0   # 상태 추정
        self.P = 1.0  # 추정 오차 공분산

    def update(self, z: float) -> float:
        # 예측
        P_ = self.P + self.Q
        # 갱신
        K    = P_ / (P_ + self.R)
        self.x = self.x + K * (z - self.x)
        self.P = (1 - K) * P_
        return self.x


# ══════════════════════════════════════════════════════════════════════════════
# Layer 3: Operational Ontology Engine
# ══════════════════════════════════════════════════════════════════════════════
class OntologyEngine:
    """
    5단계 Operational Ontology:
    Observation → Event → Situation → Risk → Intent

    임계값은 배터리 타입/용량에 따라 조정 가능.
    """

    # 임계값 기본값 (6S LiPo/Li-Ion 팩 기준)
    THRESHOLDS = {
        'temp_warn':      40.0,    # °C
        'temp_danger':    52.0,    # °C
        'temp_critical':  65.0,    # °C
        'dtemp_warn':     0.8,     # °C/min
        'dtemp_danger':   1.5,     # °C/min
        'delta_v_warn':   10.0,    # mV
        'delta_v_danger': 20.0,    # mV
        'imp_warn_delta': 5.0,     # % (기준 대비 증가)
        'imp_danger_delta':12.0,   # %
        'curr_max_warn':  4.0,     # A (충전)
        'curr_max_danger':4.8,     # A
        'soc_low_warn':   15.0,    # %
        'soc_low_danger': 8.0,     # %
    }

    def __init__(self, thresholds: Optional[Dict] = None):
        if thresholds:
            self.THRESHOLDS.update(thresholds)
        self._event_history: List[OntologyEvent] = []
        self._risk_history:  List[float] = []
        self._baseline_imp:  Optional[float] = None

    def infer(self, raw: SensorReading, sig: ProcessedSignal) -> OntologyInference:
        """5단계 추론 실행"""
        th = self.THRESHOLDS

        # ── Level 1: Observation ──────────────────────────────────────────────
        obs = (f"셀온도 {raw.temp_max:.1f}°C · ΔV {sig.cell_imbalance:.1f}mV · "
               f"임피던스 {raw.impedance_mohm:.1f}mΩ · 전류 {raw.current_a:.1f}A")

        # ── Level 2: Events ───────────────────────────────────────────────────
        events: List[OntologyEvent] = []

        if sig.kalman_temp > th['temp_warn']:
            events.append(OntologyEvent.THERMAL_RISE)
        if sig.kalman_temp > th['temp_danger']:
            events.append(OntologyEvent.THERMAL_RUNAWAY)

        if sig.cell_imbalance > th['delta_v_warn']:
            events.append(OntologyEvent.VOLTAGE_IMBALANCE)

        # 임피던스 기준값 설정 (초기 10회 평균)
        if self._baseline_imp is None:
            self._risk_history.append(raw.impedance_mohm)
            if len(self._risk_history) >= 10:
                self._baseline_imp = sum(self._risk_history) / len(self._risk_history)
                log.info(f"임피던스 기준값 확정: {self._baseline_imp:.1f} mΩ")
        else:
            imp_delta = (raw.impedance_mohm - self._baseline_imp) / self._baseline_imp * 100
            if imp_delta > th['imp_warn_delta']:
                events.append(OntologyEvent.IMPEDANCE_ANOMALY)
            if imp_delta > th['imp_danger_delta'] and sig.dt_dt > th['dtemp_warn']:
                events.append(OntologyEvent.LITHIUM_PLATING)
            if imp_delta > th['imp_danger_delta'] * 2:
                events.append(OntologyEvent.SEI_GROWTH)

        if raw.soc_pct < th['soc_low_warn']:
            events.append(OntologyEvent.OVER_DISCHARGE)

        if raw.current_a > th['curr_max_warn']:
            events.append(OntologyEvent.FAST_CHARGE_STRESS)

        # 내부 단락: 온도↑ + 임피던스↓ 동시 발생
        if (sig.kalman_temp > th['temp_warn'] and
                raw.impedance_mohm < (self._baseline_imp or 40.0) * 0.85):
            events.append(OntologyEvent.INTERNAL_SHORT)

        # ── Level 3: Situation ────────────────────────────────────────────────
        n = len(events)
        has_thermal   = OntologyEvent.THERMAL_RUNAWAY in events
        has_plating   = OntologyEvent.LITHIUM_PLATING in events
        has_short     = OntologyEvent.INTERNAL_SHORT in events
        has_overdis   = OntologyEvent.OVER_DISCHARGE in events

        if   n == 0:
            situation = "정상 운용 중"
        elif has_short:
            situation = "⚠️ 내부 단락 의심 — 즉시 사용 중단 권고"
        elif has_thermal and has_plating:
            situation = "🔴 열폭주 + 리튬 석출 복합 위험"
        elif has_thermal:
            situation = "🔴 열폭주 임박 — 온도 임계 초과"
        elif has_overdis:
            situation = "🟣 과방전 + 셀 불균형 발생"
        elif n >= 3:
            situation = "🟡 복합 이상 패턴 감지 — 주의 모드"
        elif n >= 2:
            situation = "🟡 경고: 복수 센서 이상"
        else:
            situation = f"🟡 경고: {events[0].value}"

        # ── Level 4: Risk Score ───────────────────────────────────────────────
        risk = 8.0  # 기본값

        # 온도 기여
        t = sig.kalman_temp
        if t > th['temp_critical']: risk += 50
        elif t > th['temp_danger']:  risk += 35
        elif t > th['temp_warn']:    risk += 18

        # dT/dt 기여
        dt = sig.dt_dt
        if dt > th['dtemp_danger']: risk += 20
        elif dt > th['dtemp_warn']: risk += 10

        # 전압 불균형 기여
        dv = sig.cell_imbalance
        if dv > th['delta_v_danger']: risk += 15
        elif dv > th['delta_v_warn']:  risk += 8

        # 임피던스 기여
        if self._baseline_imp:
            id_pct = (raw.impedance_mohm - self._baseline_imp) / self._baseline_imp * 100
            if id_pct > th['imp_danger_delta']: risk += 12
            elif id_pct > th['imp_warn_delta']:  risk += 6

        # 전류 기여
        c = raw.current_a
        if c > th['curr_max_danger']: risk += 12
        elif c > th['curr_max_warn']:  risk += 6

        # SOC 기여
        if raw.soc_pct < th['soc_low_danger']: risk += 10
        elif raw.soc_pct < th['soc_low_warn']:  risk += 5

        # 복합 이벤트 가중치
        if has_short:   risk *= 1.5
        if has_plating and has_thermal: risk *= 1.3

        risk = max(0.0, min(100.0, risk))
        risk_rounded = round(risk, 1)

        # 위험 수준 분류
        if   risk >= 80: rl = RiskLevel.CRITICAL
        elif risk >= 60: rl = RiskLevel.DANGER
        elif risk >= 25: rl = RiskLevel.WARNING
        else:            rl = RiskLevel.OK

        # ── Level 5: Intent ───────────────────────────────────────────────────
        if   rl == RiskLevel.CRITICAL: intent = "긴급 차단 + 제조사 알림"
        elif rl == RiskLevel.DANGER:   intent = "충전 전류 감소 + 냉각 팬 ON + 알림"
        elif rl == RiskLevel.WARNING:  intent = "충전 전류 감소 + 모니터링 강화"
        else:                           intent = "정상 운용 계속 — 모니터링"

        # RUL 추정 (간단한 선형 모델)
        soh = raw.soh_pct
        rul = max(0, int((soh - 70.0) / 30.0 * 700 + raw.cycle_count * 0.5))

        # 위험까지 남은 시간 추정 (dT/dt 기반)
        minutes_to_risk = None
        if 0 < dt < 10 and t < th['temp_danger']:
            minutes_to_risk = int((th['temp_danger'] - t) / dt)

        return OntologyInference(
            observation     = obs,
            events          = events,
            situation       = situation,
            risk_score      = risk_rounded,
            risk_level      = rl,
            intent          = intent,
            rul_cycles      = rul,
            minutes_to_risk = minutes_to_risk,
        )


# ══════════════════════════════════════════════════════════════════════════════
# Layer 4: Agentic AI — MCP Decision Engine
# ══════════════════════════════════════════════════════════════════════════════
class AgenticController:
    """
    위험도 스코어 기반 MCP(Model Context Protocol) 자동 제어 결정 엔진.
    충전 전류, 냉각 팬, 셀 밸런싱, MOSFET 차단을 자율 제어.
    """

    def __init__(self, current_limit_a: float = 5.0):
        self.max_current = current_limit_a
        self._last_action = MCPAction.NONE
        self._action_count = 0

    def decide(self, infer: OntologyInference, raw: SensorReading) -> MCPCommand:
        """위험도 기반 MCP 제어 명령 결정"""
        rl    = infer.risk_level
        score = infer.risk_score
        curr  = raw.current_a

        cmd = MCPCommand()

        if rl == RiskLevel.OK:
            cmd.action          = MCPAction.NONE
            cmd.charge_current_a= -1   # 변경 없음
            cmd.fan_pct         = 0
            cmd.cell_balance    = False
            cmd.mosfet_cut      = False
            cmd.alert_level     = "none"
            cmd.reason          = f"정상 — 위험도 {score}/100, 개입 없음"

        elif rl == RiskLevel.WARNING:
            reduced = max(0.5, curr * 0.75)
            cmd.action          = MCPAction.REDUCE_CURRENT_25
            cmd.charge_current_a= reduced
            cmd.fan_pct         = 30 if score > 40 else 0
            cmd.cell_balance    = OntologyEvent.VOLTAGE_IMBALANCE in infer.events
            cmd.mosfet_cut      = False
            cmd.alert_level     = "warn"
            cmd.reason          = (f"경고 — 위험도 {score}/100, "
                                   f"충전 전류 {curr:.1f}A → {reduced:.1f}A 감소")

        elif rl == RiskLevel.DANGER:
            reduced = max(0.3, curr * 0.40)
            cmd.action          = MCPAction.REDUCE_CURRENT_60
            cmd.charge_current_a= reduced
            cmd.fan_pct         = 100
            cmd.cell_balance    = True
            cmd.mosfet_cut      = False
            cmd.alert_level     = "critical"
            cmd.reason          = (f"위험 — 위험도 {score}/100, "
                                   f"충전 전류 {curr:.1f}A → {reduced:.1f}A, 팬 100%, 밸런싱 ON")

        else:  # CRITICAL ≥ 80
            cmd.action          = MCPAction.MOSFET_CUT
            cmd.charge_current_a= 0.0   # 차단
            cmd.fan_pct         = 100
            cmd.cell_balance    = True
            cmd.mosfet_cut      = True
            cmd.alert_level     = "critical"
            cmd.reason          = (f"🚨 위급 — 위험도 {score}/100, "
                                   f"MOSFET 긴급 차단, 팬 100%, 제조사 알림")

        # CAN 프레임 생성
        cmd.can_frames = self._build_can_frames(cmd, raw)
        self._last_action = cmd.action
        self._action_count += 1
        return cmd

    def _build_can_frames(self, cmd: MCPCommand, raw: SensorReading) -> List[Dict]:
        """MCP 명령을 실제 CAN 프레임으로 변환"""
        frames = []

        # 충전 전류 명령
        if cmd.charge_current_a >= 0:
            cur_raw = int(min(0xFFFF, cmd.charge_current_a * 10))
            frames.append({
                'id':   CANID.CMD_CHARGE_CURRENT,
                'data': [
                    0x01 if cmd.charge_current_a > 0 else 0x00,
                    (cur_raw >> 8) & 0xFF,
                    cur_raw & 0xFF,
                    0x00, 0xFF, 0xFF, 0xFF, 0xFF
                ],
                'desc': f"충전전류 {cmd.charge_current_a:.1f}A 명령"
            })

        # 냉각 팬 명령
        frames.append({
            'id':   CANID.CMD_FAN_CONTROL,
            'data': [
                0x01 if cmd.fan_pct > 0 else 0x00,
                cmd.fan_pct,
                0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF
            ],
            'desc': f"냉각팬 {'ON ' + str(cmd.fan_pct) + '%' if cmd.fan_pct > 0 else 'OFF'}"
        })

        # 셀 밸런싱
        if cmd.cell_balance:
            frames.append({
                'id':   CANID.CMD_CELL_BALANCE,
                'data': [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
                'desc': "셀 밸런싱 ON"
            })

        # MOSFET 긴급 차단
        if cmd.mosfet_cut:
            frames.append({
                'id':   CANID.CMD_MOSFET_CUT,
                'data': [0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF],
                'desc': "⚠️ MOSFET 긴급 차단!"
            })

        # 상위 시스템 알림
        if cmd.alert_level in ('warn', 'critical'):
            level_byte = 0xFF if cmd.alert_level == 'critical' else 0x80
            soc_byte   = int(raw.soc_pct)
            temp_byte  = int(raw.temp_max + 40)   # offset 40 to avoid negative
            frames.append({
                'id':   CANID.CMD_ALERT_NOTIFY,
                'data': [level_byte, soc_byte, temp_byte, 0x00, 0xFF, 0xFF, 0xFF, 0xFF],
                'desc': f"알림 플래그: {cmd.alert_level}"
            })

        return frames


# ══════════════════════════════════════════════════════════════════════════════
# Cloud Notification (MQTT / HTTP)
# ══════════════════════════════════════════════════════════════════════════════
class CloudNotifier:
    """제조사 클라우드 서버로 위험 알림 및 데이터 동기화"""

    def __init__(self, mqtt_host: str = 'mqtt.exko.kr', mqtt_port: int = 1883,
                 rest_url: str = 'https://smart.exko.kr/api/battery-alert',
                 device_id: str = 'BEI-001'):
        self.mqtt_host  = mqtt_host
        self.mqtt_port  = mqtt_port
        self.rest_url   = rest_url
        self.device_id  = device_id
        self._mqtt      = None
        self._connected = False
        self._last_alert_ts = 0.0

        if MQTT_AVAILABLE:
            self._init_mqtt()

    def _init_mqtt(self):
        try:
            self._mqtt = mqtt.Client(client_id=f"bei-{self.device_id}")
            self._mqtt.on_connect    = self._on_connect
            self._mqtt.on_disconnect = self._on_disconnect
            self._mqtt.connect_async(self.mqtt_host, self.mqtt_port, keepalive=60)
            self._mqtt.loop_start()
        except Exception as e:
            log.warning(f"MQTT 초기화 실패 (계속 진행): {e}")

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected = True
            log.info(f"MQTT 연결 성공: {self.mqtt_host}:{self.mqtt_port}")
        else:
            log.warning(f"MQTT 연결 실패 (rc={rc})")

    def _on_disconnect(self, client, userdata, rc):
        self._connected = False

    def send_alert(self, infer: OntologyInference, raw: SensorReading, cmd: MCPCommand):
        """위험 알림 전송 (쿨다운: 30초)"""
        now = time.time()
        if now - self._last_alert_ts < 30.0:
            return
        self._last_alert_ts = now

        payload = {
            'device_id':   self.device_id,
            'timestamp':   datetime.now(timezone.utc).isoformat(),
            'risk_score':  infer.risk_score,
            'risk_level':  infer.risk_level.value,
            'situation':   infer.situation,
            'events':      [e.value for e in infer.events],
            'mcp_action':  cmd.action.value,
            'reason':      cmd.reason,
            'sensors': {
                'temp_max':    round(raw.temp_max, 1),
                'delta_v_mv':  round(raw.delta_v, 1),
                'current_a':   round(raw.current_a, 2),
                'soc_pct':     round(raw.soc_pct, 1),
                'imp_mohm':    round(raw.impedance_mohm, 1),
            }
        }

        json_str = json.dumps(payload, ensure_ascii=False)

        # MQTT 전송
        if self._connected and self._mqtt:
            topic = f"bei/{self.device_id}/alert"
            self._mqtt.publish(topic, json_str, qos=1)
            log.info(f"MQTT 알림 전송 → {topic}")

        # HTTP REST 백업
        if HTTP_AVAILABLE:
            try:
                resp = requests.post(
                    self.rest_url,
                    data=json_str,
                    headers={'Content-Type': 'application/json'},
                    timeout=5
                )
                log.info(f"HTTP 알림 전송 → {self.rest_url} [{resp.status_code}]")
            except Exception as e:
                log.warning(f"HTTP 전송 실패: {e}")

    def send_telemetry(self, raw: SensorReading, infer: OntologyInference):
        """주기적 원격 측정 데이터 전송 (1분마다)"""
        if not (self._connected and self._mqtt):
            return
        payload = {
            'device_id': self.device_id,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'soc':  round(raw.soc_pct, 1),
            'soh':  round(raw.soh_pct, 1),
            'temp': round(raw.temp_max, 1),
            'risk': infer.risk_score,
            'rul':  infer.rul_cycles,
        }
        topic = f"bei/{self.device_id}/telemetry"
        self._mqtt.publish(topic, json.dumps(payload), qos=0)


# ══════════════════════════════════════════════════════════════════════════════
# BEI Agent — Main Orchestrator
# ══════════════════════════════════════════════════════════════════════════════
class BEIAgent:
    """
    BEI 자율 제어 에이전트 — 메인 오케스트레이터

    실행 루프 (100ms 주기):
      1. 센서 수집 (CAN / SMBus)
      2. 신호 처리 (Kalman 필터)
      3. Ontology 추론 (5단계)
      4. MCP 명령 결정 (Agentic AI)
      5. CAN 명령 전송 (충전기/팬/MOSFET)
      6. 클라우드 알림 (MQTT/HTTP)
      7. 로그 출력
    """

    VERSION = "1.0.0"
    LOOP_INTERVAL_S = 0.1  # 100ms

    def __init__(self, args):
        self.args      = args
        self.hw        = HardwareInterface(
            interface  = args.interface,
            baudrate   = args.baudrate,
            simulate   = args.simulate,
        )
        self.signal    = SignalProcessor()
        self.ontology  = OntologyEngine()
        self.agent     = AgenticController(current_limit_a=args.max_current)
        self.cloud     = CloudNotifier(
            device_id  = args.device_id,
            rest_url   = args.cloud_url,
        )
        self._running  = False
        self._tick     = 0
        self._start_ts = time.time()
        self._last_tele_ts = 0.0
        self._prev_risk_level = RiskLevel.OK

    def start(self):
        self._running = True
        log.info("═" * 70)
        log.info(f"  BEI Agent v{self.VERSION}  |  디바이스: {self.args.device_id}")
        log.info(f"  모드: {'시뮬레이션' if self.args.simulate else '실제 하드웨어'}")
        log.info(f"  인터페이스: {self.args.interface} @ {self.args.baudrate} bps")
        log.info("═" * 70)

        try:
            asyncio.run(self._main_loop())
        except KeyboardInterrupt:
            log.info("\n사용자 중단 (Ctrl+C)")
        finally:
            self.hw.close()
            log.info("BEI Agent 종료")

    async def _main_loop(self):
        """메인 비동기 루프 (100ms 주기)"""
        while self._running:
            t0 = time.perf_counter()

            try:
                await self._tick_once()
            except Exception as e:
                log.error(f"틱 오류: {e}", exc_info=True)

            # 100ms 주기 유지
            elapsed = time.perf_counter() - t0
            sleep_t = max(0.0, self.LOOP_INTERVAL_S - elapsed)
            await asyncio.sleep(sleep_t)

    async def _tick_once(self):
        self._tick += 1
        now = time.time()

        # ── Layer 1: 센서 수집 ────────────────────────────────────────────────
        raw  = self.hw.read_sensors()

        # ── Layer 2: 신호 처리 ────────────────────────────────────────────────
        sig  = self.signal.process(raw)

        # ── Layer 3: Ontology 추론 ────────────────────────────────────────────
        infer = self.ontology.infer(raw, sig)

        # ── Layer 4: MCP 명령 결정 ────────────────────────────────────────────
        cmd  = self.agent.decide(infer, raw)

        # ── Layer 5: CAN 명령 전송 ────────────────────────────────────────────
        if cmd.action != MCPAction.NONE:
            for frame in cmd.can_frames:
                self.hw.send_can_command(frame['id'], frame['data'])
                await asyncio.sleep(0.002)  # 2ms gap between frames

        # ── 클라우드 알림 ─────────────────────────────────────────────────────
        if infer.risk_level in (RiskLevel.DANGER, RiskLevel.CRITICAL):
            self.cloud.send_alert(infer, raw, cmd)

        # 1분마다 원격 측정
        if now - self._last_tele_ts >= 60.0:
            self.cloud.send_telemetry(raw, infer)
            self._last_tele_ts = now

        # ── 로그 출력 (1초마다) ───────────────────────────────────────────────
        if self._tick % 10 == 0:
            self._log_status(raw, sig, infer, cmd)

        # 위험 수준 변경 시 즉시 로그
        if infer.risk_level != self._prev_risk_level:
            log.warning(f"위험 수준 변경: {self._prev_risk_level.value} → {infer.risk_level.value}")
            log.warning(f"상황: {infer.situation}")
            log.warning(f"MCP 명령: {cmd.reason}")
            self._prev_risk_level = infer.risk_level

    def _log_status(self, raw: SensorReading, sig: ProcessedSignal,
                    infer: OntologyInference, cmd: MCPCommand):
        uptime = int(time.time() - self._start_ts)
        h, m   = divmod(uptime, 3600)
        m, s   = divmod(m, 60)

        risk_icon = {'ok':'🟢', 'warn':'🟡', 'danger':'🔴', 'critical':'🚨'}.get(infer.risk_level.value,'?')
        log.info(
            f"{risk_icon} [{h:02d}:{m:02d}:{s:02d}] "
            f"위험:{infer.risk_score:5.1f}/100 | "
            f"T:{raw.temp_max:5.1f}°C dT:{sig.dt_dt:+5.2f}°C/m | "
            f"ΔV:{sig.cell_imbalance:5.1f}mV | "
            f"Imp:{raw.impedance_mohm:5.1f}mΩ | "
            f"I:{raw.current_a:+5.2f}A | "
            f"SOC:{raw.soc_pct:4.0f}% | "
            f"MCP:{cmd.action.value}"
        )
        if infer.minutes_to_risk:
            log.warning(f"  ⏱  {infer.minutes_to_risk}분 후 위험 온도 도달 예측")


# ══════════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ══════════════════════════════════════════════════════════════════════════════
def parse_args():
    p = argparse.ArgumentParser(
        description='BEI Agent — IMC 배터리 엣지 인텔리전스 자율 제어 에이전트',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  # 시뮬레이션 모드 (하드웨어 없이 테스트):
  python3 bei_agent.py --simulate

  # 실제 CAN 인터페이스:
  sudo python3 bei_agent.py --interface can0 --baudrate 500000

  # 시뮬레이션 + 특정 시나리오:
  python3 bei_agent.py --simulate --scenario thermal

  # 커스텀 클라우드 URL:
  sudo python3 bei_agent.py --interface can0 --cloud-url https://yourserver.com/api/alert

하드웨어 설정 (Raspberry Pi CM4):
  # CAN 인터페이스 활성화:
  sudo ip link set can0 up type can bitrate 500000
  sudo ifconfig can0 up

  # SMBus (I²C) 활성화 (/boot/config.txt):
  dtparam=i2c_arm=on
"""
    )
    p.add_argument('--interface',   default='can0',
                   help='CAN 인터페이스 이름 (기본: can0)')
    p.add_argument('--baudrate',    type=int, default=500000,
                   help='CAN 보드레이트 (기본: 500000)')
    p.add_argument('--simulate',    action='store_true',
                   help='시뮬레이션 모드 (실제 하드웨어 없이 실행)')
    p.add_argument('--scenario',    default='normal',
                   choices=['normal','heat','thermal','deep','fastcharge'],
                   help='시뮬레이션 시나리오 (기본: normal)')
    p.add_argument('--device-id',   default='BEI-001',
                   help='디바이스 ID (기본: BEI-001)')
    p.add_argument('--max-current', type=float, default=5.0,
                   help='최대 허용 충전 전류 A (기본: 5.0)')
    p.add_argument('--cloud-url',   default='https://smart.exko.kr/api/battery-alert',
                   help='클라우드 알림 REST URL')
    p.add_argument('--verbose',     action='store_true',
                   help='상세 로그 출력')
    return p.parse_args()


def main():
    args = parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    agent = BEIAgent(args)

    # 시뮬레이션 초기 시나리오 설정
    if args.simulate and args.scenario != 'normal':
        agent.hw.set_scenario(args.scenario)

    agent.start()


if __name__ == '__main__':
    main()
