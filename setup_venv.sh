#!/bin/bash
# ══════════════════════════════════════════════════════════════
# setup_venv.sh — warehouse-ai-safety venv 설치 스크립트
# Ubuntu 22.04 / Python 3.12 (externally-managed-environment 대응)
# 사용법: bash setup_venv.sh
# ══════════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================="
echo "🏭 Warehouse AI Safety — venv 설치"
echo "=================================================="
echo "📁 경로: $SCRIPT_DIR"

# ── 1. 시스템 의존성 설치 ──────────────────────────────────────
echo ""
echo "📦 [1/5] 시스템 패키지 설치..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
    python3-full \
    python3-venv \
    python3-dev \
    build-essential \
    libzbar0 \
    libzbar-dev \
    libgl1 \
    libgl1-mesa-dri \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    ffmpeg
echo "✅ 시스템 패키지 설치 완료"

# ── 2. venv 생성 ───────────────────────────────────────────────
echo ""
echo "🐍 [2/5] Python venv 생성..."
if [ -d "venv" ]; then
    echo "  ℹ️  기존 venv 발견 — 재사용"
else
    python3 -m venv venv
    echo "  ✅ venv 생성 완료"
fi

# ── 3. pip 업그레이드 ──────────────────────────────────────────
echo ""
echo "⬆️  [3/5] pip 업그레이드..."
venv/bin/pip install --upgrade pip --quiet
echo "  ✅ pip $(venv/bin/pip --version | awk '{print $2}')"

# ── 4. 패키지 설치 ────────────────────────────────────────────
echo ""
echo "📥 [4/5] Python 패키지 설치 (시간이 걸릴 수 있습니다)..."
echo "  → flask, opencv-python-headless, pyzbar, easyocr 등"

# 기본 패키지 먼저
venv/bin/pip install --quiet \
    flask>=3.0.0 \
    flask-cors>=4.0.0 \
    gunicorn>=21.2.0 \
    python-dotenv>=1.0.0 \
    Pillow>=10.0.0 \
    requests>=2.31.0

echo "  ✅ Flask / 기본 패키지 완료"

# OpenCV (headless — GUI 불필요)
venv/bin/pip install --quiet opencv-python-headless
echo "  ✅ OpenCV 완료"

# pyzbar (libzbar0 필요 — 위에서 apt로 설치)
venv/bin/pip install --quiet pyzbar
echo "  ✅ pyzbar 완료"

# EasyOCR (PyTorch CPU 포함 — 크기가 크므로 마지막)
echo "  ⏳ EasyOCR 설치 중 (PyTorch CPU 다운로드, 약 1~3분)..."
venv/bin/pip install --quiet easyocr
echo "  ✅ EasyOCR 완료"

# ── 5. PM2 재시작 ─────────────────────────────────────────────
echo ""
echo "🔄 [5/5] PM2 warehouse-app 재시작..."
if command -v pm2 &>/dev/null; then
    pm2 restart warehouse-app 2>/dev/null || \
    pm2 start ecosystem.config.js --only warehouse-app
    sleep 2
    pm2 status warehouse-app
    echo "  ✅ PM2 재시작 완료"
else
    echo "  ⚠️  PM2 없음 — 수동 시작: venv/bin/python app.py"
fi

echo ""
echo "=================================================="
echo "✅ 설치 완료!"
echo ""
echo "  테스트:"
echo "  curl http://localhost:5002/api/video-scan/status"
echo ""
echo "  서버 라이브러리 확인:"
echo "  venv/bin/python -c \\"
echo "    \"import cv2, pyzbar, easyocr; print('모두 설치됨')\""
echo "=================================================="
