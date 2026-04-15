#!/bin/bash
# =========================================================
# Gotham AIP 서버 수정 스크립트
# 실행: bash fix_gotham_server.sh
# =========================================================
set -e

VENV="/home/ubuntu/defcon/defcon-web-app/venv"
GOTHAM_DIR="/home/ubuntu/defcon/defcon-web-app/gotham"

echo "=== [1/4] uvicorn[standard] + websockets 설치 ==="
$VENV/bin/pip install "uvicorn[standard]" websockets -q
echo "✅ 설치 완료"

echo ""
echo "=== [2/4] 기존 gotham-api pm2 프로세스 삭제 ==="
pm2 delete gotham-api 2>/dev/null || true

echo ""
echo "=== [3/4] gotham-api pm2 재시작 ==="
pm2 start \
  "$VENV/bin/python3 -m uvicorn gotham_backend:app --host 0.0.0.0 --port 8766" \
  --name "gotham-api" \
  --cwd "$GOTHAM_DIR"
pm2 save

echo ""
echo "=== [4/4] 헬스체크 ==="
sleep 3
curl -s http://localhost:8766/api/health | python3 -m json.tool || echo "❌ 헬스체크 실패 — pm2 logs gotham-api --lines 20 확인"

echo ""
pm2 status gotham-api
