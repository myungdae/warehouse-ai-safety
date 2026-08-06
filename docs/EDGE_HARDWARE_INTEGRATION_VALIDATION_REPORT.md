# Edge Hardware Integration & Validation Protocol

## Scope

Commit 25 adds a deterministic, simulation-only engineering validation layer for edge hardware discovery, registration, initialization, operation, degradation, disconnect, failure, reconnect, replacement, ownership transfer, reset boundaries, timing, and stress. It does not add perception, Driver Companion, Memory, Voice policy, a physical driver, a browser device API, cloud transport, storage, actuation, or emergency communication.

All results are controlled software/bench evidence. Physical hardware validation remains `FIELD_VALIDATION_REQUIRED`, and commercial status remains `NO_GO`.

## Hardware Integration Matrix

| Device | Driver boundary | State coverage | Failure fixtures | Recovery | Software result | Field validation |
|---|---|---|---|---|---|---|
| Camera | UVC/MIPI vendor adapter candidate | All 11 states | unplug, USB timeout, frame freeze | automatic/manual/replacement | PASS | Required |
| IMU | I2C/vendor adapter candidate | All 11 states | USB timeout, update stopped | automatic/manual/replacement | PASS | Required |
| Radar | CAN/UART/Ethernet adapter candidate | All 11 states | USB timeout, stale tracks | automatic/manual/replacement | PASS | Required |
| LiDAR | UART/Ethernet adapter candidate | All 11 states | USB timeout, stale tracks | automatic/manual/replacement | PASS | Required |
| Alcohol sensor | Analog/UART/USB adapter candidate | All 11 states | USB timeout, measurement timeout | automatic/manual/replacement | PASS | Required |
| Speaker | Existing output contract | All 11 states | delivery failure | reconnect/replacement | PASS | Required |
| Warning LED | Existing output contract | All 11 states | output failure | reconnect/replacement | PASS | Required |
| Buzzer | Existing output contract | All 11 states | output failure | reconnect/replacement | PASS | Required |
| ACK button | Existing ACK candidate contract | All 11 states | deterministic bounce | debounce/reconnect/replacement | PASS | Required |
| Power supply | System-health evidence contract | All 11 states | low battery, power loss | reconnect/replacement | PASS | Required |
| Clock | System-health evidence contract | All 11 states | deterministic drift | validation/reconnect | PASS | Required |

## Hardware Validation States

`UNKNOWN → DISCOVERED → REGISTERED → INITIALIZING → READY → RUNNING` is the normal path. `RUNNING` may transition to `DEGRADED`, `OFFLINE`, `FAILED`, or `RECONNECTING`. Recovery uses `RECONNECTING → INITIALIZING → READY → RUNNING`. `RELEASED` is terminal and stale ownership or generation callbacks are rejected.

Transitions are legal-state checked, generation scoped, ownership scoped, chronologically audited, bounded, JSON-safe, simulation-only, and marked `operationalUseAllowed: false`.

## Failure and Recovery Validation Matrix

| Condition | Expected runtime evidence | Recovery requirement | Safety invariant |
|---|---|---|---|
| Camera unplugged | OFFLINE | reconnect or replacement | no false no-risk interpretation |
| USB timeout | DEGRADED | automatic/manual initialization | warning path remains enabled |
| Frame freeze | DEGRADED | fresh-frame validation | no raw frame retained |
| IMU stopped | OFFLINE | reconnect/replacement | stale callback rejected |
| Radar/LiDAR stale | DEGRADED | fresh-track validation | no point cloud retained |
| Alcohol timeout | OFFLINE | reconnect/replacement | no fabricated measurement |
| Speaker/LED/Buzzer failure | FAILED | reconnect/replacement/fallback candidate | recommendation remains present |
| ACK bounce | DEBOUNCED | accept after 80 ms | ACK never clears Risk |
| Clock drift | DEGRADED | clock validation | timing remains engineering-only |
| Low memory/storage pressure | DEGRADED | bounded compaction/recovery | live warning/Risk/ACK continue |
| Low battery/power loss | DEGRADED/OFFLINE | power recovery/replacement | reset does not claim safe state |

## Vendor Abstraction

The protocol validates these candidates against identical normalized Runtime contract types:

- Cameras: generic UVC, Logitech C922, generic MIPI CSI → `CAMERA_OBSERVATION`
- IMUs: generic I2C, Bosch candidate, TDK candidate → `IMU_OBSERVATION`
- Radar: generic CAN, UART, Ethernet → `RADAR_TRACK_SUMMARY`
- LiDAR: generic UART, Ethernet → `LIDAR_TRACK_SUMMARY`
- Alcohol sensors: generic analog, UART, USB → `ALCOHOL_MEASUREMENT`

Vendor normalization retains operational summaries only. It stores no raw video, audio, waveform, landmark array, or point cloud.

## Recovery and Stress

Deterministic coverage includes automatic recovery, manual recovery, device replacement, generation increment, ownership transfer, old-token rejection, old-generation rejection, stale-time rejection, and terminal release. Repeated connect/failure/reconnect cycles preserve warning, Risk, and ACK continuity flags.

The stress fixture executes 60 camera failure/recovery cycles with Voice/warning, Risk, and ACK continuity evidence on every reconnect. Registry admission is hard-limited, released entries are reclaimable, and active devices are not silently evicted.

## Timing

The following bounded metrics are captured in milliseconds: device startup, registration, first observation, first Risk, Voice latency, ACK latency, recovery latency, and reset latency. They are explicitly `engineeringMetricOnly`; they are not real-time guarantees or safety certification.

## Browser and Regression Protocol

The implementation uses standard ECMAScript, immutable JSON contracts, and no browser hardware API. Validation must pass on installed Microsoft Edge and the Chromium-compatible execution path. Google Chrome physical execution remains a target environment and requires an installed-browser run before field release. No browser-specific API assumption is present.

Required release evidence:

- Hardware validation protocol: at least 400 assertions
- Existing Edge hardware contract suite
- Unified Edge, lifecycle/store, stabilization, identity, Driver Companion, Memory, Voice, replay, and all browser regressions
- JavaScript syntax and `git diff --check`
- No network, browser storage, microphone capture, direct USB/serial access, vehicle control, emergency call/message, raw media, or point-cloud retention

## Productization Gate

- Software architecture freeze candidate: **SUPPORTED BY DETERMINISTIC REGRESSION**
- Controlled bench validation: **SUPPORTED**
- Physical device validation: **FIELD_VALIDATION_REQUIRED**
- Multi-vendor hardware certification: **NOT COMPLETE**
- Commercial release: **NO_GO**

## Remaining Risks

- Real driver/firmware timing, electrical noise, USB controller behavior, power brownout, clock source behavior, and vendor SDK defects are not simulated faithfully.
- Speaker audibility, LED visibility, buzzer sound pressure, ACK button mechanics, alcohol calibration, camera exposure, IMU vibration, radar multipath, and LiDAR weather response require physical validation.
- Chrome and future Chromium compatibility are supported by standards-only code but require execution on the actual release browser builds.
