# warehouse-ai-safety
Project Status

---

## Project Goal

Warehouse AI Safety Platform

SensorObservation 기반 Runtime Operational Safety Pipeline

모든 위험 이벤트는 다음 파이프라인을 따른다.

### Current Architecture

Sensor
→ Observation
→ Risk
→ Policy
→ Action
→ Execution
→ Runtime Event Graph
→ Runtime Operational Triple

RiskEvent 상태 전이는 `NEW → ACTIVE → ACKNOWLEDGED → CLEARED`를 사용한다.

---

## Completed

### SensorObservation Framework
- [x] SensorObservation 생성
- [x] Observation Metadata
- [x] Observation → RiskSignal 변환
- [x] RiskEventStateMachine 연결

### Safety Events

- [x] DANGEROUS_TILT
- [x] HARD_ACCELERATION
- [x] HARD_BRAKING
- [x] TURN_RATE / SHARP_TURN
- [x] HUMAN_PROXIMITY
- [x] DROWSINESS
- [x] INCAPACITATION
- [x] ALCOHOL_LEVEL

HUMAN_PROXIMITY targetId

`forkliftId|personId` 복합 형식

Driver State targetId

`vehicleId|driverId|driverAssignmentId` 복합 형식

### Runtime Components

- [x] SensorObservation
- [x] RiskEventStateMachine
- [x] Driver Runtime
- [x] Driver Runtime Policy Engine
- [x] Driver Action Dispatcher Simulation
- [x] Runtime Event Graph
- [x] Runtime Operational Triple Engine

### Export Support

- [x] Runtime Graph JSON
- [x] Runtime Triple JSON
- [x] Runtime Triple Turtle 문자열

Turtle export는 문자열 생성 범위이며 실제 RDF 저장소 또는 SPARQL endpoint와 연결되지 않는다.

### Vehicle Independence

Driver Runtime은 `VehicleContext`를 사용하며 차량별 센서 구현과 분리된 공통 구조다.

지원 `VehicleType`

- `FORKLIFT`
- `BOX_TRUCK`
- `CARGO_TRUCK`
- `BUS`
- `SPECIAL_VEHICLE`

현재 deterministic runtime 검증은 주로 `FORKLIFT` context를 사용한다.

### Simulation Scope

- `simulation=true`
- `operationalUseAllowed=false`
- 실제 센서 미연결
- 실제 CAN 미연결
- 실제 MediaPipe 미연결
- 실제 Alcohol Sensor 미연결
- 실제 Actuator 미연결
- 외부 notification 및 차량 제어 미연결

---

## Current Stable Commit

HEAD

d8614924a752a3e63cb2012eb7e14ec6cfbdd9cd

Last Commit Message

Add runtime operational triple engine

Branch

`codex/cleanup-digital-twin-js`

Git Status

Clean (`PROJECT_STATUS.md` 갱신 전)

Push

Not Performed

AWS

Not Performed

---

## Next Phase

Future Work이며 아직 구현되지 않았다.

- MediaPipe Adapter
- Alcohol Sensor Adapter
- CAN Adapter
- MQTT / REST Dispatcher
- 실제 Actuator 연결

### Vehicle Reuse

지게차뿐 아니라 탑차, 화물차, 버스, 특수차량에 재사용 가능한 공통 운전자 상태 모듈

---

## Development Rules

새 작업 전

- `PROJECT_STATUS.md` 읽기
- 현재 HEAD 확인
- Git Clean 유지
- 관련 회귀 테스트 수행
- Push 금지 (승인 전)
- AWS 배포 금지 (승인 전)

Workflow

기능별 분석
→ 구현
→ 검증
→ 로컬 커밋

Do NOT

- Push to GitHub
- Deploy to AWS

명시적 요청 전까지 금지한다.

---

## Commit History

d8614924a752a3e63cb2012eb7e14ec6cfbdd9cd

Add runtime operational triple engine

ac0bce666c9ba021d0dd7d48c30a5e354f4ba975

Add runtime operational ontology event graph

e96415c161c69ca94e8cf549e97aab8b18325098

Add driver action dispatcher simulation

cdf2394c622946b58631f75d031a9d6e57baff42

Integrate driver runtime policy engine

c97033231267639bf6438e540f98eb9e169ee9e2

Integrate alcohol level observation runtime

4a80df77d1315000e153da59287cf4caa8914d99

Integrate incapacitation observation runtime

8626b336326e9835eab292ddfa6287b9fdce63ea

Integrate drowsiness observation runtime

68c639ca65fcc7559072d8168c7e97c348b94b3a

Integrate human proximity observation

021bd3b468df355b8202e5f9914af094bccacbb2

Integrate hard acceleration and braking observations

01aab9cc37891ecc24aa7ad489c46233063fd0a2

Integrate turn rate observation

---

## Notes

### Development Principles

Observation generates Risk

Risk generates Policy

Policy generates Action

Action generates Execution

Execution generates Runtime Triple

Runtime Event Graph는 기존 runtime artifact를 관찰하는 Observer다.

Runtime Operational Triple은 Graph를 읽기 전용 원천으로 사용하는 Operational Ontology Layer다.

Every new safety event must use

SensorObservation
↓

observationToRiskSignal()

↓

RiskEventStateMachine

Direct event generation is prohibited.
