# Controlled Field Pilot Protocol

## Status and Authority

This kit prepares supervised development validation. It is not a commercial release, safety certification, autonomous system, or authorization for operational reliance. Commercial status is `NO_GO`; physical validation remains `FIELD_VALIDATION_REQUIRED`. A named-on-paper human supervisor—not the software—authorizes, pauses, stops, reviews, or cancels each session.

The browser runtime uses anonymized site, area, vehicle, operator, supervisor, and shift codes. Do not enter names, contact details, license identifiers, GPS coordinates, routes, biometric identifiers, or persistent personal profiles.

## Prohibited Activities

No braking, steering, throttle, ignition, emergency call/message, GPS/route tracking, cloud upload, remote surveillance, hidden recording, raw video/audio, radar/LiDAR point cloud, browser storage, database, or automatic approval is permitted. `actuatorConnected` and `operationalUseAllowed` remain false.

## Session Sequence

1. Assign anonymous codes and select a mode. Default modes are `STATIC_BENCH`, `PARKED_VEHICLE`, and `CLOSED_COURSE_LOW_SPEED`.
2. Obtain separate human authorization for any other candidate mode. There is no automatic phase progression.
3. Complete installation inspection and daily preflight. Any critical failure blocks the session.
4. Brief operator and supervisor; verify manual shutdown and controlled test-area boundaries.
5. Start only with explicit supervisor confirmation.
6. Execute only planned scenarios. Mark evidence honestly as `SIMULATED`, `BENCH`, or `PHYSICAL`.
7. Record operational summaries, warnings, ACKs, resets, resource metrics, and incidents without raw media.
8. Apply an immediate safety stop on any stop-policy trigger.
9. Generate JSON evidence, conduct human daily review, and retain the external record according to the organization’s approved process.

## Safety Stop

Stop for unsafe camera mounting/view, unstable power, runaway speaker, repeated resets, storage error, wrong assignment, operator/supervisor request, or unexpected Runtime behavior. The software changes status to `SAFETY_STOPPED`, records a summary incident, and creates evidence. It does not brake, call anyone, clear Risk, or claim a safe state.

## Pilot Gate

Allowed software recommendations are `NO_GO`, `BENCH_ONLY_GO`, `CONTROLLED_CLOSED_COURSE_GO`, and `CONTROLLED_FIELD_GO`. `COMMERCIAL_GO` does not exist. Human authorization and unresolved safety/privacy incidents always take precedence.

## Evidence Boundaries

Evidence packages contain session, checklist, hardware/timing summaries, incidents, ACKs, warnings, resource metrics, distributions, privacy manifest, and missing-evidence list. They are JSON-safe, bounded in memory, and contain no raw media or personal identity. Export functions return strings; they do not upload, persist, or transmit data.
