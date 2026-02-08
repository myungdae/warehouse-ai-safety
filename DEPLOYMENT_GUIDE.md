# 🏭 Warehouse AI Safety - 서버 배포 완벽 가이드

## 📋 현재 상황

### ✅ 완료된 작업
- GitHub 리포지토리 생성: `warehouse-ai-safety`
- 센서 모니터링 대시보드 개발 완료
- Flask 앱 (`app.py`) 생성
- 배포 스크립트 작성
- 온톨로지 파일 마이그레이션

### ⚠️ 서버에서 해야 할 일
- Flask 앱을 서버에 배포
- PM2로 프로세스 관리 시작
- warehouse.exko.kr 도메인 연결 확인

---

## 🚀 배포 방법 (3가지 옵션)

### **옵션 1: 최고 간단 버전 (권장) ⭐**

서버에서 이 한 줄만 실행하세요:

```bash
curl -sSL https://raw.githubusercontent.com/myungdae/warehouse-ai-safety/main/QUICK_DEPLOY.sh | bash
```

**설명**: 
- GitHub에서 최신 배포 스크립트를 다운로드하여 자동 실행
- Flask 설치, 파일 복사, PM2 시작까지 모두 자동화
- 약 30초 소요

---

### **옵션 2: Git Clone 후 배포**

```bash
# 1. 기존 디렉토리 삭제 (있다면)
rm -rf ~/warehouse-ai-safety

# 2. GitHub에서 클론
cd ~
git clone https://github.com/myungdae/warehouse-ai-safety.git

# 3. 배포 스크립트 실행
cd warehouse-ai-safety
chmod +x deploy_server.sh
./deploy_server.sh
```

**장점**: Git으로 버전 관리 가능, 업데이트 쉬움

---

### **옵션 3: 수동 배포 (모든 것을 제어)**

```bash
# 1. Flask 설치
pip3 install flask

# 2. 프로젝트 디렉토리 이동
cd ~/warehouse-ai-safety

# 3. 파일 확인
ls -la app.py
ls -la backend/templates/warehouse_digital_twin.html
ls -la backend/static/css/style.css
ls -la backend/static/js/warehouse_sensor.js

# 4. PM2 중지 (기존 프로세스가 있다면)
pm2 delete warehouse-app

# 5. Flask 앱 시작
pm2 start app.py --name warehouse-app --interpreter python3

# 6. PM2 저장
pm2 save

# 7. 상태 확인
pm2 list

# 8. 포트 테스트
curl http://localhost:5002 | head -20
```

**장점**: 각 단계를 직접 확인하며 진행 가능

---

## 🔍 배포 후 확인 사항

### 1️⃣ PM2 상태 확인

```bash
pm2 list
```

**기대 결과**:
```
┌─────┬────────────────┬─────────┬─────────┐
│ id  │ name           │ status  │ cpu     │
├─────┼────────────────┼─────────┼─────────┤
│ 0   │ defcon-webapp  │ online  │ 0%      │  ← 기존
│ 1   │ warehouse-app  │ online  │ 0%      │  ← 신규
└─────┴────────────────┴─────────┴─────────┘
```

---

### 2️⃣ Flask 포트 테스트

```bash
curl -I http://localhost:5002
```

**기대 결과**:
```
HTTP/1.1 200 OK
Server: Werkzeug/3.x.x Python/3.x.x
Content-Type: text/html; charset=utf-8
```

---

### 3️⃣ Nginx 확인

```bash
sudo nginx -t
```

**기대 결과**:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

---

### 4️⃣ DNS 확인

```bash
nslookup warehouse.exko.kr
```

**기대 결과**:
```
Name:   warehouse.exko.kr
Address: 13.209.66.145  ← 서버 공인 IP
```

---

### 5️⃣ HTTPS 접속 확인

```bash
curl -I https://warehouse.exko.kr
```

**기대 결과**:
```
HTTP/2 200
server: nginx/1.24.0
content-type: text/html; charset=utf-8
```

---

## 🛠️ 문제 해결

### ❌ ModuleNotFoundError: No module named 'flask'

**원인**: Flask가 설치되지 않음

**해결**:
```bash
pip3 install flask
# 또는
sudo apt install python3-flask -y
```

---

### ❌ warehouse-app이 errored 상태

**원인**: Flask 앱 실행 중 에러 발생

**해결**:
```bash
# 1. 로그 확인
pm2 logs warehouse-app --lines 50

# 2. 프로세스 삭제
pm2 delete warehouse-app

# 3. 수동으로 실행해서 에러 확인
cd ~/warehouse-ai-safety
python3 app.py

# 4. 에러 해결 후 PM2 재시작
pm2 start app.py --name warehouse-app --interpreter python3
pm2 save
```

---

### ❌ 파일이 없다고 나옴 (FileNotFoundError)

**원인**: 필요한 파일이 서버에 없음

**해결**:
```bash
# defcon에서 파일 복사
cp ~/defcon/defcon-web-app/templates/warehouse_digital_twin.html \
   ~/warehouse-ai-safety/backend/templates/

cp ~/defcon/defcon-web-app/static/css/warehouse.css \
   ~/warehouse-ai-safety/backend/static/css/

cp ~/defcon/defcon-web-app/static/js/warehouse_digital_twin.js \
   ~/warehouse-ai-safety/backend/static/js/

# 또는 GitHub에서 다시 받기
cd ~/warehouse-ai-safety
git pull origin main
```

---

### ❌ port 5002 already in use

**원인**: 다른 프로세스가 포트 5002를 사용 중

**해결**:
```bash
# 포트 사용 중인 프로세스 확인
sudo lsof -i :5002

# PID 확인 후 종료
sudo kill -9 [PID]

# warehouse-app 재시작
pm2 restart warehouse-app
```

---

## 🌐 최종 결과

배포 완료 후 접속 URL:

| 서비스 | URL | 포트 | 상태 |
|--------|-----|------|------|
| **Defcon** (기존) | https://defcon.exko.kr | 5001 | ✅ 영향 없음 |
| **Warehouse** (신규) | https://warehouse.exko.kr | 5002 | ✅ 독립 운영 |

---

## 📞 추가 지원

문제가 계속되면:

1. **PM2 로그 전체 확인**:
   ```bash
   pm2 logs warehouse-app
   ```

2. **Flask 앱을 직접 실행**:
   ```bash
   cd ~/warehouse-ai-safety
   python3 app.py
   ```

3. **에러 메시지를 복사해서 알려주세요**

---

## 📝 체크리스트

배포 전:
- [ ] 서버 SSH 접속 확인
- [ ] Python 3.x 설치 확인: `python3 --version`
- [ ] PM2 설치 확인: `pm2 --version`

배포 중:
- [ ] Flask 설치 완료
- [ ] warehouse-app PM2 시작
- [ ] PM2 상태 `online` 확인
- [ ] 포트 5002 응답 확인

배포 후:
- [ ] defcon-webapp 정상 작동 확인
- [ ] Nginx 설정 정상
- [ ] DNS 전파 확인
- [ ] HTTPS 접속 확인
- [ ] 브라우저에서 센서 대시보드 확인

---

**작성일**: 2026-02-08  
**프로젝트**: Warehouse AI Safety System  
**GitHub**: https://github.com/myungdae/warehouse-ai-safety  
**Demo**: https://warehouse.exko.kr  
**버전**: 1.0.0
