# 🚀 Warehouse AI Safety - GitHub 리포지토리 생성 가이드

## ✅ **Step 1: GitHub에서 새 리포지토리 생성**

**수동으로 생성 (권장)**:
1. 브라우저에서 https://github.com/new 접속
2. 다음 정보 입력:
   - **Repository name**: `warehouse-ai-safety`
   - **Description**: `AI-powered Warehouse Safety System with Ontology-based Decision Support`
   - **Visibility**: Public (또는 Private)
   - **⚠️ 중요**: "Initialize this repository with a README" 체크하지 마세요!
3. "Create repository" 버튼 클릭

---

## ✅ **Step 2: 로컬 프로젝트 확인**

프로젝트가 정상적으로 생성되었는지 확인:

```bash
cd /home/user/warehouse-ai-safety
ls -la
```

**예상 출력**:
```
.gitignore
LICENSE
README.md
backend/
  ontology/
    warehouse_traffic_ontology.ttl
    warehouse_traffic_rules.swrl
    warehouse_traffic_validation.shacl
    warehouse_traffic_examples.ttl
  static/
    css/warehouse.css
    js/warehouse_digital_twin.js
  templates/
    warehouse_digital_twin.html
docs/
  ONTOLOGY_EXPLANATION.md
  consultation/
    CONSULTATION_WAREHOUSE_DIGITAL_TWIN.md
    PPT_PRESENTATION_SCRIPT.md
```

---

## ✅ **Step 3: Git 커밋 확인**

```bash
cd /home/user/warehouse-ai-safety
git log --oneline
```

**예상 출력**:
```
9bd9981 (HEAD -> master) Initial commit: Warehouse AI Safety System PoC
```

---

## ✅ **Step 4: GitHub Remote 추가 및 푸시**

```bash
cd /home/user/warehouse-ai-safety

# Remote 추가
git remote add origin https://github.com/myungdae/warehouse-ai-safety.git

# Remote 확인
git remote -v

# Branch 이름 변경 (master → main)
git branch -M main

# 푸시
git push -u origin main
```

---

## ⚠️ **문제 해결**

### **문제 1: 인증 실패**
```
remote: Invalid username or token
```

**해결책**:
GitHub Personal Access Token 사용

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token (classic)" 클릭
3. 권한 선택: `repo` (전체)
4. 토큰 복사
5. 푸시 시 비밀번호 대신 토큰 입력

---

### **문제 2: Repository already exists**
```
remote: Repository already exists
```

**해결책**:
기존 리포지토리 삭제 후 다시 생성하거나, 다른 이름 사용

```bash
# Remote URL 변경
git remote set-url origin https://github.com/myungdae/warehouse-ai-safety-v2.git
```

---

### **문제 3: Branch 이름 충돌**
```
error: src refspec main does not match any
```

**해결책**:
```bash
# 현재 브랜치 확인
git branch

# master를 main으로 변경
git branch -M main

# 다시 푸시
git push -u origin main
```

---

## ✅ **Step 5: 푸시 성공 확인**

푸시 후 브라우저에서 확인:
```
https://github.com/myungdae/warehouse-ai-safety
```

**예상 화면**:
- README.md가 메인 페이지에 표시됨
- 14 files, 6414+ lines of code
- LICENSE, .gitignore 등 모든 파일 확인 가능

---

## 📊 **최종 확인 체크리스트**

- [ ] GitHub에 리포지토리가 생성되었는가?
- [ ] README.md가 제대로 표시되는가?
- [ ] 모든 파일이 업로드되었는가? (14개)
- [ ] LICENSE 파일이 있는가?
- [ ] .gitignore가 작동하는가?
- [ ] backend/ontology/ 폴더에 TTL, SWRL, SHACL 파일이 있는가?
- [ ] docs/ 폴더에 문서들이 있는가?

---

## 🎉 **성공!**

이제 `warehouse-ai-safety` 리포지토리가 GitHub에 공개되었습니다!

**다음 단계**:
1. README.md에 배포 URL 추가
2. GitHub Issues로 태스크 관리
3. GitHub Actions로 CI/CD 구성
4. GitHub Pages로 문서 호스팅

---

## 🔗 **관련 링크**

- **이 프로젝트**: https://github.com/myungdae/warehouse-ai-safety
- **원본 프로젝트**: https://github.com/myungdae/defcon
- **이슈 트래커**: https://github.com/myungdae/warehouse-ai-safety/issues

---

**문서 작성 완료 시각**: 2026-02-08
