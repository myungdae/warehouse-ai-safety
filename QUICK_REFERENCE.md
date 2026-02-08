# 🚀 Quick Reference Card

## 서버에서 바로 실행 (복사 → 붙여넣기)

### ⚡ 최고 빠른 방법 (30초)
```bash
curl -sSL https://raw.githubusercontent.com/myungdae/warehouse-ai-safety/main/QUICK_DEPLOY.sh | bash
```

### 📦 Git Clone 방법 (1분)
```bash
git clone https://github.com/myungdae/warehouse-ai-safety.git
cd warehouse-ai-safety
chmod +x deploy_server.sh
./deploy_server.sh
```

### 🔧 수동 방법 (2분)
```bash
pip3 install flask
cd ~/warehouse-ai-safety
pm2 delete warehouse-app
pm2 start app.py --name warehouse-app --interpreter python3
pm2 save
```

---

## ✅ 확인 명령어

```bash
# PM2 상태
pm2 list

# Flask 응답
curl http://localhost:5002 | head -10

# HTTPS 확인
curl -I https://warehouse.exko.kr

# DNS 확인
nslookup warehouse.exko.kr

# 로그 확인
pm2 logs warehouse-app
```

---

## 🌐 접속 URL

- **Warehouse**: https://warehouse.exko.kr
- **Defcon**: https://defcon.exko.kr

---

## 🛠️ 문제 해결

```bash
# Flask 미설치
pip3 install flask

# 프로세스 재시작
pm2 delete warehouse-app
pm2 start app.py --name warehouse-app --interpreter python3
pm2 save

# 로그 확인
pm2 logs warehouse-app --lines 50

# 직접 실행 (에러 확인용)
cd ~/warehouse-ai-safety
python3 app.py
```

---

## 📞 지원

문제 발생 시:
1. 로그 확인: `pm2 logs warehouse-app`
2. 수동 실행: `python3 app.py`
3. 에러 메시지를 복사해서 알려주세요

---

**프로젝트**: Warehouse AI Safety System  
**GitHub**: https://github.com/myungdae/warehouse-ai-safety  
**Demo**: https://warehouse.exko.kr  
**날짜**: 2026-02-08
