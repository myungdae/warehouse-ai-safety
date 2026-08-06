# Unified Edge Runtime v1 Report

## Scope

Commit 24 adds a RAM-first, vendor-neutral edge coordination contract for camera summaries, IMU summaries, radar/LiDAR tracks, alcohol measurements, physical ACK, voice ACK candidates, health evidence, and simulated warning outputs. It adds no hardware driver, cloud service, persistent storage, microphone capture, vehicle control, or emergency call.

## Contracts and Capabilities

`UnifiedEdgeDeviceDescriptor`, `UnifiedEdgeInputEvent`, and `UnifiedEdgeOutputRequest` are immutable, JSON-safe, target/assignment/generation scoped, simulation-only contracts. Raw images, frames, face crops, landmarks, audio, waveforms, point clouds, base64 and blobs are rejected. Safe-stop output is explicitly advisory.

Input route candidates use existing public boundaries: camera to perception bridge; IMU to vendor-neutral motion observation candidate; radar/LiDAR to proximity candidate; alcohol to alcohol runtime; ACK to ACK gateway; and health to confidence evidence. A route candidate never fabricates successful downstream ingestion.

Output selection preserves warnings. Speaker unavailability falls back through buzzer, LED, and display; if none exists, delivery becomes unavailable without deleting the recommendation.

## Retention and Resource Budget

Policy: `DEVELOPMENT_CANDIDATE_EDGE_RETENTION_POLICY-v1`.

| Resource | Class | Candidate bound |
|---|---|---|
| Raw camera/media | NO_PERSISTENCE | 0 |
| Camera summary | HOT_MEMORY_SHORT | 120 / 30 seconds |
| IMU summary | HOT_MEMORY_SHORT | 300 / 10 seconds |
| Radar/LiDAR tracks | HOT_MEMORY_MEDIUM | 300 / 60 seconds |
| Alcohol | COMPACT_EVENT_LOG | 100 / 8 hours |
| ACK | COMPACT_EVENT_LOG | 500 / 8 hours |
| Edge input/log | COMPACT_EVENT_LOG | 1,000 / 8 hours |
| Duplicate window / lineage | COMPACT_EVENT_LOG | 2,000 / 8 hours |
| Incidents | CRITICAL_EVENT_RESERVE | 100 / 24 hours |

All buffers, including duplicate detection and runtime-owned lineage, use `RuntimeBoundedStore`, compact before admission, protect active entries, preserve dropped and rejected-admission counts, and use no background interval. `maximumEntries` is a hard ordinary capacity. A configured critical reserve is separately bounded; no store may exceed `maximumEntries + criticalReserveEntries`. When pinned capacity is full, non-critical history is rejected rather than evicting active safety state. Resource budgets are estimates only. Pressure states preserve warning, risk evaluation, ACK, active lifecycle, and critical incident summaries while degrading only historical retention.

### Hard Capacity and Pinning

Admission outcomes are `ADMITTED`, `ADMITTED_AFTER_COMPACTION`, `REJECTED_CAPACITY`, `REJECTED_PINNED_CAPACITY`, `DEGRADED_ADMISSION`, and `ERROR`. Terminal and oldest unpinned records are compacted before admission. Active risks, current voice/companion decisions, playback, scenarios, assignments, hardware ownership, reset work, and critical incidents are recognized pin categories. Pins carry reason, time, generation, and reserve eligibility in records that use them. Terminal, released, reset-complete, and stale-generation records lose their pins and become eviction candidates. Metrics expose hard capacity, reserve, rejection count, last admission, pin count, and pin-leak count.

Unified Edge output retention is 500 ordinary entries plus a 32-entry critical reserve. Incident retention is 100 ordinary entries plus a 20-entry critical reserve. Both reserves reject admission at their hard limit without evicting existing active entries. Warning, risk, and ACK paths remain enabled when historical admission is rejected.

### Registry and Audit Bounds

Registry policy `DEVELOPMENT_CANDIDATE_EDGE_REGISTRY_LIMITS-v1` limits devices to 128, active ownership tokens to 256, assignment generations to 256, and retained reset reports to 100. Released devices are reclaimable; active ownership is never silently evicted. Duplicate registration does not consume capacity and rejection diagnostics expose category and reason.

Lifecycle audit retention is 1,000 entries / 8 hours under `DEVELOPMENT_CANDIDATE_RETENTION_POLICY-v1`. Audit IDs remain monotonic after compaction, while current lifecycle records remain separate and unaffected. Every `RuntimeBoundedStore` internal audit is independently limited to 500 entries / 8 hours. Audit compaction updates summary metrics without recursively auditing itself.

## Incident, Log, Reset, and Lineage

Incidents retain operational IDs and summaries only, never raw media or point clouds. The compact log records event, target, assignment, source, decision/delivery/ACK result and reasons. Reset blocks ingress, enters `RESETTING`, increments generation, cancels active output with `RESET_DISCONTINUITY`, releases in-scope hardware ownership, closes active incidents as `CLOSED_BY_RESET`, invalidates retained ACK state, resets scoped hot buffers, and retains a bounded reset report. Partial failures are reported explicitly. Reset never claims that risk became safe. Reboot recovery is a future boundary only: runtime starts clean and requires explicit registration.

Runtime-owned lineage connects hardware, capability/input, route, decision/output, delivery, ACK, reset and expiry without changing graph/triple cores.

## Authoritative Edge State Machine

The Unified Edge lifecycle uses the shared `LifecycleCoordinator` with generation validation, legal-transition checks, previous/current state, reason codes, and bounded transition history.

| From | Valid operational transitions |
|---|---|
| NOT_REGISTERED | REGISTERED, ERROR |
| REGISTERED | INITIALIZING, RESETTING, ERROR, RELEASED |
| INITIALIZING | READY, RESETTING, ERROR, RELEASED |
| READY | RUNNING, OFFLINE, RESETTING, ERROR, RELEASED |
| RUNNING | STORAGE_PRESSURE, DEGRADED, OFFLINE, RESETTING, ERROR, RELEASED |
| STORAGE_PRESSURE | DEGRADED, RUNNING, OFFLINE, RESETTING, ERROR, RELEASED |
| DEGRADED | RUNNING, STORAGE_PRESSURE, OFFLINE, RESETTING, ERROR, RELEASED |
| OFFLINE | INITIALIZING, RESETTING, ERROR, RELEASED |
| ERROR | RESETTING, RELEASED |
| RESETTING | READY, REGISTERED, RELEASED, ERROR |
| RELEASED | terminal; a new registration at the current generation is required |

## Validation and Status

Physical camera, IMU, radar, LiDAR, alcohol, ACK button and speaker behavior remain `FIELD_VALIDATION_REQUIRED`. Cross-runtime Memory/Companion reset coordination remains an integration boundary rather than proof of physical safe state. Commercial status remains **NO-GO**; controlled bench/software validation is the intended scope. Product maturity is not increased beyond 68%.
