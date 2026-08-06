# Driver Companion v1.0 Productization Review

Review baseline: `15ecba7f69a0d79ff4664c9ed602f4177abab6dd` (Commit 20)

Review scope: architecture, policy consistency, voice maintainability, operational ontology, and commercial edge-device readiness

Review posture: recommendations only; no public behavior or API changes

## Executive decision

**Estimated product maturity: 62%.**

**Commercial Driver Companion v1.0: NO-GO.** The codebase is a credible, well-guarded development candidate and is suitable for continued bench, replay, and controlled field validation. It is not ready to be represented as a commercial safety edge runtime until the P0 lifecycle, concurrency, policy-vocabulary, retention, and hardware-contract gaps below are closed and independently verified.

The recommendation is not based on missing speculative features. It is based on internal consistency and deterministic lifecycle requirements for functionality already present.

## Architecture review

### What is strong

- Runtime responsibilities are substantially separated: sensor adapters, observations, risk rules, fusion, confidence, memory/trends, companion decisions, action dispatch, voice, replay, and hardware contracts are distinct modules.
- Canonical target and assignment ownership appear throughout the runtime, reducing cross-driver and cross-vehicle contamination.
- Most asynchronous adapters use generation counters and unsubscribe hooks to reject stale callbacks after reset or stop.
- Models defensively clone and freeze many public artifacts. Operational guards consistently state simulation-only, no actuator connection, and no operational authorization.
- The camera manager explicitly stops tracks, blocks duplicate starts, and invalidates stale callbacks. Sensor runtimes generally avoid network, persistent storage, and direct hardware APIs.
- Audit, lineage, reason-code, and source-ID fields provide a useful explainability foundation.

### Release-blocking consistency findings

1. **Immediate-hazard activation is not enforced by the recommendation mapper.** `driver_companion_recommendation_mapper.js` selects critical behavior from `immediateHazardState.type` even when `active` is false. The decision runtime, however, records dominance only when `active` is true. A stale type on an inactive hazard can therefore create a critical recommendation without a matching dominance audit.

2. **Decision lifecycle is descriptive rather than authoritative.** The companion runtime can acknowledge any current record regardless of whether acknowledgement is required or whether it is already acknowledged/expired. Repeated ACKs are accepted. Expiry is only applied when `expire()` is called, does not cancel or prevent voice delivery, and an unchanged evaluation returns the previous decision even if its lifecycle has changed. Superseded lifecycle is assigned to an object that is immediately replaced and is not retained in the public snapshot.

3. **Voice playback has a preemption race.** A lower-priority asynchronous `playNext()` can resume after preemption and delete the newer active decision for the same target. Generation checks cover reset, but not preemption or per-playback ownership. The audio adapter is also shared while orchestration state is per target, so simultaneous target playback needs an explicit serialization contract.

4. **Policy vocabularies are parallel and inconsistent.** Examples include `DRIVER_INCAPACITATION` versus `INCAPACITATION`, `UNRELIABLE` versus `VERY_LOW`, and several independent representations of urgency (numeric voice priority, fusion score/band, companion escalation level, and severity string). These are not all related by a canonical crosswalk. Confidence gating therefore differs between companion decisions and voice decisions.

5. **ACK semantics are split across three domains.** Driver risk, Driver Companion, and voice each own acknowledgement state and suppression. Voice ACK suppression is keyed by target and message code, while repeat debounce is keyed by target, assignment, and dedup key. Target reset does not clear repeat or ACK-suppression maps, and assignment reset is absent in the voice orchestrator. This allows state to leak across assignments on the same canonical target.

6. **Runtime retention is unbounded.** Audit arrays, artifact arrays, histories, hardware inputs/results/lineage, repeat maps, generation maps, and listener sets have no capacity, age, or disposal policy. Rolling memory windows expire observations, but supporting audit/artifact collections continue growing. This is a predictable long-running edge-device memory risk.

7. **Listener/timer disposal is incomplete.** Page mounts install persistent listeners, subscriptions, and a 300 ms guided-voice interval without a corresponding unmount/dispose path. This is safe for a single immutable page lifetime but not for embedded-shell remounts, hot reload, or long-lived application navigation.

### Maintainability findings

- Several one-to-three-line compatibility modules and prototype extensions obscure ownership. The memory engine is especially difficult to reason about because its core class is modified later through prototype monkey-patching.
- Policy selection exists in driver policy, multi-hazard fusion, confidence recommendation, Driver Companion mapping, voice selection, and action dispatch. Layering is valid, but invariant ownership and precedence are not documented in one place.
- Many modules are compressed into very long physical lines. This does not change behavior but materially reduces reviewability, breakpoint quality, code ownership, and safe commercial maintenance.
- Error handling around listener callbacks is not isolated; one subscriber exception can interrupt emission to later subscribers.
- Input contracts should reject invalid timestamps, negative expiry/debounce durations, unknown trend codes, duplicate IDs with conflicting payloads, and non-monotonic event time consistently rather than module by module.

## State, priority, ACK, debounce, confidence, and decision-policy review

### State coverage

All configured Driver Companion states and actions are syntactically valid model values. The current mapper does not intentionally produce every configured state/action (for example `INFORMING`, `CAUTIONING` is narrow, `RESTORE_CAMERA`, and `RECALIBRATE_SYSTEM`). This is acceptable only if the configuration is explicitly defined as a superset; otherwise it is dead policy surface.

### Priority

The intended ordering—immediate hazard over trend, multi-hazard fusion over isolated low-severity evidence, and degraded confidence as a verification gate—is visible. It is not fully guaranteed because immediate-hazard `active` is ignored by mapping, and voice can substitute a fusion numeric priority for the selected message priority without a documented scale contract.

### ACK lifecycle

ACK correctly does not clear risk or prove a stop. That safety invariant is consistently stated. Missing invariants are: ACK eligibility, single terminal transition, decision/voice ACK correlation, assignment isolation, ACK timeout ownership, queue ACK behavior, and suppression reset semantics.

### Debounce and expiry

Debounce exists at risk, memory/trend voice, companion signature, and voice repeat layers. The rules use different keys and reset boundaries. They need a documented matrix covering key, clock, cooldown, maximum repeats, expiry, ACK effect, escalation bypass, assignment change, and reset behavior.

### Confidence gates

Confidence is propagated and verification is requested under degraded evidence. The gate vocabulary and threshold ownership differ across modules, and critical actions are not uniformly described as confidence-independent versus confidence-qualified. A commercial release needs a single table specifying which hazard classes may override low confidence and which must degrade to verification.

## Voice interaction review

The existing gateway should remain unchanged. Its local WAV/TTS/tone fallback design, message catalog, priority queue, cooldown, repeat ceiling, expiry, ACK suppression, and audit trail are reasonable foundations.

Maintainability recommendations:

- Add an internal playback token so only the owner of the current playback may complete/delete it after preemption.
- Define whether the gateway is single-speaker global or independently routable per target; make orchestration state match that physical fact.
- Unify companion scenario codes, catalog message codes, and legacy scenario IDs through one versioned mapping table with completeness tests.
- Align ACK-required flags: the companion marks several immediate hazards as ACK-required while catalog inference currently marks only incapacitation/ACK-request messages.
- Clear or explicitly preserve cooldown, repeat, and ACK suppression on target and assignment reset according to one documented rule.
- Add dispose/unmount for subscriptions and the guided-calibration polling interval.

## Operational ontology mapping review

Target chain:

`Sensor → Observation → Operational Event → Situation → Recommendation → Driver Companion State`

Current mapping:

| Stage | Runtime representation | Formal TTL representation | Assessment |
|---|---|---|---|
| Sensor | Sensor adapters and edge hardware descriptors | `Sensor` and sensor subclasses | Present, but runtime hardware vocabulary is broader |
| Observation | `SensorObservation` and specialized observations | No general `Observation` class/link | Missing formal semantic link |
| Operational Event | Risk events, event graph nodes, replay events | Primarily `CollisionRiskEvent` | Partial; terminology differs |
| Situation | `OperationalContext` and `CompositeRisk` | No `Situation`/operational-context class | Missing formal semantic link |
| Recommendation | confidence recommendation, priority decision, companion action | `Action`/`triggersAction`, including enforcement-oriented actions | Concept mismatch: recommendation and execution are conflated |
| Driver Companion State | `DriverCompanionDecision.companionState` | Not represented | Missing formal semantic link |

The formal warehouse ontology includes forced-stop/enforcement concepts that are deliberately prohibited from the Driver Companion runtime. The product ontology must distinguish a non-actuating recommendation from an executed action, and must not allow the Driver Companion chain to imply vehicle control.

Recommended semantic backbone: add versioned identifiers and relationships equivalent to `generatedObservation`, `derivedOperationalEvent`, `formsSituation`, `supportsRecommendation`, and `resultsInCompanionState`. This is a terminology/traceability recommendation, not a request to add execution behavior.

## Product readiness review

### Ready enough for continued validation

- Deterministic fixtures, replay artifacts, reason codes, and explicit non-operational guards.
- Broad browser-level contract coverage for major driver risks, perception metrics, fusion, confidence, voice, memory, camera, and hardware abstractions.
- Privacy-oriented avoidance of stored frames, landmarks, point clouds, transcripts, and direct cloud dependencies.
- Backward-compatible module boundaries that can support internal refactoring.

### Not ready for commercial v1.0

- No single safety-policy specification or machine-checked cross-layer invariant suite.
- Release-blocking lifecycle/preemption races and reset-scope inconsistencies.
- No bounded-memory or endurance policy for continuous operation.
- Development-unvalidated policy/calibration markers and `operationalUseAllowed:false` are pervasive by design.
- No documented watchdog, startup self-test, degraded-mode ownership, monotonic-clock strategy, resource budget, thermal/performance envelope, or process-restart recovery contract.
- Browser HTML tests are numerous but there is no repository-native automated runner/manifest or CI evidence in this baseline.

## Edge device readiness review

### Camera

The camera path has the strongest readiness: device enumeration, constraint selection, stream ownership, duplicate-start prevention, stop/track cleanup, stale callback rejection, perception snapshots, and observation bridging are present. Remaining work is contract-level: frame backpressure, inference deadline/missed-frame metrics, camera reconnect/watchdog policy, thermal throttling behavior, and a browser-independent capture-provider interface.

### IMU

IMU logic exists in the warehouse simulation, but the unified edge hardware contract has no `IMU` hardware type and no normalized acceleration, angular-rate, orientation, or timestamp-quality measurement types. The Driver Companion path therefore lacks a portable IMU interface.

### Alcohol sensor

The alcohol runtime and deterministic adapter have useful status, calibration, identity, sample-quality, pre-start/in-operation, and bypass semantics. The unified hardware layer exposes only a generic `ALCOHOL_READING`; it should document the normalized value schema and failure/status mapping so a vendor adapter cannot silently omit identity, calibration, or mode fields.

### Radar/LiDAR

Hardware types and generic distance/relative-speed capabilities exist, but radar and LiDAR share generic measurements without a required modality, coordinate-frame, track identity, covariance/accuracy, field-of-view, synchronization, or freshness contract. Raw point clouds are correctly excluded; normalized object/track evidence is the appropriate portable boundary.

### Sensor independence and portability

The registry/capability approach is directionally good. Portability is incomplete because `registerAdapter()` stores metadata but does not define a start/stop/health/subscribe lifecycle interface, routing is a static measurement-to-runtime string map, and browser camera APIs remain a concrete provider. Introduce internal provider interfaces and contract tests while preserving current public APIs.

## Recommended refactoring list

1. **P0 — Fix and specify immediate-hazard activation:** require `active === true` before hazard-type dominance; define stale/cleared hazard representation and add negative tests.
2. **P0 — Make lifecycle a state machine:** enforce legal decision/voice transitions, ACK eligibility/idempotency, expiry effects, supersession history, and terminal behavior.
3. **P0 — Eliminate voice preemption races:** use playback ownership tokens/generations per target and define global-speaker serialization.
4. **P0 — Canonicalize policy vocabulary:** publish one versioned crosswalk for risk type, hazard type, confidence band, urgency, escalation, recommendation, voice code, and ACK requirement; validate completeness at startup/test time.
5. **P0 — Bound all long-lived state:** capacity/age limits for audit, artifacts, queues, histories, dedup/repeat/ACK/generation maps, lineage, inputs, and results; add endurance/heap tests.
6. **P0 — Define reset scope:** target, assignment, hardware release, and global reset must consistently clear or preserve every state store and invalidate every asynchronous callback.
7. **P1 — Centralize policy invariants without changing APIs:** keep current facades but route shared confidence, ACK, expiry, and priority rules through internal canonical helpers.
8. **P1 — Replace memory-engine prototype patching:** fold extensions into a cohesive class or private collaborators; preserve constructor and public method signatures.
9. **P1 — Add adapter lifecycle contracts:** internal `start/stop/subscribe/health/dispose` provider interfaces for camera, IMU, alcohol, and normalized proximity evidence.
10. **P1 — Add ontology traceability:** represent the full six-stage operational chain and distinguish recommendation from action/execution.
11. **P1 — Add a repository-native test runner:** deterministic browser runner, manifest, timeout/failure capture, CI command, and coverage for inactive hazards, duplicate ACK, expiry-before-delivery, preemption races, assignment reuse, and long-duration retention.
12. **P2 — Improve code form:** format long single-line modules, replace inferred flags with explicit catalog data, isolate listener exceptions, and document layer ownership.
13. **P2 — Classify unused configuration:** mark configured-but-unproduced states/actions as reserved or remove them only in a future versioned API change.

## Verification performed

- Confirmed baseline HEAD exactly matches Commit 20 and the starting tree was clean.
- Reviewed all Driver Companion-related runtime, state, policy, risk, perception, voice, memory, confidence, fusion, hardware, event graph, triple/ontology, page integration, and related test files.
- Parsed all 70 JavaScript source files successfully with Node syntax checking.
- `git diff --check` passed before this report was added.
- Attempted to execute all standalone HTML browser harnesses. Execution could not be completed in this environment: system browsers did not run reliably in the sandbox and the workspace Playwright package referenced a Chromium binary that is not installed. This review therefore does **not** claim a fresh 43/43 browser-suite pass.

## Release gate

Reassess for commercial v1.0 only after all P0 items are implemented without public API changes, the full browser suite runs in a reproducible runner, new concurrency/endurance/negative-policy tests pass, and the development-unvalidated operational guards are replaced through an explicit validation and safety-approval process. Until then: **NO-GO for commercial v1.0; GO for continued controlled development and validation.**
