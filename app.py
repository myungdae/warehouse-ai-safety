#!/usr/bin/env python3
"""
Warehouse AI Safety System - Flask Application
Real-time sensor monitoring dashboard + Drone Inventory Intelligence
"""

from flask import Flask, render_template, send_from_directory, request, jsonify, send_file
import os
import smtplib
import json
import sqlite3
import contextlib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, time as dtime
import uuid
import threading
import socket
import subprocess

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import urllib.request

try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError:
    CORS_AVAILABLE = False

# ── Flask App ──────────────────────────────────────────────────
app = Flask(__name__,
            template_folder='backend/templates',
            static_folder='backend/static')

if CORS_AVAILABLE:
    CORS(app)

# ── Report Archive DB (SQLite — persistent across restarts) ───
REPORT_ARCHIVE_DIR = os.path.join(os.path.dirname(__file__), 'backend', 'data')
REPORT_DB_FILE     = os.path.join(REPORT_ARCHIVE_DIR, 'reports.db')

def get_db():
    """SQLite 연결 (Row factory → dict-like)"""
    os.makedirs(REPORT_ARCHIVE_DIR, exist_ok=True)
    conn = sqlite3.connect(REPORT_DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """테이블 초기화 (최초 1회)"""
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS reports (
                id          TEXT PRIMARY KEY,
                saved_at    TEXT NOT NULL,
                date_label  TEXT,
                time_label  TEXT,
                drone_id    TEXT DEFAULT 'DRONE-01',
                warehouse   TEXT DEFAULT 'Warehouse-A',
                total_scanned INTEGER DEFAULT 0,
                accuracy    REAL DEFAULT 0,
                total_changes INTEGER DEFAULT 0,
                agent_actions INTEGER DEFAULT 0,
                missing     INTEGER DEFAULT 0,
                new_items   INTEGER DEFAULT 0,
                changed     INTEGER DEFAULT 0,
                moved       INTEGER DEFAULT 0,
                payload     TEXT,
                note        TEXT DEFAULT ''
            )
        ''')
        # ── 드론 스캔 이벤트 테이블 (실시간 즉시 저장) ────────────
        conn.execute('''
            CREATE TABLE IF NOT EXISTS scan_events (
                id          TEXT PRIMARY KEY,
                scanned_at  TEXT NOT NULL,
                session_id  TEXT NOT NULL,
                drone_id    TEXT NOT NULL,
                aisle       TEXT NOT NULL,
                rack        INTEGER NOT NULL,
                side        TEXT NOT NULL,
                layer       TEXT NOT NULL,
                shelf_id    TEXT NOT NULL,
                pt_number   TEXT,
                qty         INTEGER DEFAULT 0,
                location    TEXT
            )
        ''')
        # ── Mock ERP 재고 테이블 ──────────────────────────────────
        conn.execute('''
            CREATE TABLE IF NOT EXISTS erp_inventory (
                shelf_id    TEXT PRIMARY KEY,
                pt_number   TEXT,
                qty         INTEGER DEFAULT 0,
                location    TEXT,
                last_updated TEXT
            )
        ''')
        # ── ERP 비교 결과 테이블 ──────────────────────────────────
        conn.execute('''
            CREATE TABLE IF NOT EXISTS erp_compare_results (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL,
                compared_at TEXT NOT NULL,
                total_scanned INTEGER DEFAULT 0,
                match_count   INTEGER DEFAULT 0,
                mismatch_count INTEGER DEFAULT 0,
                missing_in_scan INTEGER DEFAULT 0,
                missing_in_erp  INTEGER DEFAULT 0,
                accuracy_rate   REAL DEFAULT 0,
                payload     TEXT
            )
        ''')
        conn.commit()

# 앱 시작 시 DB 초기화
init_db()

# ══════════════════════════════════════════════════════════════
# Mock ERP 데이터 초기화
# ══════════════════════════════════════════════════════════════

WAFER_PT_LIST = [
    'PT64090302', 'PT64090303', 'PT64090304', 'PT64090305',
    'PT64090306', 'PT64090307', 'PT64090308', 'PT64090309',
    'PT64090310', 'PT64090311',
]

def seed_erp_inventory():
    """ERP Mock 데이터 생성 — 아직 없을 때만 실행"""
    import random
    with get_db() as conn:
        cnt = conn.execute('SELECT COUNT(*) FROM erp_inventory').fetchone()[0]
        if cnt > 0:
            return  # 이미 있으면 스킵

        rows = []
        for aisle in range(1, 16):
            for rack in range(1, 21):
                for side in ['L', 'R']:
                    for layer in ['L1', 'L2']:
                        shelf_id = f"{aisle}-{side}{rack}-{layer}"
                        seed = abs(ord(shelf_id[0]) * 13 + rack * 7)
                        # ERP상 85% 재고 보유
                        has_item = random.random() > 0.15
                        pt = WAFER_PT_LIST[seed % len(WAFER_PT_LIST)] if has_item else None
                        qty = random.randint(5, 20) if has_item else 0
                        loc = f"Aisle-{aisle} / Rack-{rack} / {'Side A' if side=='L' else 'Side B'} / {layer}"
                        rows.append((shelf_id, pt, qty, loc, datetime.now().isoformat()))

        conn.executemany(
            'INSERT OR IGNORE INTO erp_inventory (shelf_id, pt_number, qty, location, last_updated) VALUES (?,?,?,?,?)',
            rows
        )
        conn.commit()
        print(f"[ERP] Mock ERP 재고 초기화 완료 ({len(rows)}개 위치)")

seed_erp_inventory()

# ── JSON → SQLite 마이그레이션 (기존 데이터 보존) ─────────────
def migrate_json_to_sqlite():
    """기존 report_archive.json이 있으면 SQLite로 이전"""
    old_file = os.path.join(REPORT_ARCHIVE_DIR, 'report_archive.json')
    if not os.path.exists(old_file):
        return
    try:
        with open(old_file, 'r', encoding='utf-8') as f:
            records = json.load(f)
        with get_db() as conn:
            for r in records:
                try:
                    d = r.get('data', {})
                    conn.execute('''
                        INSERT OR IGNORE INTO reports
                        (id, saved_at, date_label, time_label, drone_id,
                         total_scanned, accuracy, total_changes, agent_actions,
                         missing, new_items, changed, moved, payload)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ''', (
                        r.get('id'), r.get('saved_at'), r.get('date'), r.get('time'),
                        d.get('drone_id','DRONE-01'),
                        d.get('total_scanned',0), float(d.get('accuracy',0)),
                        d.get('total_changes',0), d.get('agent_actions',0),
                        d.get('missing',0), d.get('new_items',0),
                        d.get('changed',0), d.get('moved',0),
                        json.dumps(d, ensure_ascii=False)
                    ))
                except Exception:
                    pass
            conn.commit()
        os.rename(old_file, old_file + '.migrated')
        print(f"[MIGRATE] JSON → SQLite 완료 ({len(records)}건)")
    except Exception as e:
        print(f"[MIGRATE ERROR] {e}")

migrate_json_to_sqlite()

# ── Email Config (from .env) ───────────────────────────────────
MAIL_SERVER   = os.getenv('MAIL_SERVER',   'smtp.gmail.com')
MAIL_PORT     = int(os.getenv('MAIL_PORT', 587))
MAIL_USERNAME = os.getenv('MAIL_USERNAME', '')
MAIL_PASSWORD = os.getenv('MAIL_PASSWORD', '')
MAIL_FROM     = os.getenv('MAIL_FROM',     MAIL_USERNAME)
MAIL_FROM_NAME= os.getenv('MAIL_FROM_NAME','Drone Inventory System')
REPORT_TO     = os.getenv('REPORT_TO',     '')

# ── Routes ────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('warehouse_digital_twin.html')

@app.route('/drone')
def drone_inventory():
    """Tethered drone system (wired power, 2 docks)"""
    return render_template('drone_tethered.html')

@app.route('/drone/multi')
def drone_inventory_multi():
    """Multi-drone system (battery, 3 docks, 9 drones)"""
    return render_template('drone_inventory_multi.html')

@app.route('/drone/single')
def drone_inventory_single():
    """Legacy single-drone system"""
    return render_template('drone_inventory.html')

@app.route('/admin/reports')
def admin_reports():
    return render_template('admin_reports.html')

@app.route('/archive')
def archive_intelligence():
    return render_template('archive_intelligence.html')

@app.route('/quotation')
def quotation():
    return render_template('quotation.html')

@app.route('/quotation/download-excel')
def download_quotation_excel():
    """견적서 Excel 다운로드"""
    import subprocess, os
    xlsx_path = os.path.join(os.path.dirname(__file__), 'quotation_QT-2026-0409-SW-001.xlsx')
    # 파일이 없으면 재생성
    if not os.path.exists(xlsx_path):
        script = os.path.join(os.path.dirname(__file__), 'generate_quotation_excel.py')
        subprocess.run(['python3', script], check=True)
    return send_file(
        xlsx_path,
        as_attachment=True,
        download_name='견적서_QT-2026-0409-SW-001.xlsx',
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

@app.route('/landing.html')
@app.route('/landing')
def landing():
    """IMC Agentic AI Platform 랜딩 페이지 (Module 05 Battery 포함)"""
    return render_template('landing.html')

@app.route('/battery')
def battery():
    """AI Smart Battery Platform — Thinking Battery 제안 페이지"""
    return render_template('battery.html')

@app.route('/battery-sim')
@app.route('/battery/sim')
def battery_sim():
    """BEI Smart Battery — 실시간 시뮬레이션 (Operational Ontology · Agentic AI · MCP)"""
    return render_template('battery-sim.html')

@app.route('/edge')
@app.route('/battery/edge')
def edge_spec():
    """BEI Edge 디바이스 규격 + bei_agent.py 문서화 페이지"""
    return render_template('edge.html')

@app.route('/gotham')
def gotham():
    """Gotham AIP — 작전 상황인식 플랫폼 (백엔드 연동 v2.0)"""
    return render_template('gotham.html')

# ── Gotham API Proxy (FastAPI → Flask 프록시) ──────────────────
GOTHAM_BACKEND_URL = os.environ.get('GOTHAM_BACKEND_URL', 'http://localhost:8766')

@app.route('/gotham-api/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def gotham_api_proxy(subpath):
    """Gotham FastAPI 백엔드를 Flask가 프록시 (CORS 우회)"""
    try:
        target_url = f"{GOTHAM_BACKEND_URL}/api/{subpath}"
        query = request.query_string.decode()
        if query:
            target_url += '?' + query

        method = request.method
        data   = request.get_data()
        headers = {'Content-Type': 'application/json'} if data else {}

        req = urllib.request.Request(
            target_url, data=data if data else None,
            headers=headers, method=method
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body   = resp.read()
            status = resp.status
        return app.response_class(
            response=body, status=status, mimetype='application/json'
        )
    except urllib.error.HTTPError as e:
        return app.response_class(
            response=e.read(), status=e.code, mimetype='application/json'
        )
    except Exception as e:
        return jsonify({'error': str(e), 'backend': GOTHAM_BACKEND_URL}), 502

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('backend/static', filename)

@app.route('/ontology/<path:filename>')
def serve_ontology(filename):
    return send_from_directory('backend/ontology', filename)

# ── Email API ─────────────────────────────────────────────────
@app.route('/api/send_report', methods=['POST'])
def send_report():
    """
    보고서 이메일 발송 API
    POST /api/send_report
    Body: { report_data: {...}, recipient: "email@..." }
    """
    try:
        body = request.get_json(force=True) or {}
        report_data = body.get('report_data', {})
        recipient   = body.get('recipient', REPORT_TO)

        if not recipient:
            return jsonify({'ok': False, 'error': '수신 이메일 없음'}), 400

        # 자격증명 확인
        if not MAIL_USERNAME or not MAIL_PASSWORD or MAIL_PASSWORD == 'placeholder_replace_with_apppassword':
            # 데모 모드: 실제 발송 없이 성공 응답 (개발/데모용)
            print(f"[DEMO MODE] 이메일 발송 시뮬레이션 → {recipient}")
            return jsonify({
                'ok': True,
                'demo': True,
                'message': f'[데모 모드] {recipient} 로 발송 시뮬레이션 완료',
                'report_id': report_data.get('report_id', 'RPT-DEMO')
            })

        # HTML 이메일 생성
        html_body = build_html_email(report_data, recipient)

        # SMTP 발송
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"[Drone Inventory] 일일 재고 인텔리전스 보고서 — {report_data.get('date', datetime.now().strftime('%Y-%m-%d'))}"
        msg['From']    = f"{MAIL_FROM_NAME} <{MAIL_FROM}>"
        msg['To']      = recipient

        msg.attach(MIMEText(build_text_email(report_data), 'plain', 'utf-8'))
        msg.attach(MIMEText(html_body, 'html', 'utf-8'))

        with smtplib.SMTP(MAIL_SERVER, MAIL_PORT) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(MAIL_USERNAME, MAIL_PASSWORD)
            smtp.sendmail(MAIL_FROM, [recipient], msg.as_string())

        print(f"[EMAIL OK] 발송 완료 → {recipient}")
        return jsonify({
            'ok': True,
            'demo': False,
            'message': f'{recipient} 로 발송 완료',
            'report_id': report_data.get('report_id', '')
        })

    except smtplib.SMTPAuthenticationError:
        return jsonify({'ok': False, 'error': 'Gmail 인증 실패 — App Password를 확인하세요'}), 500
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


def build_text_email(d):
    """Plain-text fallback"""
    lines = [
        "=" * 60,
        "  일일 재고 인텔리전스 보고서",
        "  Drone Inventory Intelligence System",
        "=" * 60,
        f"  보고서 ID : {d.get('report_id','')}",
        f"  생성일시  : {d.get('date','')} {d.get('time','')}",
        f"  드론 ID   : {d.get('drone_id','DRONE-01')}",
        "",
        "[ 핵심 지표 ]",
        f"  총 스캔 선반 : {d.get('total_scanned', 0)}개",
        f"  재고 정확도  : {d.get('accuracy', 0)}%",
        f"  변화 감지    : {d.get('total_changes', 0)}건",
        f"  AI 자율 조치 : {d.get('agent_actions', 0)}건",
        "",
        "[ 변화 요약 ]",
        f"  🔴 소진 (Missing)    : {d.get('missing', 0)}건",
        f"  🟢 신규 입고 (New)   : {d.get('new_items', 0)}건",
        f"  🟡 수량 변화 (Changed): {d.get('changed', 0)}건",
        f"  🔵 위치 변경 (Moved) : {d.get('moved', 0)}건",
        "",
        "[ Agentic AI 조치 ]",
    ]
    for action in d.get('agent_decisions', []):
        lines.append(f"  [{action.get('type','')}] {action.get('title','')}")
    lines += [
        "",
        "[ 권고 사항 ]",
    ]
    for rec in d.get('recommendations', []):
        lines.append(f"  • {rec}")
    lines += [
        "",
        "=" * 60,
        "  Powered by Operational Ontology + Agentic AI",
        "  자동 생성된 보고서입니다.",
        "=" * 60,
    ]
    return "\n".join(lines)


def build_html_email(d, recipient):
    """다크 테마 HTML 이메일"""
    date_str   = d.get('date', datetime.now().strftime('%Y-%m-%d'))
    time_str   = d.get('time', datetime.now().strftime('%H:%M:%S'))
    report_id  = d.get('report_id', f"RPT-{datetime.now().strftime('%Y%m%d%H%M')}")
    drone_id   = d.get('drone_id', 'DRONE-01')
    total_scan = d.get('total_scanned', 0)
    accuracy   = d.get('accuracy', 0)
    total_chg  = d.get('total_changes', 0)
    agent_cnt  = d.get('agent_actions', 0)
    missing    = d.get('missing', 0)
    new_items  = d.get('new_items', 0)
    changed    = d.get('changed', 0)
    moved      = d.get('moved', 0)
    recs       = d.get('recommendations', [])
    decisions  = d.get('agent_decisions', [])
    rescan_results = d.get('rescan_results', [])

    # 변화 행
    change_rows = ""
    changes = [
        ('#f87171', '🔴', '소진 (Missing)',     missing,   '전일 재고 있으나 당일 스캔 불가 — 출고 또는 이동 추정'),
        ('#34d399', '🟢', '신규 입고 (New)',     new_items, '전일 빈 선반에 신규 SKU 감지 — WMS 입고 기록 매칭 완료'),
        ('#fbbf24', '🟡', '수량 변화 (Changed)', changed,   f'동일 SKU 수량 변동 — 출고 {int(changed*0.7)}건 / 입고 {int(changed*0.3)}건'),
        ('#22d3ee', '🔵', '위치 변경 (Moved)',   moved,     'SKU 위치 불일치 — CCTV 확인 요청 발송'),
    ]
    for color, emoji, label, cnt, desc in changes:
        change_rows += f"""
        <tr>
          <td style="padding:10px 16px;border-bottom:1px solid #1e293b;">
            <span style="color:{color};font-weight:700;">{emoji} {label}</span>
          </td>
          <td style="padding:10px 16px;border-bottom:1px solid #1e293b;text-align:center;">
            <span style="font-size:1.3rem;font-weight:900;color:{color};">{cnt}</span>
          </td>
          <td style="padding:10px 16px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:0.85rem;">
            {desc}
          </td>
        </tr>"""

    # Agent 조치 행
    type_colors = {'RESCAN':'#a78bfa','CONFIRM':'#34d399','ALERT':'#f87171','ESCALATE':'#fbbf24'}
    decision_rows = ""
    for dec in decisions:
        tc = type_colors.get(dec.get('type',''), '#94a3b8')
        decision_rows += f"""
        <tr>
          <td style="padding:9px 16px;border-bottom:1px solid #1e293b;">
            <span style="background:{tc}22;color:{tc};padding:2px 8px;border-radius:4px;
                         font-size:0.72rem;font-weight:700;">{dec.get('type','')}</span>
          </td>
          <td style="padding:9px 16px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:0.85rem;">
            {dec.get('title','')}
          </td>
          <td style="padding:9px 16px;border-bottom:1px solid #1e293b;color:#64748b;
                     font-size:0.78rem;font-family:monospace;">
            {dec.get('timestamp','')}
          </td>
        </tr>"""

    # 재스캔 결과 섹션
    rescan_section = ""
    if rescan_results:
        rescan_rows = ""
        for r in rescan_results:
            vc = '#34d399' if r.get('verdict') == 'SCAN_ERROR' else '#f87171'
            vt = '⚠️ 초기 스캔 오류 → 복원' if r.get('verdict') == 'SCAN_ERROR' else '✅ 소진 확인'
            rescan_rows += f"""
            <tr>
              <td style="padding:8px 12px;border-bottom:1px solid #1e293b;
                         font-family:monospace;color:#a5b4fc;font-weight:700;">{r.get('shelfId','')}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#64748b;font-size:0.82rem;">{r.get('location','')}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:{vc};font-weight:700;font-size:0.82rem;">{vt}</td>
            </tr>"""
        rescan_section = f"""
        <div style="margin:0 0 24px;">
          <div style="font-size:0.78rem;font-weight:800;color:#94a3b8;text-transform:uppercase;
                      letter-spacing:0.06em;margin-bottom:12px;">🚁 재스캔 임무 결과</div>
          <table width="100%" cellpadding="0" cellspacing="0"
                 style="border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden;
                        border:1px solid #1e293b;">
            <thead>
              <tr style="background:#0d1424;">
                <th style="padding:9px 12px;text-align:left;color:#475569;font-size:0.72rem;
                           text-transform:uppercase;letter-spacing:0.05em;">선반 ID</th>
                <th style="padding:9px 12px;text-align:left;color:#475569;font-size:0.72rem;
                           text-transform:uppercase;letter-spacing:0.05em;">위치</th>
                <th style="padding:9px 12px;text-align:left;color:#475569;font-size:0.72rem;
                           text-transform:uppercase;letter-spacing:0.05em;">판정</th>
              </tr>
            </thead>
            <tbody>{rescan_rows}</tbody>
          </table>
        </div>"""

    # 권고 사항
    rec_colors = {'HIGH':'#f87171','MEDIUM':'#fbbf24','LOW':'#22d3ee','INFO':'#a5b4fc'}
    rec_bgs    = {'HIGH':'rgba(248,113,113,0.08)','MEDIUM':'rgba(251,191,36,0.08)',
                  'LOW':'rgba(34,211,238,0.08)','INFO':'rgba(165,180,252,0.08)'}
    rec_html   = ""
    for rec in recs:
        level = 'HIGH' if '[HIGH]' in rec else 'MEDIUM' if '[MEDIUM]' in rec else 'LOW' if '[LOW]' in rec else 'INFO'
        rc = rec_colors.get(level, '#94a3b8')
        rb = rec_bgs.get(level, 'rgba(255,255,255,0.04)')
        rec_html += f"""
        <div style="padding:10px 14px;border-radius:8px;border-left:3px solid {rc};
                    background:{rb};margin-bottom:8px;font-size:0.85rem;color:#e2e8f0;">
          {rec}
        </div>"""

    # 최종 HTML
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>일일 재고 인텔리전스 보고서</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;color:#e2e8f0;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;min-height:100vh;">
<tr><td align="center" style="padding:32px 16px;">

  <!-- 컨테이너 -->
  <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">

    <!-- 헤더 배너 -->
    <tr>
      <td style="background:linear-gradient(135deg,#1e3a5f 0%,#1e293b 100%);
                 border-radius:16px 16px 0 0;padding:28px 32px;
                 border:1px solid #334155;border-bottom:none;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <div style="font-size:0.7rem;color:#475569;letter-spacing:0.12em;
                          text-transform:uppercase;margin-bottom:8px;">
                CONFIDENTIAL · INTERNAL USE ONLY
              </div>
              <div style="font-size:1.6rem;font-weight:900;color:#f1f5f9;line-height:1.2;margin-bottom:6px;">
                🚁 일일 재고 인텔리전스 보고서
              </div>
              <div style="font-size:0.85rem;color:#64748b;">
                Daily Inventory Intelligence Report — Drone Autonomous Patrol System
              </div>
            </td>
            <td align="right" style="vertical-align:top;">
              <div style="background:rgba(52,211,153,0.15);border:1px solid rgba(52,211,153,0.3);
                          border-radius:8px;padding:10px 16px;text-align:right;">
                <div style="font-size:0.7rem;color:#64748b;margin-bottom:4px;">보고서 ID</div>
                <div style="font-family:monospace;font-weight:700;color:#34d399;font-size:0.85rem;">
                  {report_id}
                </div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- 메타 정보 -->
    <tr>
      <td style="background:#1e293b;padding:14px 32px;border:1px solid #334155;border-top:none;border-bottom:none;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:0.78rem;color:#64748b;">
              📅 생성일시: <span style="color:#94a3b8;">{date_str} {time_str}</span>
            </td>
            <td style="font-size:0.78rem;color:#64748b;text-align:center;">
              🚁 드론: <span style="color:#94a3b8;">{drone_id}</span>
            </td>
            <td style="font-size:0.78rem;color:#64748b;text-align:right;">
              📧 수신: <span style="color:#94a3b8;">{recipient}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- KPI 카드 4개 -->
    <tr>
      <td style="background:#1e293b;padding:20px 32px;border:1px solid #334155;border-top:none;border-bottom:none;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            {''.join(f"""
            <td width="25%" style="padding:0 6px;">
              <div style="background:#0f172a;border:1px solid #334155;border-radius:10px;
                          padding:14px;text-align:center;">
                <div style="font-size:1.8rem;font-weight:900;color:{kc};">{kv}</div>
                <div style="font-size:0.7rem;color:#64748b;margin-top:4px;">{kl}</div>
              </div>
            </td>""" for kv, kl, kc in [
                (total_scan, '총 스캔 선반', '#a5b4fc'),
                (f"{accuracy}%", '재고 정확도', '#34d399'),
                (total_chg, '변화 감지', '#fbbf24'),
                (agent_cnt, 'AI 자율 조치', '#a78bfa'),
            ])}
          </tr>
        </table>
      </td>
    </tr>

    <!-- 재고 변화 요약 -->
    <tr>
      <td style="background:#1e293b;padding:20px 32px 0;border:1px solid #334155;border-top:none;border-bottom:none;">
        <div style="font-size:0.78rem;font-weight:800;color:#94a3b8;text-transform:uppercase;
                    letter-spacing:0.06em;margin-bottom:12px;">🔍 재고 변화 요약</div>
        <table width="100%" cellpadding="0" cellspacing="0"
               style="border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden;
                      border:1px solid #1e293b;">
          <thead>
            <tr style="background:#0d1424;">
              <th style="padding:9px 16px;text-align:left;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;">유형</th>
              <th style="padding:9px 16px;text-align:center;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;">건수</th>
              <th style="padding:9px 16px;text-align:left;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;">설명</th>
            </tr>
          </thead>
          <tbody>{change_rows}</tbody>
        </table>
      </td>
    </tr>

    <!-- 재스캔 결과 (있을 경우) -->
    {'<tr><td style="background:#1e293b;padding:20px 32px 0;border:1px solid #334155;border-top:none;border-bottom:none;">' + rescan_section + '</td></tr>' if rescan_section else ''}

    <!-- Agentic AI 조치 -->
    <tr>
      <td style="background:#1e293b;padding:20px 32px 0;border:1px solid #334155;border-top:none;border-bottom:none;">
        <div style="font-size:0.78rem;font-weight:800;color:#94a3b8;text-transform:uppercase;
                    letter-spacing:0.06em;margin-bottom:12px;">🤖 Agentic AI 자율 조치 내역</div>
        <table width="100%" cellpadding="0" cellspacing="0"
               style="border-collapse:collapse;background:#0f172a;border-radius:10px;overflow:hidden;
                      border:1px solid #1e293b;">
          <thead>
            <tr style="background:#0d1424;">
              <th style="padding:9px 16px;text-align:left;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;width:90px;">유형</th>
              <th style="padding:9px 16px;text-align:left;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;">내용</th>
              <th style="padding:9px 16px;text-align:left;color:#475569;font-size:0.72rem;
                         text-transform:uppercase;letter-spacing:0.05em;width:90px;">시간</th>
            </tr>
          </thead>
          <tbody>{decision_rows}</tbody>
        </table>
      </td>
    </tr>

    <!-- 권고 사항 -->
    <tr>
      <td style="background:#1e293b;padding:20px 32px 4px;border:1px solid #334155;border-top:none;border-bottom:none;">
        <div style="font-size:0.78rem;font-weight:800;color:#94a3b8;text-transform:uppercase;
                    letter-spacing:0.06em;margin-bottom:12px;">💡 권고 사항 (Recommendations)</div>
        {rec_html}
      </td>
    </tr>

    <!-- 푸터 -->
    <tr>
      <td style="background:#0d1424;padding:20px 32px;border-radius:0 0 16px 16px;
                 border:1px solid #334155;border-top:1px solid #1e293b;text-align:center;">
        <div style="font-size:0.75rem;color:#334155;line-height:1.8;">
          <span style="color:#475569;">🚁 Drone Inventory Intelligence System v1.0</span><br>
          Powered by Operational Ontology + Agentic AI<br>
          이 보고서는 자동 생성되어 발송되었습니다 · {date_str}
        </div>
        <div style="margin-top:12px;">
          <span style="display:inline-block;background:rgba(99,102,241,0.15);
                       border:1px solid rgba(99,102,241,0.3);border-radius:6px;
                       padding:4px 12px;font-size:0.72rem;color:#818cf8;">
            warehouse.exko.kr/drone
          </span>
        </div>
      </td>
    </tr>

  </table>
</td></tr>
</table>

</body>
</html>"""


# ── Report Archive API (SQLite) ───────────────────────────────
@app.route('/api/archive_report', methods=['POST'])
def archive_report():
    """POST /api/archive_report — 보고서 SQLite 저장"""
    try:
        body        = request.get_json(force=True) or {}
        report_data = body.get('report_data', {})
        if not report_data:
            return jsonify({'ok': False, 'error': '보고서 데이터 없음'}), 400

        rid      = report_data.get('report_id', f"RPT-{uuid.uuid4().hex[:8].upper()}")
        saved_at = datetime.now().isoformat()

        with get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO reports
                (id, saved_at, date_label, time_label, drone_id, warehouse,
                 total_scanned, accuracy, total_changes, agent_actions,
                 missing, new_items, changed, moved, payload)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                rid, saved_at,
                report_data.get('date', ''),
                report_data.get('time', ''),
                report_data.get('drone_id', 'DRONE-01'),
                report_data.get('warehouse', 'Warehouse-A'),
                int(report_data.get('total_scanned', 0)),
                float(report_data.get('accuracy', 0)),
                int(report_data.get('total_changes', 0)),
                int(report_data.get('agent_actions', 0)),
                int(report_data.get('missing', 0)),
                int(report_data.get('new_items', 0)),
                int(report_data.get('changed', 0)),
                int(report_data.get('moved', 0)),
                json.dumps(report_data, ensure_ascii=False)
            ))
            conn.commit()

        print(f"[ARCHIVE] 저장 → {rid} ({saved_at})")
        return jsonify({'ok': True, 'id': rid, 'saved_at': saved_at})

    except Exception as e:
        print(f"[ARCHIVE ERROR] {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports', methods=['GET'])
def list_reports():
    """GET /api/reports — 목록 조회 (검색·필터·정렬 지원)"""
    try:
        limit    = min(int(request.args.get('limit', 100)), 500)
        offset   = int(request.args.get('offset', 0))
        search   = request.args.get('search', '').strip()
        drone    = request.args.get('drone', '').strip()
        date_from= request.args.get('date_from', '').strip()
        date_to  = request.args.get('date_to', '').strip()
        sort     = request.args.get('sort', 'saved_at')
        order    = 'DESC' if request.args.get('order','desc').lower() == 'desc' else 'ASC'

        safe_cols = {'saved_at','accuracy','total_changes','missing','agent_actions'}
        if sort not in safe_cols: sort = 'saved_at'

        where, params = [], []
        if search:
            where.append("(id LIKE ? OR date_label LIKE ? OR drone_id LIKE ?)")
            params += [f'%{search}%']*3
        if drone:
            where.append("drone_id = ?"); params.append(drone)
        if date_from:
            where.append("saved_at >= ?"); params.append(date_from)
        if date_to:
            where.append("saved_at <= ?"); params.append(date_to + 'T23:59:59')

        where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''

        with get_db() as conn:
            total = conn.execute(
                f'SELECT COUNT(*) FROM reports {where_sql}', params).fetchone()[0]
            rows = conn.execute(
                f'''SELECT id, saved_at, date_label, time_label, drone_id, warehouse,
                           total_scanned, accuracy, total_changes, agent_actions,
                           missing, new_items, changed, moved, note
                    FROM reports {where_sql}
                    ORDER BY {sort} {order}
                    LIMIT ? OFFSET ?''',
                params + [limit, offset]
            ).fetchall()

        reports = [dict(r) for r in rows]
        return jsonify({'ok': True, 'reports': reports, 'total': total,
                        'limit': limit, 'offset': offset})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports/stats', methods=['GET'])
def reports_stats():
    """GET /api/reports/stats — 관리자 대시보드용 통계"""
    try:
        with get_db() as conn:
            total = conn.execute('SELECT COUNT(*) FROM reports').fetchone()[0]
            avg_acc = conn.execute(
                'SELECT AVG(accuracy) FROM reports').fetchone()[0] or 0
            total_missing = conn.execute(
                'SELECT SUM(missing) FROM reports').fetchone()[0] or 0
            total_changes = conn.execute(
                'SELECT SUM(total_changes) FROM reports').fetchone()[0] or 0
            # 최근 7일 일별 통계
            daily = conn.execute('''
                SELECT DATE(saved_at) as day,
                       COUNT(*) as cnt,
                       AVG(accuracy) as avg_acc,
                       SUM(total_changes) as sum_chg,
                       SUM(missing) as sum_miss
                FROM reports
                WHERE saved_at >= DATE('now','-7 days')
                GROUP BY day ORDER BY day ASC
            ''').fetchall()
            # 드론별 통계
            by_drone = conn.execute('''
                SELECT drone_id, COUNT(*) as cnt, AVG(accuracy) as avg_acc
                FROM reports GROUP BY drone_id
            ''').fetchall()
            # 최근 10건
            recent = conn.execute('''
                SELECT id, saved_at, date_label, accuracy, total_changes, missing
                FROM reports ORDER BY saved_at DESC LIMIT 10
            ''').fetchall()

        return jsonify({
            'ok': True,
            'total_reports': total,
            'avg_accuracy': round(avg_acc, 2),
            'total_missing_events': int(total_missing),
            'total_change_events':  int(total_changes),
            'daily_7d': [dict(r) for r in daily],
            'by_drone':  [dict(r) for r in by_drone],
            'recent':    [dict(r) for r in recent],
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports/<report_id>', methods=['GET'])
def get_report(report_id):
    """GET /api/reports/<id> — 특정 보고서 전체 조회"""
    try:
        with get_db() as conn:
            row = conn.execute(
                'SELECT * FROM reports WHERE id = ?', (report_id,)).fetchone()
        if not row:
            return jsonify({'ok': False, 'error': '보고서를 찾을 수 없습니다'}), 404
        r = dict(row)
        try:
            r['data'] = json.loads(r.get('payload') or '{}')
        except Exception:
            r['data'] = {}
        return jsonify({'ok': True, 'report': r})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports/<report_id>', methods=['PATCH'])
def update_report_note(report_id):
    """PATCH /api/reports/<id> — 메모(note) 수정"""
    try:
        body = request.get_json(force=True) or {}
        note = body.get('note', '')
        with get_db() as conn:
            res = conn.execute(
                'UPDATE reports SET note=? WHERE id=?', (note, report_id))
            conn.commit()
            if res.rowcount == 0:
                return jsonify({'ok': False, 'error': '보고서를 찾을 수 없습니다'}), 404
        return jsonify({'ok': True, 'id': report_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports/<report_id>', methods=['DELETE'])
def delete_report(report_id):
    """DELETE /api/reports/<id> — 보고서 삭제"""
    try:
        with get_db() as conn:
            res = conn.execute('DELETE FROM reports WHERE id=?', (report_id,))
            conn.commit()
            if res.rowcount == 0:
                return jsonify({'ok': False, 'error': '보고서를 찾을 수 없습니다'}), 404
        return jsonify({'ok': True, 'deleted': report_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/reports/export', methods=['GET'])
def export_reports():
    """GET /api/reports/export — 전체 보고서 JSON 다운로드"""
    try:
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM reports ORDER BY saved_at DESC').fetchall()
        data = []
        for row in rows:
            r = dict(row)
            try: r['data'] = json.loads(r.get('payload') or '{}')
            except: r['data'] = {}
            del r['payload']
            data.append(r)
        from flask import Response
        return Response(
            json.dumps(data, ensure_ascii=False, indent=2),
            mimetype='application/json',
            headers={'Content-Disposition':
                     f'attachment;filename=report_archive_{datetime.now().strftime("%Y%m%d")}.json'}
        )
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ══════════════════════════════════════════════════════════════
# MCP AUTO-PRINT SCHEDULER  (Agentic AI + MCP)
# ══════════════════════════════════════════════════════════════

MCP_CONFIG_FILE = os.path.join(REPORT_ARCHIVE_DIR, 'mcp_config.json')
MCP_LOG_FILE    = os.path.join(REPORT_ARCHIVE_DIR, 'mcp_print_log.json')

_DEFAULT_MCP_CONFIG = {
    "auto_print_enabled": True,
    "print_time": "06:00",           # HH:MM — default 6 AM (before staff arrive)
    "printer_ip": "192.168.1.100",   # office network printer IP
    "printer_port": 9100,            # RAW / IPP port
    "printer_name": "Office-Printer",
    "copies": 1,
    "print_format": "A4",
    "notify_email": True,
    "patrol_auto_start": True,       # auto-start patrol at night
    "patrol_start_time": "22:00",    # 10 PM nightly patrol
    "last_auto_print": None,
    "last_patrol_trigger": None,
}

def _load_mcp_config():
    os.makedirs(REPORT_ARCHIVE_DIR, exist_ok=True)
    if os.path.exists(MCP_CONFIG_FILE):
        try:
            with open(MCP_CONFIG_FILE) as f:
                cfg = json.load(f)
            # fill missing keys with defaults
            for k, v in _DEFAULT_MCP_CONFIG.items():
                cfg.setdefault(k, v)
            return cfg
        except Exception:
            pass
    return dict(_DEFAULT_MCP_CONFIG)

def _save_mcp_config(cfg):
    os.makedirs(REPORT_ARCHIVE_DIR, exist_ok=True)
    with open(MCP_CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def _load_mcp_log():
    if os.path.exists(MCP_LOG_FILE):
        try:
            with open(MCP_LOG_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return []

def _append_mcp_log(entry):
    logs = _load_mcp_log()
    logs.insert(0, entry)
    logs = logs[:200]   # keep last 200 entries
    os.makedirs(REPORT_ARCHIVE_DIR, exist_ok=True)
    with open(MCP_LOG_FILE, 'w') as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)


def _check_printer_online(ip, port=9100, timeout=3):
    """TCP ping to RAW print port (9100) or IPP (631)."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except Exception:
        return False


def _send_to_printer_raw(ip, port, payload_bytes, timeout=10):
    """Send raw bytes to a RAW/JetDirect printer port (9100)."""
    with socket.create_connection((ip, port), timeout=timeout) as s:
        s.sendall(payload_bytes)


def _build_print_payload(report_data: dict) -> bytes:
    """Build a plain-text print payload from report_data (ASCII-safe for RAW)."""
    now     = datetime.now()
    rpt_id  = report_data.get('report_id', 'N/A')
    date_l  = report_data.get('date',  now.strftime('%Y-%m-%d'))
    time_l  = report_data.get('time',  now.strftime('%H:%M:%S'))
    accuracy = report_data.get('accuracy', 0)
    missing  = report_data.get('missing',  0)
    changed  = report_data.get('changed',  0)
    new_items= report_data.get('new_items',0)
    total_sc = report_data.get('total_scanned', 0)
    rescan_t = report_data.get('rescan_total', 0)
    rescan_d = report_data.get('rescan_done',  0)
    ai_recs  = report_data.get('ai_recommendations', [])

    lines = [
        "\x1B%-12345X@PJL JOB",          # PJL header (ignored if not PCL printer)
        "=" * 62,
        "  SAMSUNG SEMICONDUCTOR WAREHOUSE",
        "  DAILY DRONE INVENTORY REPORT  (AUTO-PRINT via MCP)",
        "=" * 62,
        f"  Report ID : {rpt_id}",
        f"  Date/Time : {date_l}  {time_l}",
        f"  Warehouse : Samsung-Warehouse-15A",
        f"  Drone     : Drone-A (Aisles 1-7) + Drone-B (Aisles 8-15)",
        "-" * 62,
        "  KEY METRICS",
        "-" * 62,
        f"  Total Scanned  : {total_sc:>6} locations",
        f"  Accuracy       : {accuracy:>6.1f} %",
        f"  Missing Items  : {missing:>6}",
        f"  Changed Items  : {changed:>6}",
        f"  New Items      : {new_items:>6}",
        f"  Re-scan Done   : {rescan_d:>3} / {rescan_t}",
        "-" * 62,
        "  AI RECOMMENDATIONS",
        "-" * 62,
    ]
    for rec in (ai_recs or []):
        lines.append(f"  * {rec}")
    if not ai_recs:
        lines.append("  * No critical issues detected.")

    miss_det  = report_data.get('missing_details', [])
    dec_det   = report_data.get('decreased_details', [])
    rescan_res= report_data.get('rescan_results', {})

    if miss_det:
        lines += ["-" * 62, "  MISSING ITEMS (top 20)", "-" * 62]
        for i, item in enumerate(miss_det[:20], 1):
            sid  = item.get('shelfId', '')
            sku  = item.get('day1', {}).get('sku', '') or ''
            qty  = item.get('day1', {}).get('qty', 0)
            lines.append(f"  {i:>2}. {sid:<30} {sku}  x{qty}")

    if rescan_res:
        lines += ["-" * 62, "  RE-SCAN RESULTS", "-" * 62]
        verdicts = {'all_found':'CONFIRMED OK', 'partial_found':'PARTIAL',
                    'confirmed_missing':'STILL MISSING', 'scanning':'IN PROGRESS'}
        for shelfId, res in list(rescan_res.items())[:20]:
            v = verdicts.get(res.get('verdict',''), res.get('verdict',''))
            drone_id = res.get('droneId', '')
            lines.append(f"  {shelfId:<35} [{v}]  Drone {drone_id}")

    lines += [
        "=" * 62,
        f"  Printed by MCP Agentic Auto-Print  |  {now.strftime('%Y-%m-%d %H:%M:%S')}",
        "=" * 62,
        "\f",   # form feed — eject page
        "\x1B%-12345X@PJL EOJ\n",
    ]
    return "\n".join(lines).encode('ascii', errors='replace')


def mcp_auto_print(report_data: dict, triggered_by: str = 'scheduler') -> dict:
    """
    Core MCP print action:
    1. Check printer online
    2. Send payload via RAW TCP
    3. Log result
    Returns dict with ok, message
    """
    cfg  = _load_mcp_config()
    ip   = cfg.get('printer_ip', '192.168.1.100')
    port = int(cfg.get('printer_port', 9100))
    now  = datetime.now().isoformat()

    log_entry = {
        "timestamp": now,
        "triggered_by": triggered_by,
        "printer_ip": ip,
        "printer_port": port,
        "report_id": report_data.get('report_id', 'N/A'),
        "status": "unknown",
        "message": "",
    }

    # Step 1: printer online check
    if not _check_printer_online(ip, port):
        # Try IPP port 631 as fallback
        ipp_ok = _check_printer_online(ip, 631)
        if not ipp_ok:
            log_entry['status']  = 'printer_offline'
            log_entry['message'] = f'Printer {ip}:{port} unreachable — print job skipped'
            _append_mcp_log(log_entry)
            print(f"[MCP] ⚠️  Printer offline: {ip}:{port}")
            return {'ok': False, 'status': 'printer_offline',
                    'message': log_entry['message']}
        port = 631   # fallback to IPP raw port

    # Step 2: build & send payload
    try:
        payload = _build_print_payload(report_data)
        _send_to_printer_raw(ip, port, payload)
        log_entry['status']  = 'sent'
        log_entry['message'] = f'Print job sent successfully ({len(payload)} bytes) to {ip}:{port}'
        _append_mcp_log(log_entry)
        # update last_auto_print timestamp
        cfg['last_auto_print'] = now
        _save_mcp_config(cfg)
        print(f"[MCP] ✅ Print job sent → {ip}:{port}  ({len(payload)} bytes)")
        return {'ok': True, 'status': 'sent', 'message': log_entry['message'],
                'bytes': len(payload)}
    except Exception as e:
        log_entry['status']  = 'error'
        log_entry['message'] = str(e)
        _append_mcp_log(log_entry)
        print(f"[MCP] ❌ Print error: {e}")
        return {'ok': False, 'status': 'error', 'message': str(e)}


# ── MCP Background Scheduler Thread ───────────────────────────
_scheduler_lock  = threading.Lock()
_last_sched_date = {'print': None, 'patrol': None}

def _mcp_scheduler_tick():
    """Called every 30 s by background thread — checks if it's time to auto-print."""
    cfg = _load_mcp_config()
    now = datetime.now()
    today_str = now.strftime('%Y-%m-%d')

    # ── Auto-print check ──────────────────────────────────────
    if cfg.get('auto_print_enabled'):
        try:
            pt_h, pt_m = map(int, cfg['print_time'].split(':'))
            target = now.replace(hour=pt_h, minute=pt_m, second=0, microsecond=0)
            diff_s = abs((now - target).total_seconds())
            with _scheduler_lock:
                already_done = _last_sched_date.get('print') == today_str
            if diff_s < 60 and not already_done:
                print(f"[MCP Scheduler] ⏰ Auto-print time reached ({cfg['print_time']}). Fetching latest report…")
                # Fetch latest report from DB
                try:
                    with get_db() as conn:
                        row = conn.execute(
                            'SELECT payload FROM reports ORDER BY saved_at DESC LIMIT 1'
                        ).fetchone()
                    if row and row['payload']:
                        report_data = json.loads(row['payload'])
                        result = mcp_auto_print(report_data, triggered_by='scheduler')
                        print(f"[MCP Scheduler] Print result: {result}")
                    else:
                        print("[MCP Scheduler] No reports found in DB — skipping print.")
                        _append_mcp_log({
                            "timestamp": now.isoformat(),
                            "triggered_by": "scheduler",
                            "status": "no_report",
                            "message": "No report found in DB at scheduled print time",
                        })
                except Exception as e:
                    print(f"[MCP Scheduler] DB error: {e}")
                with _scheduler_lock:
                    _last_sched_date['print'] = today_str
        except Exception as e:
            print(f"[MCP Scheduler] Error in print check: {e}")

    # ── Nightly patrol auto-start signal (write to a signal file) ──
    if cfg.get('patrol_auto_start'):
        try:
            ps_h, ps_m = map(int, cfg['patrol_start_time'].split(':'))
            target_p = now.replace(hour=ps_h, minute=ps_m, second=0, microsecond=0)
            diff_p   = abs((now - target_p).total_seconds())
            with _scheduler_lock:
                patrol_done = _last_sched_date.get('patrol') == today_str
            if diff_p < 60 and not patrol_done:
                signal_path = os.path.join(REPORT_ARCHIVE_DIR, 'patrol_trigger.json')
                with open(signal_path, 'w') as f:
                    json.dump({'triggered_at': now.isoformat(), 'date': today_str}, f)
                print(f"[MCP Scheduler] 🚁 Patrol trigger signal written at {now.isoformat()}")
                _append_mcp_log({
                    "timestamp": now.isoformat(),
                    "triggered_by": "scheduler",
                    "status": "patrol_triggered",
                    "message": f"Nightly patrol start signal at {cfg['patrol_start_time']}",
                })
                cfg['last_patrol_trigger'] = now.isoformat()
                _save_mcp_config(cfg)
                with _scheduler_lock:
                    _last_sched_date['patrol'] = today_str
        except Exception as e:
            print(f"[MCP Scheduler] Error in patrol check: {e}")


def _scheduler_loop():
    import time
    print("[MCP Scheduler] 🟢 Background scheduler started (30s tick)")
    while True:
        try:
            _mcp_scheduler_tick()
        except Exception as e:
            print(f"[MCP Scheduler] Unexpected error: {e}")
        time.sleep(30)

# Start scheduler thread
_sched_thread = threading.Thread(target=_scheduler_loop, daemon=True, name='mcp-scheduler')
_sched_thread.start()


# ══════════════════════════════════════════════════════════════
# MCP / PRINTER API ROUTES
# ══════════════════════════════════════════════════════════════

@app.route('/mcp')
def mcp_dashboard():
    """MCP Auto-Print Control Dashboard"""
    return render_template('mcp_print.html')


@app.route('/api/mcp/config', methods=['GET'])
def get_mcp_config():
    """GET current MCP configuration"""
    cfg = _load_mcp_config()
    cfg_safe = {k: v for k, v in cfg.items()}   # sanitize if needed
    return jsonify({'ok': True, 'config': cfg_safe})


@app.route('/api/mcp/config', methods=['POST'])
def set_mcp_config():
    """POST — update MCP configuration"""
    try:
        body = request.get_json(force=True) or {}
        cfg  = _load_mcp_config()
        allowed = ['auto_print_enabled','print_time','printer_ip','printer_port',
                   'printer_name','copies','print_format','notify_email',
                   'patrol_auto_start','patrol_start_time']
        for k in allowed:
            if k in body:
                cfg[k] = body[k]
        _save_mcp_config(cfg)
        return jsonify({'ok': True, 'config': cfg})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/printer/status', methods=['GET'])
def printer_status():
    """GET — check if configured printer is reachable"""
    cfg  = _load_mcp_config()
    ip   = cfg.get('printer_ip', '192.168.1.100')
    port = int(cfg.get('printer_port', 9100))
    raw_ok = _check_printer_online(ip, port, timeout=2)
    ipp_ok = _check_printer_online(ip, 631, timeout=2)
    online = raw_ok or ipp_ok
    return jsonify({
        'ok': True,
        'online': online,
        'raw_port_ok': raw_ok,
        'ipp_port_ok': ipp_ok,
        'ip': ip,
        'port': port,
        'checked_at': datetime.now().isoformat(),
    })


@app.route('/api/print/manual', methods=['POST'])
def manual_print():
    """POST — manual print trigger (from UI button or MCP agent)
    Body: { report_id: '...' }  OR  { report_data: {...} }
    """
    try:
        body = request.get_json(force=True) or {}
        report_data = body.get('report_data')

        if not report_data:
            # Load from DB by ID or take latest
            report_id = body.get('report_id')
            with get_db() as conn:
                if report_id:
                    row = conn.execute(
                        'SELECT payload FROM reports WHERE id=?', (report_id,)
                    ).fetchone()
                else:
                    row = conn.execute(
                        'SELECT payload FROM reports ORDER BY saved_at DESC LIMIT 1'
                    ).fetchone()
            if not row or not row['payload']:
                return jsonify({'ok': False, 'error': '보고서를 찾을 수 없습니다'}), 404
            report_data = json.loads(row['payload'])

        result = mcp_auto_print(report_data, triggered_by='manual')
        return jsonify(result)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/print/preview', methods=['POST'])
def print_preview():
    """POST — return the text payload that would be printed (for UI preview)"""
    try:
        body = request.get_json(force=True) or {}
        report_data = body.get('report_data')
        if not report_data:
            with get_db() as conn:
                row = conn.execute(
                    'SELECT payload FROM reports ORDER BY saved_at DESC LIMIT 1'
                ).fetchone()
            if not row:
                return jsonify({'ok': False, 'error': 'No report found'}), 404
            report_data = json.loads(row['payload'])
        payload_bytes = _build_print_payload(report_data)
        return jsonify({
            'ok': True,
            'text': payload_bytes.decode('ascii', errors='replace'),
            'bytes': len(payload_bytes),
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/mcp/log', methods=['GET'])
def get_mcp_log():
    """GET — MCP print / patrol event log"""
    logs = _load_mcp_log()
    limit = int(request.args.get('limit', 50))
    return jsonify({'ok': True, 'logs': logs[:limit], 'total': len(logs)})


@app.route('/api/mcp/patrol-signal', methods=['GET'])
def get_patrol_signal():
    """GET — frontend polls this to know if nightly patrol should start"""
    signal_path = os.path.join(REPORT_ARCHIVE_DIR, 'patrol_trigger.json')
    if os.path.exists(signal_path):
        try:
            with open(signal_path) as f:
                data = json.load(f)
            # consume the signal (remove file)
            os.remove(signal_path)
            return jsonify({'ok': True, 'signal': True, 'data': data})
        except Exception:
            pass
    return jsonify({'ok': True, 'signal': False})


# ══════════════════════════════════════════════════════════════
# SCAN EVENT API — 드론 스캔 즉시 저장
# ══════════════════════════════════════════════════════════════

@app.route('/api/scan/event', methods=['POST'])
def save_scan_event():
    """드론이 박스 하나 읽을 때마다 즉시 Edge DB에 저장"""
    try:
        body = request.get_json(force=True) or {}
        sid  = f"SE-{uuid.uuid4().hex[:12].upper()}"
        now  = datetime.now().isoformat()

        with get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO scan_events
                (id, scanned_at, session_id, drone_id, aisle, rack, side, layer,
                 shelf_id, pt_number, qty, location)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                sid, now,
                body.get('session_id', 'default'),
                body.get('drone_id', 'A'),
                str(body.get('aisle', '')),
                int(body.get('rack', 0)),
                body.get('side', ''),
                body.get('layer', ''),
                body.get('shelf_id', ''),
                body.get('pt_number'),
                int(body.get('qty', 0)),
                body.get('location', ''),
            ))
            conn.commit()

        return jsonify({'ok': True, 'id': sid})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/scan/session/<session_id>', methods=['GET'])
def get_scan_session(session_id):
    """특정 세션의 스캔 결과 조회"""
    try:
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM scan_events WHERE session_id=? ORDER BY scanned_at',
                (session_id,)
            ).fetchall()
        return jsonify({'ok': True, 'count': len(rows),
                        'events': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/scan/latest', methods=['GET'])
def get_latest_scans():
    """최근 스캔 이벤트 조회"""
    try:
        limit = int(request.args.get('limit', 100))
        with get_db() as conn:
            rows = conn.execute(
                'SELECT * FROM scan_events ORDER BY scanned_at DESC LIMIT ?',
                (limit,)
            ).fetchall()
        return jsonify({'ok': True, 'events': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ══════════════════════════════════════════════════════════════
# MOCK ERP API
# ══════════════════════════════════════════════════════════════

@app.route('/api/erp/inventory', methods=['GET'])
def erp_inventory():
    """Mock ERP 재고 조회 — 실제 ERP와 동일한 인터페이스"""
    try:
        aisle  = request.args.get('aisle')
        shelf  = request.args.get('shelf_id')
        with get_db() as conn:
            if shelf:
                rows = conn.execute(
                    'SELECT * FROM erp_inventory WHERE shelf_id=?', (shelf,)
                ).fetchall()
            elif aisle:
                rows = conn.execute(
                    "SELECT * FROM erp_inventory WHERE shelf_id LIKE ?",
                    (f"{aisle}-%",)
                ).fetchall()
            else:
                rows = conn.execute('SELECT * FROM erp_inventory').fetchall()
        return jsonify({'ok': True, 'source': 'mock_erp',
                        'count': len(rows),
                        'inventory': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/erp/inventory', methods=['PUT'])
def update_erp_inventory():
    """ERP 재고 수동 업데이트 (테스트용)"""
    try:
        body = request.get_json(force=True) or {}
        shelf_id = body.get('shelf_id')
        if not shelf_id:
            return jsonify({'ok': False, 'error': 'shelf_id 필수'}), 400
        with get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO erp_inventory (shelf_id, pt_number, qty, location, last_updated)
                VALUES (?,?,?,?,?)
            ''', (shelf_id, body.get('pt_number'), int(body.get('qty', 0)),
                  body.get('location', ''), datetime.now().isoformat()))
            conn.commit()
        return jsonify({'ok': True, 'shelf_id': shelf_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ══════════════════════════════════════════════════════════════
# ERP 비교 엔진 API
# ══════════════════════════════════════════════════════════════

@app.route('/api/erp/compare', methods=['POST'])
def erp_compare():
    """
    드론 스캔 결과 vs Mock ERP 재고 비교
    POST body: { session_id: '...' }
    Edge에서 직접 비교 수행 → 결과 DB 저장 → 보고서 반환
    """
    try:
        body       = request.get_json(force=True) or {}
        session_id = body.get('session_id', 'default')
        now        = datetime.now().isoformat()
        result_id  = f"CMP-{uuid.uuid4().hex[:8].upper()}"

        with get_db() as conn:
            # 1. 이번 세션 스캔 결과 가져오기
            scan_rows = conn.execute(
                'SELECT * FROM scan_events WHERE session_id=?', (session_id,)
            ).fetchall()

            # 2. ERP 전체 재고 가져오기
            erp_rows = conn.execute('SELECT * FROM erp_inventory').fetchall()

        scan_map = {r['shelf_id']: dict(r) for r in scan_rows}
        erp_map  = {r['shelf_id']: dict(r) for r in erp_rows}

        # 3. 비교 로직
        match       = []   # 일치
        mismatch    = []   # PT번호 or 수량 불일치
        missing_scan= []   # ERP엔 있는데 스캔 못한 위치
        missing_erp = []   # 스캔됐는데 ERP에 없는 위치
        extra_found = []   # ERP에 없지만 스캔에서 발견 (신규입고 추정)

        all_shelves = set(list(scan_map.keys()) + list(erp_map.keys()))

        for shelf_id in all_shelves:
            scan = scan_map.get(shelf_id)
            erp  = erp_map.get(shelf_id)

            if scan and erp:
                scan_pt  = scan.get('pt_number') or ''
                erp_pt   = erp.get('pt_number') or ''
                scan_qty = int(scan.get('qty') or 0)
                erp_qty  = int(erp.get('qty') or 0)

                # ── 핵심 판정: PT번호 일치 여부 ──────────────────────────
                # PT번호가 같으면 "일치" (qty 차이는 참고용 별도 기록)
                # PT번호가 다르면 "불일치"
                if scan_pt == erp_pt:
                    match.append({
                        'shelf_id':  shelf_id,
                        'pt_number': erp_pt,
                        'scan_qty':  scan_qty,
                        'erp_qty':   erp_qty,
                        'qty_diff':  scan_qty - erp_qty,
                        'location':  erp.get('location', ''),
                    })
                else:
                    mismatch.append({
                        'shelf_id': shelf_id,
                        'location': erp.get('location', ''),
                        'scan': {'pt_number': scan_pt, 'qty': scan_qty},
                        'erp':  {'pt_number': erp_pt,  'qty': erp_qty},
                        'issue': _mismatch_type(scan_pt, erp_pt, scan_qty, erp_qty),
                    })
            elif erp and not scan:
                # ERP엔 재고 있는데 드론이 못 읽음
                if int(erp.get('qty') or 0) > 0:
                    missing_scan.append({
                        'shelf_id': shelf_id,
                        'location': erp.get('location', ''),
                        'erp_pt':  erp.get('pt_number',''),
                        'erp_qty': int(erp.get('qty') or 0),
                    })
            elif scan and not erp:
                # 스캔에선 발견됐는데 ERP에 없음
                if int(scan.get('qty') or 0) > 0:
                    extra_found.append({
                        'shelf_id': shelf_id,
                        'location': scan.get('location', ''),
                        'scan_pt':  scan.get('pt_number',''),
                        'scan_qty': int(scan.get('qty') or 0),
                    })

        total_scanned  = len(scan_map)
        total_erp      = len([e for e in erp_map.values() if int(e.get('qty') or 0) > 0])
        match_count    = len(match)
        mismatch_count = len(mismatch)
        # 정확도: 스캔한 위치 중 ERP PT번호와 일치하는 비율
        # 분모는 스캔 수와 ERP 재고 수 중 큰 값 (전체 커버리지 반영)
        accuracy_base  = max(total_scanned, total_erp, 1)
        accuracy       = round(match_count / accuracy_base * 100, 1)

        result_payload = {
            'result_id':      result_id,
            'session_id':     session_id,
            'compared_at':    now,
            'total_scanned':  total_scanned,
            'total_erp':      total_erp,
            'match_count':    match_count,
            'mismatch_count': mismatch_count,
            'missing_scan':   len(missing_scan),
            'extra_found':    len(extra_found),
            'accuracy_rate':  accuracy,
            'details': {
                'match':        match[:50],
                'mismatch':     mismatch,
                'missing_scan': missing_scan[:50],
                'extra_found':  extra_found[:50],
            },
            'summary': _build_compare_summary(
                accuracy, mismatch, missing_scan, extra_found
            ),
        }

        # 4. 결과 DB 저장
        with get_db() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO erp_compare_results
                (id, session_id, compared_at, total_scanned, match_count,
                 mismatch_count, missing_in_scan, missing_in_erp, accuracy_rate, payload)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            ''', (
                result_id, session_id, now,
                total_scanned, match_count, mismatch_count,
                len(missing_scan), len(extra_found),
                accuracy,
                json.dumps(result_payload, ensure_ascii=False)
            ))
            conn.commit()

        print(f"[ERP Compare] {result_id} — 정확도 {accuracy}% ({match_count}/{total_scanned})")
        return jsonify({'ok': True, 'result': result_payload})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'ok': False, 'error': str(e)}), 500


def _mismatch_type(scan_pt, erp_pt, scan_qty, erp_qty):
    if scan_pt != erp_pt and scan_qty != erp_qty:
        return 'PT번호·수량 불일치'
    if scan_pt != erp_pt:
        return 'PT번호 불일치'
    if scan_qty == 0 and erp_qty > 0:
        return '재고 소진 (ERP 미반영)'
    if scan_qty > erp_qty:
        return f'수량 초과 (+{scan_qty - erp_qty})'
    return f'수량 부족 (-{erp_qty - scan_qty})'


def _build_compare_summary(accuracy, mismatch, missing_scan, extra_found):
    alerts = []
    if accuracy < 90:
        alerts.append({'level': '🔴 긴급', 'msg': f'재고 정확도 {accuracy}% — 즉시 현장 점검 필요'})
    elif accuracy < 95:
        alerts.append({'level': '🟡 주의', 'msg': f'재고 정확도 {accuracy}% — 추가 확인 권고'})
    else:
        alerts.append({'level': '🟢 양호', 'msg': f'재고 정확도 {accuracy}% — 정상 범위'})

    pt_mismatch = [m for m in mismatch if 'PT번호' in m.get('issue','')]
    if pt_mismatch:
        alerts.append({'level': '🔴 긴급',
                       'msg': f'PT번호 불일치 {len(pt_mismatch)}건 — 잘못된 상품 위치 가능성'})
    if missing_scan:
        alerts.append({'level': '🟡 주의',
                       'msg': f'미스캔 위치 {len(missing_scan)}건 — 드론 재순찰 또는 수동 확인 필요'})
    if extra_found:
        alerts.append({'level': '🔵 정보',
                       'msg': f'ERP 미등록 재고 {len(extra_found)}건 — 신규 입고 ERP 반영 필요'})
    return alerts


@app.route('/api/erp/sync', methods=['POST'])
def erp_sync():
    """
    삼성 ERP → Edge DB 동기화 엔드포인트
    실제 환경에서는 삼성 ERP 시스템이 이 API를 호출하거나
    Edge 서버가 ERP API를 polling하여 재고 데이터를 가져옴.
    현재는 Mock ERP 데이터를 그대로 반환 (이미 seed됨).

    POST body: { "force": true }  → 강제 재시드
    """
    try:
        body  = request.get_json(force=True) or {}
        force = body.get('force', False)

        with get_db() as conn:
            cnt = conn.execute('SELECT COUNT(*) FROM erp_inventory').fetchone()[0]
            if cnt == 0 or force:
                # 재시드
                conn.execute('DELETE FROM erp_inventory')
                conn.commit()
                # seed_erp_inventory 재실행
                import random
                rows = []
                for aisle in range(1, 16):
                    for rack in range(1, 21):
                        for side in ['L', 'R']:
                            for layer in ['L1', 'L2']:
                                shelf_id = f"{aisle}-{side}{rack}-{layer}"
                                seed = abs(ord(shelf_id[0]) * 13 + rack * 7)
                                has_item = random.random() > 0.15
                                pt = WAFER_PT_LIST[seed % len(WAFER_PT_LIST)] if has_item else None
                                qty = random.randint(5, 20) if has_item else 0
                                loc = f"Aisle-{aisle} / Rack-{rack} / {'Side A' if side=='L' else 'Side B'} / {layer}"
                                rows.append((shelf_id, pt, qty, loc, datetime.now().isoformat()))
                conn.executemany(
                    'INSERT OR IGNORE INTO erp_inventory (shelf_id, pt_number, qty, location, last_updated) VALUES (?,?,?,?,?)',
                    rows
                )
                conn.commit()
                synced = len(rows)
            else:
                synced = cnt

        return jsonify({
            'ok': True,
            'source': 'samsung_erp_mock',
            'synced_count': synced,
            'synced_at': datetime.now().isoformat(),
            'message': f'ERP → Edge 동기화 완료 ({synced}개 위치)'
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/erp/compare/latest', methods=['GET'])
def get_latest_compare():
    """가장 최근 ERP 비교 결과 조회"""
    try:
        with get_db() as conn:
            row = conn.execute(
                'SELECT * FROM erp_compare_results ORDER BY compared_at DESC LIMIT 1'
            ).fetchone()
        if not row:
            return jsonify({'ok': False, 'error': '비교 결과 없음'}), 404
        r = dict(row)
        try:
            r['data'] = json.loads(r.get('payload') or '{}')
        except Exception:
            r['data'] = {}
        return jsonify({'ok': True, 'result': r['data'], 'meta': {
            k: r[k] for k in ['id','session_id','compared_at','accuracy_rate',
                               'match_count','mismatch_count']
        }})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/erp/compare/history', methods=['GET'])
def compare_history():
    """ERP 비교 이력 조회"""
    try:
        limit = int(request.args.get('limit', 20))
        with get_db() as conn:
            rows = conn.execute('''
                SELECT id, session_id, compared_at, total_scanned,
                       match_count, mismatch_count, missing_in_scan,
                       missing_in_erp, accuracy_rate
                FROM erp_compare_results
                ORDER BY compared_at DESC LIMIT ?
            ''', (limit,)).fetchall()
        return jsonify({'ok': True, 'history': [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    print("=" * 60)
    print("🏭 Warehouse AI Safety System")
    print("=" * 60)
    print("📊 Starting Flask server on http://0.0.0.0:5002")
    print("🌐 Access: http://localhost:5002")
    mail_status = "✅ 설정됨" if (MAIL_PASSWORD and MAIL_PASSWORD != 'placeholder_replace_with_apppassword') else "⚠️  데모 모드 (App Password 미설정)"
    print(f"📧 Email : {mail_status}")
    print("🖨️  MCP   : Auto-print scheduler active (see /mcp)")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5002, debug=False)
