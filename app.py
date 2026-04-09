#!/usr/bin/env python3
"""
Warehouse AI Safety System - Flask Application
Real-time sensor monitoring dashboard + Drone Inventory Intelligence
"""

from flask import Flask, render_template, send_from_directory, request, jsonify
import os
import smtplib
import json
import sqlite3
import contextlib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime
import uuid

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Flask App ──────────────────────────────────────────────────
app = Flask(__name__,
            template_folder='backend/templates',
            static_folder='backend/static')

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
        conn.commit()

# 앱 시작 시 DB 초기화
init_db()

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


if __name__ == '__main__':
    print("=" * 60)
    print("🏭 Warehouse AI Safety System")
    print("=" * 60)
    print("📊 Starting Flask server on http://0.0.0.0:5002")
    print("🌐 Access: http://localhost:5002")
    mail_status = "✅ 설정됨" if (MAIL_PASSWORD and MAIL_PASSWORD != 'placeholder_replace_with_apppassword') else "⚠️  데모 모드 (App Password 미설정)"
    print(f"📧 Email : {mail_status}")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5002, debug=False)
