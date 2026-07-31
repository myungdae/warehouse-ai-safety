# warehouse-ai-safety
Project Status

---

## Project Goal

Warehouse AI Safety Platform

SensorObservation 기반 Runtime Risk Detection

모든 위험 이벤트는 다음 파이프라인을 따른다.

Sensor
→ SensorObservation
→ observationToRiskSignal()
→ RiskEventStateMachine
→ NEW → ACTIVE → CLEARED

---

## Completed

### SensorObservation Framework
- [x] SensorObservation 생성
- [x] Observation Metadata
- [x] Observation → RiskSignal 변환
- [x] RiskEventStateMachine 연결

### Safety Events

- [x] TILT
- [x] HARD_ACCELERATION
- [x] HARD_BRAKING
- [x] TURN_RATE / SHARP_TURN
- [x] HUMAN_PROXIMITY

HUMAN_PROXIMITY targetId

`forkliftId|personId` 복합 형식

---

## Last Stable Commit

Commit

68c639ca65fcc7559072d8168c7e97c348b94b3a

Last Commit Message

Integrate human proximity observation

Git Status

Clean

Push

Not Performed

AWS

Not Performed

---

## Next Phase

Driver State Module

### Planned Driver Observations

- DROWSINESS
- INCAPACITATION
- ALCOHOL_LEVEL

### Vehicle Reuse

지게차뿐 아니라 탑차, 화물차, 버스, 특수차량에 재사용 가능한 공통 운전자 상태 모듈

---

## Development Rules

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

68c639ca65fcc7559072d8168c7e97c348b94b3a

Integrate human proximity observation

021bd3b468df355b8202e5f9914af094bccacbb2

Integrate hard acceleration and braking observations

01aab9cc37891ecc24aa7ad489c46233063fd0a2

Integrate turn rate observation

---

## Notes

Every new safety event must use

SensorObservation
↓

observationToRiskSignal()

↓

RiskEventStateMachine

Direct event generation is prohibited.
