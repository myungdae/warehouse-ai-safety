#!/usr/bin/env python3
"""
agent_orchestrator.py
══════════════════════════════════════════════════════════════════
Warehouse Agentic AI Orchestrator — 완전 자동화 재고 파이프라인

흐름:
  스케줄러 트리거
    → [MCP] drone_control   : 드론 이륙 + 영상 촬영 + 착륙
    → [MCP] video_scan      : 영상 분석 → PT번호 추출 → DB 저장
    → [MCP] erp_compare     : 스캔 결과 vs ERP 비교
    → [MCP] report_gen      : 보고서 자동 생성 + 아카이브
    → [MCP] alert_send      : 불일치 경보 (이메일 + 프린터)
    → [MCP] erp_sync        : ERP 자동 수정 (임계값 초과 시)

사람 개입: 0  ── 전 과정 Agentic AI가 오케스트레이션
══════════════════════════════════════════════════════════════════
"""

import os
import json
import time
import uuid
import threading
import sqlite3
import subprocess
from datetime import datetime
from typing import Optional

# ── DB 경로 (app.py 와 동일) ───────────────────────────────────
_BASE_DIR        = os.path.dirname(__file__)
_DATA_DIR        = os.path.join(_BASE_DIR, 'backend', 'data')
_DB_FILE         = os.path.join(_DATA_DIR, 'reports.db')
_AGENT_LOG_FILE  = os.path.join(_DATA_DIR, 'agent_mission_log.json')
_AGENT_CFG_FILE  = os.path.join(_DATA_DIR, 'agent_config.json')
_UPLOAD_DIR      = os.path.join(_BASE_DIR, 'backend', 'uploads')

os.makedirs(_DATA_DIR,   exist_ok=True)
os.makedirs(_UPLOAD_DIR, exist_ok=True)

# ── Agent 기본 설정 ────────────────────────────────────────────
_DEFAULT_AGENT_CONFIG = {
    # 스케줄
    "auto_mission_enabled":  True,
    "mission_cron":          "02:00",      # 매일 새벽 2시 자동 시작
    "mission_interval_days": 1,            # 매일 실행

    # 드론
    "drone_host":            "192.168.10.50",  # 드론 컨트롤러 IP
    "drone_port":            8765,
    "flight_speed_ms":       1.5,          # m/s — 바코드 인식 최적
    "flight_levels_per_pass":4,            # 1 Pass당 커버 단수
    "warehouse_aisles":      15,
    "warehouse_racks":       20,
    "warehouse_levels":      15,

    # 분석
    "fps_sample":            5,            # 초당 프레임 샘플링
    "pt_confidence_min":     2,            # 최소 인식 횟수 (신뢰도)

    # 판단 임계값
    "rescan_threshold_pct":  95.0,         # 추출률 95% 미만 → 재촬영
    "erp_mismatch_alert_pct":5.0,          # 불일치 5% 이상 → 경보
    "erp_auto_sync_pct":     2.0,          # 불일치 2% 이하 → ERP 자동수정

    # 알림
    "alert_email":           "",
    "printer_ip":            "192.168.1.100",
    "printer_port":          9100,
}


# ══════════════════════════════════════════════════════════════
# 미션 로그 (SQLite + JSON)
# ══════════════════════════════════════════════════════════════

def _get_db():
    os.makedirs(_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def _init_agent_tables():
    with _get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS agent_missions (
                id           TEXT PRIMARY KEY,
                started_at   TEXT NOT NULL,
                finished_at  TEXT,
                status       TEXT DEFAULT 'running',
                trigger      TEXT DEFAULT 'scheduler',
                session_id   TEXT,
                steps        TEXT,          -- JSON array of step results
                summary      TEXT,          -- JSON summary
                error        TEXT
            )
        ''')
        conn.commit()

_init_agent_tables()


def _load_agent_config() -> dict:
    if os.path.exists(_AGENT_CFG_FILE):
        try:
            with open(_AGENT_CFG_FILE) as f:
                cfg = json.load(f)
            for k, v in _DEFAULT_AGENT_CONFIG.items():
                cfg.setdefault(k, v)
            return cfg
        except Exception:
            pass
    return dict(_DEFAULT_AGENT_CONFIG)


def _save_agent_config(cfg: dict):
    with open(_AGENT_CFG_FILE, 'w') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _log_step(mission_id: str, step: dict):
    """미션 진행 중 단계별 실시간 로그 업데이트"""
    with _get_db() as conn:
        row = conn.execute(
            'SELECT steps FROM agent_missions WHERE id=?', (mission_id,)
        ).fetchone()
        if row:
            steps = json.loads(row['steps'] or '[]')
            steps.append({**step, 'ts': datetime.now().isoformat()})
            conn.execute(
                'UPDATE agent_missions SET steps=? WHERE id=?',
                (json.dumps(steps, ensure_ascii=False), mission_id)
            )
            conn.commit()
    print(f"[Agent:{mission_id[:8]}] [{step.get('tool','?')}] {step.get('message','')}")


def _finish_mission(mission_id: str, status: str, summary: dict, error: str = None):
    with _get_db() as conn:
        conn.execute('''
            UPDATE agent_missions
            SET status=?, finished_at=?, summary=?, error=?
            WHERE id=?
        ''', (
            status,
            datetime.now().isoformat(),
            json.dumps(summary, ensure_ascii=False),
            error,
            mission_id
        ))
        conn.commit()


# ══════════════════════════════════════════════════════════════
# MCP TOOLS — 각 도구는 독립 함수, Agent가 순서대로 호출
# ══════════════════════════════════════════════════════════════

class MCPTools:
    """
    6개 MCP Tool 구현
    각 tool은 dict 반환: {'ok': bool, 'data': ..., 'message': str}
    """

    # ── Tool 1: drone_control ──────────────────────────────────
    @staticmethod
    def drone_control(mission_id: str, cfg: dict) -> dict:
        """
        드론 이륙 → S자 경로 비행 → 영상 녹화 → 착륙 → 영상 전송
        실제 환경: DJI SDK / MAVLink / 드론 컨트롤러 API 호출
        현재: 시뮬레이션 (실제 드론 SDK 연결 포인트 표시)
        """
        aisles  = cfg.get('warehouse_aisles', 15)
        racks   = cfg.get('warehouse_racks', 20)
        levels  = cfg.get('warehouse_levels', 15)
        speed   = cfg.get('flight_speed_ms', 1.5)
        lpp     = cfg.get('flight_levels_per_pass', 4)

        # 비행 경로 계산
        passes       = -(-levels // lpp)        # ceiling division
        aisle_len_m  = racks * 1.2              # rack 1.2m
        total_dist_m = aisle_len_m * aisles * passes + (aisles - 1) * 4 * passes
        flight_sec   = total_dist_m / speed

        _log_step(mission_id, {
            'tool': 'drone_control',
            'status': 'planning',
            'message': (f"비행 계획: {aisles}통로 × {passes} Pass "
                        f"= 총 {total_dist_m:.0f}m / 예상 {flight_sec/60:.1f}분"),
            'detail': {
                'aisles': aisles, 'racks': racks, 'levels': levels,
                'passes': passes, 'total_dist_m': round(total_dist_m),
                'estimated_flight_min': round(flight_sec / 60, 1)
            }
        })

        # ── 실제 드론 SDK 연결 포인트 ──────────────────────────
        # TODO: 실제 환경에서 아래 주석을 해제하고 드론 IP/SDK 설정
        #
        # import requests
        # drone_url = f"http://{cfg['drone_host']}:{cfg['drone_port']}"
        #
        # # 이륙
        # requests.post(f"{drone_url}/takeoff", json={'altitude': 1.5})
        #
        # # 경로 업로드 및 실행
        # waypoints = _build_waypoints(aisles, racks, passes, lpp)
        # requests.post(f"{drone_url}/mission/upload", json={'waypoints': waypoints})
        # requests.post(f"{drone_url}/mission/start", json={'speed': speed, 'record': True})
        #
        # # 완료 대기
        # while True:
        #     status = requests.get(f"{drone_url}/status").json()
        #     if status['state'] == 'landed': break
        #     time.sleep(5)
        #
        # # 영상 파일 경로 수신
        # video_info = requests.get(f"{drone_url}/last_recording").json()
        # video_path = video_info['local_path']  # 또는 Wi-Fi 전송 후 로컬 경로

        # 시뮬레이션: 비행 시간 대기 (실제 환경에서는 위 SDK 코드로 대체)
        sim_wait = min(flight_sec * 0.01, 3)   # 시뮬레이션은 최대 3초
        time.sleep(sim_wait)

        # 영상 파일 경로 (실제: 드론 Wi-Fi 전송 후 로컬 경로)
        # 시뮬레이션: 기존 업로드 파일이 있으면 사용, 없으면 None
        video_path = None
        uploads = sorted(
            [f for f in os.listdir(_UPLOAD_DIR) if f.endswith(('.mp4','.avi','.mov','.mkv'))],
            key=lambda x: os.path.getmtime(os.path.join(_UPLOAD_DIR, x)),
            reverse=True
        )
        if uploads:
            video_path = os.path.join(_UPLOAD_DIR, uploads[0])

        _log_step(mission_id, {
            'tool': 'drone_control',
            'status': 'completed',
            'message': (f"✅ 비행 완료 — {total_dist_m:.0f}m 비행, "
                        f"영상: {os.path.basename(video_path) if video_path else '시뮬레이션 모드'}"),
            'video_path': video_path,
        })

        return {
            'ok': True,
            'video_path': video_path,
            'flight_dist_m': round(total_dist_m),
            'flight_min': round(flight_sec / 60, 1),
            'passes': passes,
            'sim_mode': video_path is None,
            'message': f"비행 완료 ({total_dist_m:.0f}m)"
        }

    # ── Tool 2: video_scan ─────────────────────────────────────
    @staticmethod
    def video_scan(mission_id: str, cfg: dict,
                   video_path: Optional[str], session_id: str,
                   sim_mode: bool = False) -> dict:
        """
        영상 → 프레임 샘플링 → 바코드/OCR → PT번호 추출 → DB 저장
        sim_mode=True 이면 Mock PT 데이터로 대체
        """
        import re as _re

        PT_PATTERN = _re.compile(r'\bPT\d{8}\b')
        fps_sample = cfg.get('fps_sample', 5)
        pt_min_cnt = cfg.get('pt_confidence_min', 2)

        _log_step(mission_id, {
            'tool': 'video_scan',
            'status': 'analyzing',
            'message': f"영상 분석 시작 ({fps_sample}fps 샘플링)...",
        })

        pt_map = {}
        method = 'none'

        if sim_mode or not video_path or not os.path.exists(video_path):
            # ── 시뮬레이션 모드: Mock PT 데이터 ───────────────
            import random
            WAFER_PT_LIST = [
                'PT64090302','PT64090303','PT64090304','PT64090305',
                'PT64090306','PT64090307','PT64090308','PT64090309',
                'PT64090310','PT64090311',
            ]
            aisles  = cfg.get('warehouse_aisles', 15)
            racks   = cfg.get('warehouse_racks', 20)
            total   = aisles * racks
            # 85% 위치에 PT 존재 (ERP Mock과 동일 비율)
            for i in range(total):
                if random.random() > 0.15:
                    pt = WAFER_PT_LIST[i % len(WAFER_PT_LIST)]
                    if pt not in pt_map:
                        pt_map[pt] = {'count': 0, 'first_seen_sec': round(i * 0.2, 1), 'frames': []}
                    pt_map[pt]['count'] += random.randint(2, 8)
            method = 'simulation'
        else:
            # ── 실제 영상 분석 ─────────────────────────────────
            try:
                import cv2 as _cv2
                try:
                    from pyzbar.pyzbar import decode as _pyz_decode
                    _pyzbar_ok = True
                except ImportError:
                    _pyzbar_ok = False

                cap = _cv2.VideoCapture(video_path)
                video_fps = cap.get(_cv2.CAP_PROP_FPS) or 30
                step = max(1, int(video_fps / fps_sample))
                frame_idx = 0

                while frame_idx < 30000:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    if frame_idx % step == 0:
                        gray = _cv2.cvtColor(frame, _cv2.COLOR_BGR2GRAY)
                        t_sec = round(frame_idx / video_fps, 2)

                        if _pyzbar_ok:
                            clahe = _cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                            enhanced = clahe.apply(gray)
                            for obj in _pyz_decode(enhanced):
                                raw = obj.data.decode('utf-8', errors='ignore')
                                for m in PT_PATTERN.findall(raw):
                                    if m not in pt_map:
                                        pt_map[m] = {'count': 0, 'first_seen_sec': t_sec, 'frames': []}
                                    pt_map[m]['count'] += 1
                    frame_idx += 1
                cap.release()
                method = 'cv2+pyzbar'
            except ImportError:
                # FFmpeg fallback
                method = 'ffmpeg_fallback'
                _log_step(mission_id, {
                    'tool': 'video_scan',
                    'status': 'warning',
                    'message': 'OpenCV 없음 — FFmpeg 프레임 추출로 전환',
                })
                import tempfile, shutil
                tmp = tempfile.mkdtemp()
                try:
                    subprocess.run([
                        'ffmpeg', '-i', video_path,
                        '-vf', f'fps={fps_sample},scale=1280:-1',
                        '-frames:v', '3000', '-q:v', '3',
                        os.path.join(tmp, 'f_%05d.jpg'),
                        '-y', '-loglevel', 'error'
                    ], timeout=300, check=False)
                    try:
                        from pyzbar.pyzbar import decode as pz_d
                        from PIL import Image
                        for i, fn in enumerate(sorted(os.listdir(tmp))):
                            img = Image.open(os.path.join(tmp, fn)).convert('L')
                            for obj in pz_d(img):
                                raw = obj.data.decode('utf-8', errors='ignore')
                                for m in PT_PATTERN.findall(raw):
                                    if m not in pt_map:
                                        pt_map[m] = {'count': 0, 'first_seen_sec': round(i/fps_sample,1), 'frames': []}
                                    pt_map[m]['count'] += 1
                    except Exception:
                        pass
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)

        # 신뢰도 필터링 (최소 인식 횟수)
        pt_map = {pt: v for pt, v in pt_map.items() if v['count'] >= pt_min_cnt}

        # DB 저장
        now = datetime.now().isoformat()
        rows = []
        for pt, info in pt_map.items():
            eid = f"AG-{uuid.uuid4().hex[:12].upper()}"
            rows.append((
                eid, now, session_id, 'AGENT-DRONE',
                'AUTO', 0, 'A', 'A',
                f"AG-{pt}", pt,
                info['count'],
                f"Agent-Scan / {pt} @{info['first_seen_sec']}s"
            ))

        if rows:
            with _get_db() as conn:
                conn.executemany('''
                    INSERT OR REPLACE INTO scan_events
                    (id, scanned_at, session_id, drone_id, aisle, rack, side, layer,
                     shelf_id, pt_number, qty, location)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ''', rows)
                conn.commit()

        total_found = len(pt_map)
        _log_step(mission_id, {
            'tool': 'video_scan',
            'status': 'completed',
            'message': f"✅ PT번호 {total_found}종 추출 완료 (방식: {method})",
            'pt_list': list(pt_map.keys()),
            'saved': len(rows),
        })

        return {
            'ok': True,
            'session_id': session_id,
            'total_pt_found': total_found,
            'pt_list': list(pt_map.keys()),
            'method': method,
            'saved': len(rows),
            'message': f"PT {total_found}종 추출"
        }

    # ── Tool 3: erp_compare ───────────────────────────────────
    @staticmethod
    def erp_compare(mission_id: str, cfg: dict, session_id: str) -> dict:
        """
        scan_events(session) vs erp_inventory 비교
        → 불일치 분류: missing / extra / qty_diff / moved
        """
        _log_step(mission_id, {
            'tool': 'erp_compare',
            'status': 'comparing',
            'message': f"ERP 비교 시작 (세션: {session_id})",
        })

        with _get_db() as conn:
            # 이번 세션 스캔 결과
            scan_rows = conn.execute(
                "SELECT pt_number, SUM(qty) as qty FROM scan_events "
                "WHERE session_id=? AND pt_number IS NOT NULL GROUP BY pt_number",
                (session_id,)
            ).fetchall()

            # ERP 재고
            erp_rows = conn.execute(
                "SELECT pt_number, SUM(qty) as qty FROM erp_inventory "
                "WHERE pt_number IS NOT NULL GROUP BY pt_number"
            ).fetchall()

        scan_dict = {r['pt_number']: r['qty'] for r in scan_rows}
        erp_dict  = {r['pt_number']: r['qty']  for r in erp_rows}

        all_pts = set(scan_dict) | set(erp_dict)
        mismatches = []

        for pt in all_pts:
            s_qty = scan_dict.get(pt, 0)
            e_qty = erp_dict.get(pt, 0)
            if pt not in scan_dict:
                mismatches.append({'pt': pt, 'type': 'missing_in_scan',
                                   'scan_qty': 0, 'erp_qty': e_qty})
            elif pt not in erp_dict:
                mismatches.append({'pt': pt, 'type': 'extra_in_scan',
                                   'scan_qty': s_qty, 'erp_qty': 0})
            elif abs(s_qty - e_qty) > 2:           # 수량 차이 허용 오차 2
                mismatches.append({'pt': pt, 'type': 'qty_mismatch',
                                   'scan_qty': s_qty, 'erp_qty': e_qty,
                                   'diff': s_qty - e_qty})

        total      = len(all_pts)
        match_cnt  = total - len(mismatches)
        accuracy   = round(match_cnt / total * 100, 2) if total > 0 else 100.0

        # 비교 결과 DB 저장
        cmp_id = f"CMP-{uuid.uuid4().hex[:10].upper()}"
        now    = datetime.now().isoformat()
        with _get_db() as conn:
            conn.execute('''
                INSERT INTO erp_compare_results
                (id, session_id, compared_at, total_scanned, match_count,
                 mismatch_count, missing_in_scan, missing_in_erp, accuracy_rate, payload)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            ''', (
                cmp_id, session_id, now,
                len(scan_dict), match_cnt, len(mismatches),
                sum(1 for m in mismatches if m['type'] == 'missing_in_scan'),
                sum(1 for m in mismatches if m['type'] == 'extra_in_scan'),
                accuracy,
                json.dumps(mismatches, ensure_ascii=False)
            ))
            conn.commit()

        _log_step(mission_id, {
            'tool': 'erp_compare',
            'status': 'completed',
            'message': (f"✅ ERP 비교 완료 — 정확도 {accuracy}% "
                        f"(불일치 {len(mismatches)}건 / 전체 {total}종)"),
            'accuracy': accuracy,
            'mismatch_count': len(mismatches),
            'compare_id': cmp_id,
        })

        return {
            'ok': True,
            'compare_id': cmp_id,
            'total_pt': total,
            'match_count': match_cnt,
            'mismatch_count': len(mismatches),
            'mismatches': mismatches,
            'accuracy': accuracy,
            'message': f"정확도 {accuracy}% (불일치 {len(mismatches)}건)"
        }

    # ── Tool 4: report_gen ────────────────────────────────────
    @staticmethod
    def report_gen(mission_id: str, cfg: dict,
                   session_id: str, compare_result: dict) -> dict:
        """
        비교 결과 → 일일 보고서 자동 생성 → reports DB 아카이브
        """
        now     = datetime.now()
        rpt_id  = f"RPT-{now.strftime('%Y%m%d')}-AGENT"
        mismatches = compare_result.get('mismatches', [])

        report_data = {
            'report_id':      rpt_id,
            'date':           now.strftime('%Y-%m-%d'),
            'time':           now.strftime('%H:%M:%S'),
            'drone_id':       'AGENT-DRONE',
            'warehouse':      'Warehouse-A',
            'session_id':     session_id,
            'total_scanned':  compare_result.get('total_pt', 0),
            'accuracy':       compare_result.get('accuracy', 0),
            'total_changes':  compare_result.get('mismatch_count', 0),
            'agent_actions':  1,
            'missing':        sum(1 for m in mismatches if m['type'] == 'missing_in_scan'),
            'new_items':      sum(1 for m in mismatches if m['type'] == 'extra_in_scan'),
            'changed':        sum(1 for m in mismatches if m['type'] == 'qty_mismatch'),
            'moved':          0,
            'agent_decisions': [
                f"[자동분석] {m['type']}: PT {m['pt']} "
                f"(스캔 {m.get('scan_qty',0)} / ERP {m.get('erp_qty',0)})"
                for m in mismatches[:10]
            ],
            'mismatches':     mismatches,
            'trigger':        'agent_auto',
        }

        # reports 테이블에 저장
        with _get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO reports
                (id, saved_at, date_label, time_label, drone_id, warehouse,
                 total_scanned, accuracy, total_changes, agent_actions,
                 missing, new_items, changed, moved, payload, note)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                rpt_id,
                now.isoformat(),
                report_data['date'],
                report_data['time'],
                report_data['drone_id'],
                report_data['warehouse'],
                report_data['total_scanned'],
                report_data['accuracy'],
                report_data['total_changes'],
                report_data['agent_actions'],
                report_data['missing'],
                report_data['new_items'],
                report_data['changed'],
                report_data['moved'],
                json.dumps(report_data, ensure_ascii=False),
                f"Agentic AI 자동 생성 — 미션 {mission_id[:8]}"
            ))
            conn.commit()

        _log_step(mission_id, {
            'tool': 'report_gen',
            'status': 'completed',
            'message': f"✅ 보고서 생성 완료 ({rpt_id})",
            'report_id': rpt_id,
        })

        return {
            'ok': True,
            'report_id': rpt_id,
            'report_data': report_data,
            'message': f"보고서 생성: {rpt_id}"
        }

    # ── Tool 5: alert_send ────────────────────────────────────
    @staticmethod
    def alert_send(mission_id: str, cfg: dict,
                   report_data: dict, compare_result: dict) -> dict:
        """
        불일치 경보 — 이메일 + 프린터 자동 출력
        mismatch_pct >= erp_mismatch_alert_pct 일 때만 경보
        """
        accuracy    = compare_result.get('accuracy', 100.0)
        mismatch_pct = 100 - accuracy
        threshold   = cfg.get('erp_mismatch_alert_pct', 5.0)

        if mismatch_pct < threshold:
            _log_step(mission_id, {
                'tool': 'alert_send',
                'status': 'skipped',
                'message': (f"⏭ 경보 생략 — 불일치 {mismatch_pct:.1f}% "
                            f"< 임계값 {threshold}%"),
            })
            return {'ok': True, 'skipped': True, 'reason': '임계값 미만'}

        sent = []

        # 이메일 경보
        alert_email = cfg.get('alert_email', '')
        if alert_email:
            try:
                import smtplib
                from email.mime.text import MIMEText
                mismatches = compare_result.get('mismatches', [])
                body = (
                    f"[Warehouse AI] 재고 불일치 경보\n\n"
                    f"일시: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
                    f"정확도: {accuracy}%\n"
                    f"불일치: {compare_result.get('mismatch_count',0)}건\n\n"
                    f"상위 불일치 목록:\n"
                    + '\n'.join(
                        f"  - PT {m['pt']}: {m['type']} "
                        f"(스캔 {m.get('scan_qty',0)} / ERP {m.get('erp_qty',0)})"
                        for m in mismatches[:10]
                    )
                )
                msg = MIMEText(body, 'plain', 'utf-8')
                msg['Subject'] = f"[긴급] 창고 재고 불일치 {mismatch_pct:.1f}% — {datetime.now().strftime('%Y-%m-%d')}"
                msg['From'] = 'warehouse-ai@exko.kr'
                msg['To']   = alert_email
                with smtplib.SMTP('localhost', timeout=5) as s:
                    s.sendmail('warehouse-ai@exko.kr', [alert_email], msg.as_string())
                sent.append('email')
            except Exception as e:
                _log_step(mission_id, {
                    'tool': 'alert_send',
                    'status': 'warning',
                    'message': f"이메일 전송 실패 (SMTP): {e}",
                })

        # 프린터 경보 출력
        printer_ip = cfg.get('printer_ip', '')
        printer_port = int(cfg.get('printer_port', 9100))
        if printer_ip:
            try:
                import socket
                lines = [
                    "\x1B\x45\x01",   # ESC E 1 = bold on
                    f"[WAREHOUSE AI ALERT]\n",
                    "\x1B\x45\x00",   # bold off
                    f"Time    : {datetime.now().strftime('%Y-%m-%d %H:%M')}\n",
                    f"Accuracy: {accuracy}%\n",
                    f"Mismatch: {compare_result.get('mismatch_count',0)} items\n",
                    "-" * 40 + "\n",
                ]
                for m in compare_result.get('mismatches', [])[:5]:
                    lines.append(f"  {m['pt']}: {m['type']}\n")
                lines.append("\n\n\n")
                payload = ''.join(lines).encode('ascii', errors='replace')
                with socket.create_connection((printer_ip, printer_port), timeout=5) as s:
                    s.sendall(payload)
                sent.append('printer')
            except Exception as e:
                _log_step(mission_id, {
                    'tool': 'alert_send',
                    'status': 'warning',
                    'message': f"프린터 출력 실패: {e}",
                })

        _log_step(mission_id, {
            'tool': 'alert_send',
            'status': 'completed',
            'message': (f"✅ 경보 발송 완료 "
                        f"(불일치 {mismatch_pct:.1f}%, 방법: {', '.join(sent) or '없음'})"),
        })

        return {
            'ok': True,
            'mismatch_pct': mismatch_pct,
            'sent': sent,
            'message': f"경보 발송: {', '.join(sent) or '없음'}"
        }

    # ── Tool 6: erp_sync ──────────────────────────────────────
    @staticmethod
    def erp_sync(mission_id: str, cfg: dict, compare_result: dict) -> dict:
        """
        ERP 자동 수정
        - 불일치 <= erp_auto_sync_pct: 자동으로 ERP 업데이트
        - 불일치 >  erp_auto_sync_pct: 승인 큐에 등록 (사람 확인 필요)
        삼성 반도체 재고: 수억원 단위 → 임계값 엄격 적용
        """
        accuracy     = compare_result.get('accuracy', 100.0)
        mismatch_pct = 100 - accuracy
        auto_thresh  = cfg.get('erp_auto_sync_pct', 2.0)
        mismatches   = compare_result.get('mismatches', [])

        if not mismatches:
            _log_step(mission_id, {
                'tool': 'erp_sync',
                'status': 'skipped',
                'message': "⏭ ERP 동기화 생략 — 불일치 없음 (100% 일치)",
            })
            return {'ok': True, 'skipped': True, 'auto_updated': 0, 'queued': 0}

        auto_updated = 0
        queued       = []

        if mismatch_pct <= auto_thresh:
            # ── 자동 수정 (소규모 불일치) ──────────────────────
            with _get_db() as conn:
                for m in mismatches:
                    if m['type'] == 'qty_mismatch':
                        conn.execute(
                            "UPDATE erp_inventory SET qty=?, last_updated=? WHERE pt_number=?",
                            (m['scan_qty'], datetime.now().isoformat(), m['pt'])
                        )
                        auto_updated += 1
                conn.commit()

            _log_step(mission_id, {
                'tool': 'erp_sync',
                'status': 'completed',
                'message': (f"✅ ERP 자동 수정 완료 — {auto_updated}건 업데이트 "
                            f"(불일치 {mismatch_pct:.1f}% ≤ 임계값 {auto_thresh}%)"),
                'auto_updated': auto_updated,
            })
        else:
            # ── 승인 큐 등록 (대규모 불일치 → 사람 검토 필요) ───
            queue_file = os.path.join(_DATA_DIR, 'erp_sync_queue.json')
            try:
                with open(queue_file) as f:
                    queue = json.load(f)
            except Exception:
                queue = []

            entry = {
                'queued_at':    datetime.now().isoformat(),
                'mission_id':   mission_id,
                'mismatch_pct': mismatch_pct,
                'mismatches':   mismatches,
                'status':       'pending_approval',
                'reason':       f"불일치 {mismatch_pct:.1f}% > 자동수정 임계값 {auto_thresh}% — 담당자 확인 필요"
            }
            queue.insert(0, entry)
            queue = queue[:50]
            with open(queue_file, 'w') as f:
                json.dump(queue, f, ensure_ascii=False, indent=2)
            queued = mismatches

            _log_step(mission_id, {
                'tool': 'erp_sync',
                'status': 'queued',
                'message': (f"⚠️ ERP 동기화 보류 — 불일치 {mismatch_pct:.1f}% "
                            f"> 임계값 {auto_thresh}% → 승인 큐 등록 ({len(mismatches)}건)"),
                'queued_count': len(mismatches),
            })

        return {
            'ok': True,
            'auto_updated': auto_updated,
            'queued': len(queued),
            'mismatch_pct': mismatch_pct,
            'auto_thresh': auto_thresh,
            'message': f"ERP 동기화: 자동수정 {auto_updated}건 / 승인대기 {len(queued)}건"
        }


# ══════════════════════════════════════════════════════════════
# AGENT ORCHESTRATOR — 전체 미션 실행
# ══════════════════════════════════════════════════════════════

class AgentOrchestrator:
    """
    전체 파이프라인 오케스트레이션
    사람 개입 없이 6개 MCP Tool을 순서대로 호출
    각 단계 결과를 보고 다음 행동을 자율 결정
    """

    def __init__(self):
        self.cfg = _load_agent_config()

    def _decide(self, step_result: dict, mission_id: str, context: str) -> str:
        """
        Agent 자율 판단 — 각 단계 결과를 보고 다음 행동 결정
        반환: 'continue' | 'retry' | 'abort' | 'skip'
        """
        if not step_result.get('ok'):
            _log_step(mission_id, {
                'tool': 'agent_brain',
                'status': 'decision',
                'message': f"⚠️ [{context}] 실패 감지 → 계속 진행 (비치명적 오류)",
            })
            return 'continue'   # 비치명적 오류는 계속 진행

        # video_scan: 추출률 체크
        if context == 'video_scan':
            found = step_result.get('total_pt_found', 0)
            aisles = self.cfg.get('warehouse_aisles', 15)
            racks  = self.cfg.get('warehouse_racks', 20)
            expected_min = int(aisles * racks * 0.5)  # 최소 50% 위치
            if found < expected_min:
                _log_step(mission_id, {
                    'tool': 'agent_brain',
                    'status': 'decision',
                    'message': (f"⚠️ PT 추출 부족 ({found}종 < 예상 {expected_min}종) "
                                f"→ 시뮬레이션 모드로 계속 진행"),
                })
            else:
                _log_step(mission_id, {
                    'tool': 'agent_brain',
                    'status': 'decision',
                    'message': f"✅ PT 추출 충분 ({found}종) → 다음 단계 진행",
                })

        # erp_compare: 정확도 체크
        if context == 'erp_compare':
            accuracy = step_result.get('accuracy', 100)
            _log_step(mission_id, {
                'tool': 'agent_brain',
                'status': 'decision',
                'message': (f"📊 ERP 정확도 {accuracy}% → "
                            + ("정상 범위" if accuracy >= 95 else "⚠️ 불일치 다수 발생")),
            })

        return 'continue'

    def run_mission(self, trigger: str = 'scheduler',
                    video_path: Optional[str] = None) -> dict:
        """
        전체 미션 실행 (동기, 별도 스레드에서 호출)
        """
        self.cfg = _load_agent_config()

        # 미션 ID 생성 + DB 등록
        mission_id = f"MIS-{uuid.uuid4().hex[:12].upper()}"
        session_id = f"AG-{uuid.uuid4().hex[:10].upper()}"

        with _get_db() as conn:
            conn.execute('''
                INSERT INTO agent_missions (id, started_at, status, trigger, session_id, steps)
                VALUES (?,?,?,?,?,?)
            ''', (mission_id, datetime.now().isoformat(), 'running', trigger, session_id, '[]'))
            conn.commit()

        _log_step(mission_id, {
            'tool': 'orchestrator',
            'status': 'start',
            'message': (f"🚀 Agentic AI 미션 시작 "
                        f"(트리거: {trigger}, 세션: {session_id})"),
        })

        summary = {}
        try:
            # ── Step 1: 드론 제어 ──────────────────────────────
            r1 = MCPTools.drone_control(mission_id, self.cfg)
            self._decide(r1, mission_id, 'drone_control')
            summary['drone'] = r1
            vid = video_path or r1.get('video_path')
            sim  = r1.get('sim_mode', True) if not video_path else False

            # ── Step 2: 영상 분석 ──────────────────────────────
            r2 = MCPTools.video_scan(mission_id, self.cfg, vid, session_id, sim_mode=sim)
            self._decide(r2, mission_id, 'video_scan')
            summary['video_scan'] = r2

            # ── Step 3: ERP 비교 ───────────────────────────────
            r3 = MCPTools.erp_compare(mission_id, self.cfg, session_id)
            self._decide(r3, mission_id, 'erp_compare')
            summary['erp_compare'] = r3

            # ── Step 4: 보고서 생성 ────────────────────────────
            r4 = MCPTools.report_gen(mission_id, self.cfg, session_id, r3)
            self._decide(r4, mission_id, 'report_gen')
            summary['report'] = r4

            # ── Step 5: 경보 발송 ──────────────────────────────
            r5 = MCPTools.alert_send(mission_id, self.cfg, r4.get('report_data', {}), r3)
            self._decide(r5, mission_id, 'alert_send')
            summary['alert'] = r5

            # ── Step 6: ERP 동기화 ─────────────────────────────
            r6 = MCPTools.erp_sync(mission_id, self.cfg, r3)
            self._decide(r6, mission_id, 'erp_sync')
            summary['erp_sync'] = r6

            # ── 미션 완료 ──────────────────────────────────────
            _log_step(mission_id, {
                'tool': 'orchestrator',
                'status': 'completed',
                'message': (f"🎉 미션 완료 — "
                            f"PT {r2.get('total_pt_found',0)}종 스캔, "
                            f"ERP 정확도 {r3.get('accuracy',0)}%, "
                            f"보고서 {r4.get('report_id','?')} 생성"),
            })

            _finish_mission(mission_id, 'completed', summary)
            return {'ok': True, 'mission_id': mission_id, 'summary': summary}

        except Exception as e:
            import traceback
            err = traceback.format_exc()
            _log_step(mission_id, {
                'tool': 'orchestrator',
                'status': 'error',
                'message': f"❌ 미션 오류: {e}",
            })
            _finish_mission(mission_id, 'failed', summary, error=err)
            return {'ok': False, 'mission_id': mission_id, 'error': str(e)}


# ══════════════════════════════════════════════════════════════
# 싱글턴 오케스트레이터 + 비동기 실행
# ══════════════════════════════════════════════════════════════

_orchestrator = AgentOrchestrator()
_mission_lock = threading.Lock()


def run_mission_async(trigger: str = 'manual',
                      video_path: Optional[str] = None) -> str:
    """
    미션을 백그라운드 스레드에서 실행
    반환: mission_id (즉시 반환, 실행은 비동기)
    """
    mission_id = f"MIS-{uuid.uuid4().hex[:12].upper()}"

    def _run():
        with _mission_lock:
            _orchestrator.run_mission(trigger=trigger, video_path=video_path)

    t = threading.Thread(target=_run, daemon=True, name=f'agent-{mission_id[:8]}')
    t.start()
    return mission_id


def get_mission_list(limit: int = 20) -> list:
    with _get_db() as conn:
        rows = conn.execute('''
            SELECT id, started_at, finished_at, status, trigger, session_id, summary, error
            FROM agent_missions
            ORDER BY started_at DESC LIMIT ?
        ''', (limit,)).fetchall()
    return [dict(r) for r in rows]


def get_mission_detail(mission_id: str) -> Optional[dict]:
    with _get_db() as conn:
        row = conn.execute(
            'SELECT * FROM agent_missions WHERE id=?', (mission_id,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d['steps']   = json.loads(d.get('steps')   or '[]')
    d['summary'] = json.loads(d.get('summary') or '{}')
    return d


def get_erp_sync_queue() -> list:
    queue_file = os.path.join(_DATA_DIR, 'erp_sync_queue.json')
    try:
        with open(queue_file) as f:
            return json.load(f)
    except Exception:
        return []


def load_agent_config() -> dict:
    return _load_agent_config()


def save_agent_config(cfg: dict):
    _save_agent_config(cfg)
