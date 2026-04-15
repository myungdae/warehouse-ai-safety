#!/bin/bash
# =========================================================
# Gotham AIP 서버 수정 스크립트 v2
# 실행: bash fix_gotham_server.sh
# =========================================================

VENV="/home/ubuntu/defcon/defcon-web-app/venv"
GOTHAM_DIR="/home/ubuntu/defcon/defcon-web-app/gotham"
PYTHON="$VENV/bin/python3"
UVICORN="$VENV/bin/uvicorn"

echo "=== [1/5] 패키지 설치 ==="
$PYTHON -m pip install "uvicorn[standard]" websockets fastapi pydantic -q
echo "✅ 설치 완료"
$UVICORN --version

echo ""
echo "=== [2/5] 기존 gotham-api 삭제 ==="
pm2 delete gotham-api 2>/dev/null || true
sleep 1

echo ""
echo "=== [3/5] gotham 디렉토리 최신화 ==="
# warehouse-ai-safety의 최신 gotham_backend.py를 defcon-web-app에 복사
cp /home/ubuntu/warehouse-ai-safety/backend/gotham/gotham_backend.py "$GOTHAM_DIR/gotham_backend.py"
echo "✅ gotham_backend.py 복사 완료 ($(wc -l < $GOTHAM_DIR/gotham_backend.py) lines)"

echo ""
echo "=== [4/5] pm2 시작 (uvicorn 직접 실행) ==="
pm2 start "$UVICORN" \
  --name "gotham-api" \
  --cwd "$GOTHAM_DIR" \
  --interpreter "$PYTHON" \
  -- gotham_backend:app --host 0.0.0.0 --port 8766
pm2 save
echo "✅ pm2 등록 완료"

echo ""
echo "=== [5/5] 헬스체크 (10초 대기) ==="
sleep 10
HEALTH=$(curl -s --max-time 5 http://localhost:8766/api/health)
if echo "$HEALTH" | grep -q '"status"'; then
  echo "✅ 백엔드 정상:"
  echo "$HEALTH" | python3 -m json.tool
else
  echo "❌ 헬스체크 실패 — 로그 확인:"
  pm2 logs gotham-api --lines 30 --nostream
fi
