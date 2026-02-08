#!/bin/bash

# 프로젝트 구조 생성
mkdir -p backend/ontology
mkdir -p backend/static/css
mkdir -p backend/static/js
mkdir -p backend/templates
mkdir -p docs
mkdir -p docs/consultation

echo "✅ 디렉토리 구조 생성 완료"

# defcon에서 파일 복사
SOURCE_DIR="/home/user/webapp"

# 1. 온톨로지 파일들
cp "$SOURCE_DIR/warehouse_traffic_ontology.ttl" backend/ontology/
cp "$SOURCE_DIR/warehouse_traffic_rules.swrl" backend/ontology/
cp "$SOURCE_DIR/warehouse_traffic_validation.shacl" backend/ontology/
cp "$SOURCE_DIR/warehouse_traffic_examples.ttl" backend/ontology/

echo "✅ 온톨로지 파일 복사 완료"

# 2. 웹 리소스
cp "$SOURCE_DIR/defcon-web-app/templates/warehouse_digital_twin.html" backend/templates/
cp "$SOURCE_DIR/defcon-web-app/static/css/warehouse.css" backend/static/css/
cp "$SOURCE_DIR/defcon-web-app/static/js/warehouse_digital_twin.js" backend/static/js/

echo "✅ 웹 리소스 복사 완료"

# 3. 문서들
cp "$SOURCE_DIR/CONSULTATION_WAREHOUSE_DIGITAL_TWIN.md" docs/consultation/
cp "$SOURCE_DIR/ONTOLOGY_EXPLANATION.md" docs/
cp "$SOURCE_DIR/PPT_PRESENTATION_SCRIPT.md" docs/consultation/

echo "✅ 문서 파일 복사 완료"

# 파일 개수 확인
echo ""
echo "📊 복사된 파일 개수:"
echo "  - 온톨로지: $(ls -1 backend/ontology/ | wc -l)개"
echo "  - 웹 리소스: $(find backend/static backend/templates -type f | wc -l)개"
echo "  - 문서: $(find docs -type f | wc -l)개"

