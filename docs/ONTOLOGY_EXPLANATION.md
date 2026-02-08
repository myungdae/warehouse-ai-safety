# 온톨로지 설명서
## Warehouse Traffic Control System Ontology

---

## 📚 목차

1. [온톨로지란?](#온톨로지란)
2. [왜 온톨로지를 사용하나?](#왜-온톨로지를-사용하나)
3. [시스템 아키텍처](#시스템-아키텍처)
4. [핵심 클래스](#핵심-클래스)
5. [프로퍼티 (관계)](#프로퍼티-관계)
6. [SWRL 추론 규칙](#swrl-추론-규칙)
7. [SHACL 정책 검증](#shacl-정책-검증)
8. [실제 사례](#실제-사례)
9. [확장 가능성](#확장-가능성)

---

## 🤔 온톨로지란?

### 일반인 설명
"온톨로지는 **지식을 구조화**하는 방법입니다."

비유하자면:
- **사전**: 단어와 의미를 정의
- **온톨로지**: 개념과 관계를 정의

### 기술적 정의
온톨로지(Ontology)는 특정 도메인의 개념과 그 개념 간의 관계를 형식적으로 표현한 지식 모델입니다.

```turtle
# 예시: 간단한 온톨로지
:Forklift a owl:Class .           # 지게차는 클래스다
:hasSpeed a owl:DatatypeProperty . # 속도 프로퍼티가 있다
:F-07 a :Forklift ;                # F-07은 지게차다
      :hasSpeed 12 .               # F-07의 속도는 12다
```

### 일반 데이터베이스와의 차이

#### 전통적 데이터베이스 (관계형 DB)
```sql
CREATE TABLE forklift (
    id VARCHAR(10),
    speed INT,
    x FLOAT,
    y FLOAT
);

INSERT INTO forklift VALUES ('F-07', 12, 300, 90);
```

**특징:**
- 고정된 스키마
- 단순한 데이터 저장
- 추론 불가능
- 확장 어려움

#### 온톨로지 (시맨틱 웹)
```turtle
:F-07 a :Forklift ;
      :hasSpeed 12 ;
      :hasPosition [ :x 300 ; :y 90 ] ;
      :isApproaching :Intersection-X2 ;
      :hasOperator :Kim .

# 추론 가능
:Intersection-X2 a :BlindCorner .
# → 시스템이 자동으로 "F-07이 블라인드 코너에 접근 중"임을 알아냄
```

**특징:**
- 유연한 구조
- 의미 있는 데이터
- 자동 추론 가능
- 쉬운 확장

---

## 🎯 왜 온톨로지를 사용하나?

### 1️⃣ **설명 가능한 AI (Explainable AI)**

#### 일반 AI (블랙박스)
```python
# 머신러닝 모델
prediction = model.predict(sensor_data)
# → "위험"이라고 예측
# 왜? 모른다. 블랙박스.
```

#### 온톨로지 기반 AI
```turtle
# 추론 과정
:F-07 :hasSpeed 12 .
:F-12 :hasSpeed 15 .
:F-07 :approaching :Intersection-X2 .
:F-12 :approaching :Intersection-X2 .
:Intersection-X2 a :BlindCorner .

# 규칙 적용
IF 두 지게차가 블라인드 코너에 접근 AND 속도 > 8
THEN 충돌 위험 HIGH

# 결과: "왜냐하면 F-07과 F-12가 모두 교차로 X2에 고속으로 접근하기 때문"
```

**장점:**
- 판단 근거 명확
- 법정에서 설명 가능
- 신뢰성 확보

### 2️⃣ **규칙 기반 제어**

#### 하드코딩 방식
```python
# app.py
if forklift1.distance(forklift2) < 50:
    if forklift1.speed > 8 and forklift2.speed > 8:
        if intersection.type == "blind_corner":
            send_command("정지!")
            
# 규칙이 증가하면 코드가 복잡해짐
# 100개 규칙 → 1000줄 코드
```

#### 온톨로지 + SWRL
```swrl
# warehouse_traffic_rules.swrl
Forklift(?f1) ∧ Forklift(?f2) ∧
BlindCorner(?zone) ∧
approaching(?f1, ?zone) ∧ approaching(?f2, ?zone) ∧
hasSpeed(?f1, ?speed1) ∧ greaterThan(?speed1, 8)
→ CollisionRiskEvent(?event) ∧ requiresAction(?event, "정지!")

# 규칙 100개 → 100개 파일
# 코드 수정 없이 규칙만 추가/수정
```

**장점:**
- 규칙과 코드 분리
- 비개발자도 규칙 수정 가능
- 유지보수 쉬움

### 3️⃣ **확장 가능성**

#### 물류센터 → 공장 확장
```turtle
# 물류센터 온톨로지
:Forklift a :MovingEntity .
:PedestrianZone a :Zone .

# 공장 온톨로지 (확장)
:AGV a :MovingEntity .           # AGV도 MovingEntity다
:ProductionLine a :Zone .        # 생산 라인도 Zone이다

# 같은 규칙 재사용!
MovingEntity(?m) ∧ Zone(?z) ∧ isInZone(?m, ?z) ∧ hasSpeed(?m, ?s) ∧ greaterThan(?s, 5)
→ SpeedViolation(?event)
# AGV에도 자동 적용됨!
```

**장점:**
- 한 번 개발, 여러 산업 적용
- 최소한의 수정으로 확장
- 코드 재사용성 극대화

### 4️⃣ **Palantir 스타일**

Palantir는 CIA가 사용하는 데이터 분석 플랫폼입니다.  
핵심은 **"데이터에 의미를 부여"**하는 것입니다.

```
[Palantir 접근]
Raw Data → Ontology → Reasoning → Insight → Action
(센서)    (의미)     (추론)      (통찰)    (행동)

[우리 시스템]
센서 데이터 → 온톨로지 → SWRL 추론 → 위험 판단 → 음성 명령
```

---

## 🏗️ 시스템 아키텍처

### 5-Layer Model (Hydrate → Reason → Activate → Wield)

```
┌─────────────────────────────────────────────┐
│  Layer 5: WIELD (실제 개입)                 │
│  - 음성 명령 송출                            │
│  - 케이스 레코드 생성                        │
│  - 대시보드 업데이트                         │
└─────────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────────┐
│  Layer 4: ACTIVATE (정책 시행)              │
│  - SHACL Validation                         │
│  - 정책 매칭                                 │
│  - 행동 결정                                 │
└─────────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────────┐
│  Layer 3: REASON (추론)                      │
│  - SWRL Rules                                │
│  - 위험 탐지                                 │
│  - 패턴 인식                                 │
└─────────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────────┐
│  Layer 2: HYDRATE (의미 생성)               │
│  - 센서 데이터 → 온톨로지 인스턴스          │
│  - [x:300, y:90] → Forklift(F-07)           │
└─────────────────────────────────────────────┘
                    ↑
┌─────────────────────────────────────────────┐
│  Layer 1: SENSORS (현실 세계)               │
│  - UWB/RTLS: 위치                            │
│  - LiDAR: 거리                               │
│  - CCTV: 영상                                │
└─────────────────────────────────────────────┘
```

---

## 📦 핵심 클래스

### 1️⃣ MovingEntity (움직이는 개체)
```turtle
:MovingEntity a owl:Class ;
    rdfs:label "움직이는 개체"@ko ;
    rdfs:comment "물류센터 내에서 움직이는 모든 것"@ko .

# 하위 클래스
:Forklift rdfs:subClassOf :MovingEntity .
:Pedestrian rdfs:subClassOf :MovingEntity .
:AGV rdfs:subClassOf :MovingEntity .        # 확장 가능
```

#### 왜 MovingEntity로 추상화?

일반적인 설계:
```python
class Forklift:
    def check_speed(self): ...

class Pedestrian:
    def check_speed(self): ...
    
# 중복 코드!
```

온톨로지 설계:
```turtle
:MovingEntity a owl:Class .
:Forklift rdfs:subClassOf :MovingEntity .
:Pedestrian rdfs:subClassOf :MovingEntity .

# 규칙은 MovingEntity에만 적용
MovingEntity(?m) ∧ hasSpeed(?m, ?s) ∧ greaterThan(?s, 10)
→ OverSpeedEvent(?m)

# Forklift와 Pedestrian 모두 자동 적용!
```

### 2️⃣ Zone (구역)
```turtle
:Zone a owl:Class ;
    rdfs:label "구역"@ko .

# 하위 클래스
:BlindCorner rdfs:subClassOf :Zone ;
    rdfs:label "블라인드 코너"@ko ;
    :riskLevel "HIGH"^^xsd:string .

:Intersection rdfs:subClassOf :Zone ;
    rdfs:label "교차로"@ko ;
    :riskLevel "MEDIUM"^^xsd:string .

:PedestrianZone rdfs:subClassOf :Zone ;
    rdfs:label "보행자 구역"@ko ;
    :speedLimit 5^^xsd:integer .

:LoadingDock rdfs:subClassOf :Zone ;
    rdfs:label "적재 구역"@ko ;
    :speedLimit 3^^xsd:integer .
```

### 3️⃣ Event (이벤트)
```turtle
:Event a owl:Class ;
    rdfs:label "이벤트"@ko .

# 하위 클래스
:CollisionRiskEvent rdfs:subClassOf :Event ;
    rdfs:label "충돌 위험 이벤트"@ko .

:ProximityEvent rdfs:subClassOf :Event ;
    rdfs:label "근접 이벤트"@ko .

:SpeedViolationEvent rdfs:subClassOf :Event ;
    rdfs:label "과속 위반 이벤트"@ko .

:SafetyViolationEvent rdfs:subClassOf :Event ;
    rdfs:label "안전 위반 이벤트"@ko .
```

### 4️⃣ Action (행동)
```turtle
:Action a owl:Class ;
    rdfs:label "행동"@ko .

# 하위 클래스
:VoiceCommand rdfs:subClassOf :Action ;
    rdfs:label "음성 명령"@ko .

:SpeedLimit rdfs:subClassOf :Action ;
    rdfs:label "속도 제한"@ko .

:ForcedStop rdfs:subClassOf :Action ;
    rdfs:label "강제 정지"@ko .

:AreaRestriction rdfs:subClassOf :Action ;
    rdfs:label "구역 제한"@ko .
```

---

## 🔗 프로퍼티 (관계)

### Object Properties (객체 간 관계)
```turtle
# 위치 관계
:isInZone a owl:ObjectProperty ;
    rdfs:domain :MovingEntity ;
    rdfs:range :Zone ;
    rdfs:label "구역에 있음"@ko .

:approaching a owl:ObjectProperty ;
    rdfs:domain :MovingEntity ;
    rdfs:range :Zone ;
    rdfs:label "접근 중"@ko .

# 소유 관계
:hasOperator a owl:ObjectProperty ;
    rdfs:domain :Forklift ;
    rdfs:range :Operator ;
    rdfs:label "운전자가 있음"@ko .

# 이벤트 관계
:hasRiskLevel a owl:ObjectProperty ;
    rdfs:domain :Event ;
    rdfs:range :RiskLevel ;
    rdfs:label "위험 레벨"@ko .

:requiresAction a owl:ObjectProperty ;
    rdfs:domain :Event ;
    rdfs:range :Action ;
    rdfs:label "행동 필요"@ko .
```

### Datatype Properties (데이터 속성)
```turtle
# 물리적 속성
:hasSpeed a owl:DatatypeProperty ;
    rdfs:domain :MovingEntity ;
    rdfs:range xsd:integer ;
    rdfs:label "속도"@ko .

:hasDirection a owl:DatatypeProperty ;
    rdfs:domain :MovingEntity ;
    rdfs:range xsd:integer ;  # 0-360도
    rdfs:label "방향"@ko .

# 위치 속성
:hasPosition a owl:ObjectProperty ;
    rdfs:domain :MovingEntity ;
    rdfs:range :Position .

:Position a owl:Class ;
    owl:equivalentClass [
        a owl:Restriction ;
        owl:onProperty :x ;
        owl:cardinality 1
    ] , [
        a owl:Restriction ;
        owl:onProperty :y ;
        owl:cardinality 1
    ] .

:x a owl:DatatypeProperty ;
    rdfs:range xsd:float .

:y a owl:DatatypeProperty ;
    rdfs:range xsd:float .

# 시간 속성
:detectedAt a owl:DatatypeProperty ;
    rdfs:domain :Event ;
    rdfs:range xsd:dateTime ;
    rdfs:label "감지 시각"@ko .
```

---

## 🧠 SWRL 추론 규칙

### Rule 1: 블라인드 코너 충돌 위험

#### 자연어
"만약 두 지게차가 블라인드 코너에 동시에 접근하고, 두 지게차의 속도가 모두 8km/h를 초과한다면, 충돌 위험 레벨 HIGH 이벤트를 생성하고 DIRECTIVE 음성 명령을 발령한다."

#### SWRL
```swrl
Forklift(?f1) ∧ Forklift(?f2) ∧ differentFrom(?f1, ?f2) ∧
BlindCorner(?zone) ∧
approaching(?f1, ?zone) ∧ approaching(?f2, ?zone) ∧
hasSpeed(?f1, ?speed1) ∧ greaterThan(?speed1, 8) ∧
hasSpeed(?f2, ?speed2) ∧ greaterThan(?speed2, 8)
→
CollisionRiskEvent(?event) ∧
involves(?event, ?f1) ∧ involves(?event, ?f2) ∧
hasRiskLevel(?event, "HIGH") ∧
requiresAction(?event, "DIRECTIVE") ∧
hasCommand(?event, "정지. 교차로 확인")
```

#### Python 실행 (owlready2)
```python
from owlready2 import *

# 온톨로지 로드
onto = get_ontology("warehouse_traffic_ontology.ttl").load()

# SWRL 규칙 정의
rule = Imp()
rule.set_as_rule("""
    Forklift(?f1), Forklift(?f2), differentFrom(?f1, ?f2),
    BlindCorner(?zone),
    approaching(?f1, ?zone), approaching(?f2, ?zone),
    hasSpeed(?f1, ?speed1), greaterThan(?speed1, 8),
    hasSpeed(?f2, ?speed2), greaterThan(?speed2, 8)
    -> CollisionRiskEvent(?event),
       involves(?event, ?f1), involves(?event, ?f2),
       hasRiskLevel(?event, 'HIGH')
""")

# 추론 실행
sync_reasoner_pellet(infer_property_values=True, infer_data_property_values=True)

# 결과 확인
collision_events = onto.CollisionRiskEvent.instances()
for event in collision_events:
    print(f"충돌 위험: {event.involves}, 레벨: {event.hasRiskLevel}")
```

### Rule 2: 지게차-보행자 근접

#### 자연어
"만약 지게차와 보행자의 거리가 3미터 이내이고, 지게차의 속도가 5km/h를 초과한다면, CRITICAL 레벨 근접 이벤트를 생성하고 ENFORCEMENT 강제 정지 명령을 발령한다."

#### SWRL
```swrl
Forklift(?f) ∧ Pedestrian(?p) ∧
distance(?f, ?p, ?dist) ∧ lessThan(?dist, 3) ∧
hasSpeed(?f, ?speed) ∧ greaterThan(?speed, 5)
→
ProximityEvent(?event) ∧
involves(?event, ?f) ∧ involves(?event, ?p) ∧
hasRiskLevel(?event, "CRITICAL") ∧
requiresAction(?event, "ENFORCEMENT") ∧
hasCommand(?event, "긴급정지! 보행자!") ∧
setSpeedLimit(?f, 0)
```

### Rule 3: 보행자 구역 과속

#### 자연어
"만약 지게차가 보행자 구역 내에 있고, 속도가 5km/h를 초과한다면, MEDIUM 레벨 과속 이벤트를 생성하고 DIRECTIVE 감속 명령을 발령하며 속도를 5km/h로 제한한다."

#### SWRL
```swrl
Forklift(?f) ∧ PedestrianZone(?zone) ∧
isInZone(?f, ?zone) ∧
hasSpeed(?f, ?speed) ∧ greaterThan(?speed, 5)
→
SpeedViolationEvent(?event) ∧
involves(?event, ?f) ∧
hasRiskLevel(?event, "MEDIUM") ∧
requiresAction(?event, "DIRECTIVE") ∧
hasCommand(?event, "감속. 보행자 구역") ∧
setSpeedLimit(?f, 5)
```

---

## ✅ SHACL 정책 검증

### Policy 1: 보행자 구역 속도 제한

#### 자연어 정책
"보행자 구역 내 모든 지게차는 5km/h 이하로 운행해야 한다.  
위반 시 경고 메시지 발령."

#### SHACL Shape
```turtle
:PedestrianZoneSpeedLimitShape
    a sh:NodeShape ;
    sh:targetClass :Forklift ;
    sh:message "보행자 구역 속도 제한 위반"@ko ;
    sh:severity sh:Violation ;
    
    # 조건: 보행자 구역에 있는 경우
    sh:property [
        sh:path :isInZone ;
        sh:qualifiedValueShape [
            sh:class :PedestrianZone
        ] ;
        sh:qualifiedMinCount 1 ;
    ] ;
    
    # 검증: 속도 <= 5
    sh:property [
        sh:path :hasSpeed ;
        sh:maxInclusive 5 ;
        sh:message "속도는 5km/h 이하여야 합니다"@ko ;
    ] .
```

#### Python 실행 (pySHACL)
```python
from pyshacl import validate

# 데이터 그래프
data_graph = """
@prefix : <http://example.org/warehouse#> .

:F-07 a :Forklift ;
      :isInZone :PedZone-1 ;
      :hasSpeed 15 .

:PedZone-1 a :PedestrianZone .
"""

# SHACL 그래프
shacl_graph = """
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix : <http://example.org/warehouse#> .

:PedestrianZoneSpeedLimitShape
    a sh:NodeShape ;
    sh:targetClass :Forklift ;
    sh:property [
        sh:path :hasSpeed ;
        sh:maxInclusive 5 ;
        sh:message "속도 위반: 5km/h 이하" ;
    ] .
"""

# 검증 실행
conforms, results_graph, results_text = validate(
    data_graph,
    shacl_graph=shacl_graph,
    inference='rdfs'
)

if not conforms:
    print(results_text)
    # 출력: "F-07: 속도 위반: 5km/h 이하"
```

---

## 💡 실제 사례

### 시나리오 1: 충돌 위험 감지

#### 1. 센서 데이터 입력
```json
{
  "timestamp": "2026-02-08T12:00:00Z",
  "sensors": [
    {
      "type": "UWB",
      "forklift_id": "F-07",
      "position": {"x": 450, "y": 90},
      "speed": 12,
      "direction": 0
    },
    {
      "type": "UWB",
      "forklift_id": "F-12",
      "position": {"x": 500, "y": 30},
      "speed": 15,
      "direction": 90
    }
  ]
}
```

#### 2. Hydrate (온톨로지 변환)
```turtle
:F-07 a :Forklift ;
      :hasPosition [ :x 450 ; :y 90 ] ;
      :hasSpeed 12 ;
      :hasDirection 0 ;
      :approaching :Intersection-X2 .

:F-12 a :Forklift ;
      :hasPosition [ :x 500 ; :y 30 ] ;
      :hasSpeed 15 ;
      :hasDirection 90 ;
      :approaching :Intersection-X2 .

:Intersection-X2 a :BlindCorner .
```

#### 3. Reason (SWRL 추론)
```
Rule 적용:
- ✅ F-07는 Forklift
- ✅ F-12는 Forklift  
- ✅ 둘 다 BlindCorner (Intersection-X2)에 approaching
- ✅ F-07 속도 12 > 8
- ✅ F-12 속도 15 > 8

→ 충돌 위험 HIGH 이벤트 생성!
```

#### 4. Activate (SHACL 정책)
```turtle
:CollisionEvent-001 a :CollisionRiskEvent ;
    :involves :F-07, :F-12 ;
    :hasRiskLevel "HIGH" ;
    :requiresAction "DIRECTIVE" ;
    :hasCommand "정지. 교차로 확인" .
```

#### 5. Wield (실제 개입)
```python
# 음성 명령 발령
play_voice_command("F 대시 07", "정지! 교차로 확인!")
play_voice_command("F 대시 12", "정지! 교차로 확인!")

# 케이스 레코드 생성
create_case_record({
    "event_id": "CollisionEvent-001",
    "timestamp": "2026-02-08T12:00:00Z",
    "entities": ["F-07", "F-12"],
    "risk_level": "HIGH",
    "action_taken": "DIRECTIVE voice command",
    "command": "정지. 교차로 확인",
    "outcome": "Collision prevented"
})

# 대시보드 업데이트
update_dashboard({
    "prevented_collisions": increment(1),
    "event_log": append("CollisionEvent-001")
})
```

---

## 🌟 확장 가능성

### 물류센터 → 공장

#### 최소 변경으로 확장
```turtle
# 기존 온톨로지 (재사용)
:MovingEntity a owl:Class .
:Zone a owl:Class .

# 새로운 클래스 추가 (확장)
:AGV rdfs:subClassOf :MovingEntity ;
    rdfs:label "무인 운반차"@ko .

:RobotArm rdfs:subClassOf :MovingEntity ;
    rdfs:label "로봇팔"@ko .

:ProductionLine rdfs:subClassOf :Zone ;
    rdfs:label "생산 라인"@ko ;
    :speedLimit 3 .

# 기존 규칙 자동 적용!
MovingEntity(?m) ∧ Zone(?z) ∧ isInZone(?m, ?z) ∧ hasSpeed(?m, ?s) ∧ greaterThan(?s, 5)
→ SpeedViolation(?event)
# AGV와 RobotArm에도 자동 적용됨!
```

### 물류센터 → 항만
```turtle
# 새로운 클래스
:YardTractor rdfs:subClassOf :MovingEntity .
:ContainerCrane rdfs:subClassOf :MovingEntity .
:QuaySide rdfs:subClassOf :Zone ;
    :speedLimit 10 .

# 기존 충돌 방지 규칙 그대로 사용
```

### 물류센터 → 공항
```turtle
# 새로운 클래스
:BaggageCart rdfs:subClassOf :MovingEntity .
:FuelTruck rdfs:subClassOf :MovingEntity .
:Taxiway rdfs:subClassOf :Zone ;
    :speedLimit 20 .

# 기존 규칙 재사용
```

---

## 📚 참고 자료

### 온톨로지 파일들
- `warehouse_traffic_ontology.ttl`: 클래스 및 프로퍼티 정의
- `warehouse_traffic_rules.swrl`: SWRL 추론 규칙 (12개)
- `warehouse_traffic_validation.shacl`: SHACL 정책 (6개)
- `warehouse_traffic_examples.ttl`: 예제 데이터

### 표준 및 기술
- **RDF**: Resource Description Framework
- **OWL**: Web Ontology Language
- **SWRL**: Semantic Web Rule Language
- **SHACL**: Shapes Constraint Language
- **SPARQL**: RDF 쿼리 언어

### 도구
- **Protégé**: 온톨로지 편집기
- **owlready2**: Python OWL 라이브러리
- **pySHACL**: Python SHACL 검증
- **Apache Jena**: Java 시맨틱 웹 프레임워크

---

## 🎯 핵심 요약

### 온톨로지를 쓰는 이유 (3줄 요약)
1. **설명 가능**: 왜 그 판단을 내렸는지 명확히 설명
2. **확장 가능**: 한 번 개발, 여러 산업 적용
3. **유지보수 쉬움**: 코드 수정 없이 규칙만 변경

### 시스템 흐름 (5단어)
**센서 → 의미 → 추론 → 정책 → 행동**

### 핵심 메시지
"데이터에 의미를 부여하면, 기계가 추론할 수 있습니다."

---

이것이 온톨로지입니다. 🚀
