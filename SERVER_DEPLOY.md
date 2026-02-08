# 🚀 서버 배포 가이드

## 📦 필요한 파일

다음 파일들이 서버에 있어야 합니다:

```
warehouse-ai-safety/
├── app.py                                    # Flask 앱
├── backend/
│   ├── ontology/                             # 온톨로지 파일들
│   ├── static/
│   │   ├── css/
│   │   │   ├── style.css                     # 기본 스타일
│   │   │   ├── warehouse.css                 # 창고 스타일
│   │   │   └── warehouse_sensor.css          # 센서 대시보드 스타일
│   │   └── js/
│   │       └── warehouse_sensor.js           # 센서 대시보드 JS
│   └── templates/
│       └── warehouse_digital_twin.html       # 메인 HTML
└── deploy_server.sh                          # 배포 스크립트
```

---

## 🚀 빠른 배포 (권장)

### 방법 1: 자동 배포 스크립트 사용

```bash
# 서버에 SSH 접속
ssh ubuntu@defcon.exko.kr

# 프로젝트 디렉토리로 이동
cd ~/warehouse-ai-safety

# 배포 스크립트 실행
chmod +x deploy_server.sh
./deploy_server.sh
```

### 방법 2: 수동 배포

```bash
# 1. Flask 설치
pip3 install flask

# 2. PM2 프로세스 삭제 (있다면)
pm2 delete warehouse-app

# 3. Flask 앱 시작
cd ~/warehouse-ai-safety
pm2 start app.py --name warehouse-app --interpreter python3

# 4. PM2 저장
pm2 save

# 5. 상태 확인
pm2 list

# 6. 포트 테스트
curl http://localhost:5002 | head -20
```

---

## 🔧 문제 해결

### ❌ ModuleNotFoundError: No module named 'flask'

```bash
# 해결 방법 1: pip3로 설치
pip3 install flask

# 해결 방법 2: apt로 설치
sudo apt install python3-flask -y
```

### ❌ warehouse-app이 errored 상태

```bash
# 로그 확인
pm2 logs warehouse-app --lines 50

# 프로세스 삭제 후 재시작
pm2 delete warehouse-app
cd ~/warehouse-ai-safety
pm2 start app.py --name warehouse-app --interpreter python3
pm2 save
```

### ❌ 포트 5002에 접속 안됨

```bash
# 포트 사용 확인
sudo netstat -tlnp | grep :5002

# PM2 상태 확인
pm2 list

# 로그 확인
pm2 logs warehouse-app
```

### ❌ Nginx 502 Bad Gateway

```bash
# Flask 앱이 실행 중인지 확인
curl http://localhost:5002

# Nginx 설정 확인
sudo nginx -t

# Nginx 재시작
sudo systemctl reload nginx
```

---

## 📊 배포 확인 체크리스트

- [ ] Flask 설치 완료: `python3 -c "import flask; print('OK')"`
- [ ] warehouse-app 실행 중: `pm2 list | grep warehouse-app`
- [ ] 포트 5002 응답: `curl http://localhost:5002`
- [ ] defcon-webapp 정상: `pm2 list | grep defcon-webapp`
- [ ] Nginx 설정 정상: `sudo nginx -t`
- [ ] DNS 전파 완료: `nslookup warehouse.exko.kr`
- [ ] HTTPS 접속: `curl -I https://warehouse.exko.kr`

---

## 🌐 최종 결과

배포 완료 후:

- **Defcon (기존)**: https://defcon.exko.kr — 포트 5001 — 영향 없음 ✅
- **Warehouse (신규)**: https://warehouse.exko.kr — 포트 5002 — 독립 운영 ✅

---

## 📞 지원

문제가 발생하면:

1. PM2 로그 확인: `pm2 logs warehouse-app`
2. Flask 수동 실행: `python3 app.py`
3. 에러 메시지를 복사해서 알려주세요

---

**작성일**: 2026-02-08  
**프로젝트**: Warehouse AI Safety System  
**버전**: 1.0.0
