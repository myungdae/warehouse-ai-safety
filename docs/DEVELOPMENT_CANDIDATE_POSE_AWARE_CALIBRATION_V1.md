# DEVELOPMENT_CANDIDATE_POSE_AWARE_CALIBRATION-v1

## Status

- Classification: development candidate
- Implementation status: not implemented
- Operational use allowed: false
- Leading candidate: accept calibration samples within the driver's neutral pose envelope of `median ± 2 MAD` for pitch, roll, and yaw

This record documents a candidate calibration-quality improvement only. It does not change the current calibration filter, EAR thresholds, Blink behavior, Risk behavior, or any runtime behavior.

## Candidate contract

For a future evaluated implementation:

1. Establish the driver's neutral pitch, roll, and yaw distributions during calibration.
2. Define each neutral pose envelope as the axis median plus or minus two median absolute deviations (`±2 Pose MAD`).
3. Admit samples to the eye-stability calculation only when pitch, roll, and yaw are all inside their respective neutral pose envelopes.
4. Apply the existing neutral-eye filtering and stability evaluation to that pose-valid subset.

The proposal improves which samples contribute to calibration quality. It is not a relaxation of eye thresholds or stability limits.

## Single-session development evidence

The investigation session produced these neutral-pose statistics:

| Axis | Median | MAD |
|---|---:|---:|
| Pitch | 38.22852824357269 | 0.4445443887672198 |
| Roll | -3.4507414686126037 | 0.9223287610178343 |
| Yaw | 2.9769265767465285 | 0.6061361788847619 |

Applying the candidate `±2 Pose MAD` envelope retained 54 synchronized samples. After the existing neutral-eye filter:

| Eye | Accepted samples | Median EAR | EAR MAD | MAD / median |
|---|---:|---:|---:|---:|
| Left | 54 | 0.17668335877913988 | 0.023843667686892445 | 0.13495140601610267 |
| Right | 53 | 0.1720569541265923 | 0.02197558763293153 | 0.12772275171605568 |

The current stability limit observed during the investigation was `0.15`. These figures are development evidence from one session, not validation evidence for deployment or replacement of the current filter.

## Validation gate before implementation

The current calibration filter must not be replaced based on this session. Any implementation or adoption requires multi-driver validation covering, at minimum:

- repeated sessions per driver;
- drivers with and without glasses, including glare conditions;
- representative head pose, lighting, camera placement, and camera-device variation;
- eye-shape and driver-population variation;
- retained-sample sufficiency and calibration completion reliability;
- Blink, long-closure, PERCLOS, and Yawn regression behavior;
- stale, paused, duplicate, and throttled camera-stream rejection.

Until that validation is completed and reviewed, `±2 Pose MAD` remains the leading development candidate only, `operationalUseAllowed=false`, and the current calibration filter remains authoritative.

## Future Validation Matrix

### Driver Profiles

| Driver | Profile | Validation Purpose |
|--------|---------|--------------------|
| Driver A | No glasses | Baseline reference |
| Driver B | Prescription glasses | Lens reflection robustness |
| Driver C | Sunglasses | Reduced eye visibility |
| Driver D | Night driving | Low-light robustness |
| Driver E | Natural head tilt | Pose-aware calibration validation |
| Driver F | Different seat/camera height | Camera geometry robustness |

## Evaluation Metrics

### Calibration Quality

- Calibration success rate
- Calibration completion time
- Neutral pose stability
- Pose-aware sample acceptance rate

### Blink Detection

- Blink acceptance rate
- False blink rejection rate
- Wink rejection accuracy
- Long-eye-closure separation accuracy

### Fatigue Detection

- Long-eye-closure detection rate
- Repeated-yawn detection rate
- False fatigue warning rate

### Runtime Quality

- Frame-gap distribution
- MediaPipe callback cadence
- Landmark continuity
- Camera callback health

### User Experience

- Time to first successful calibration
- Guidance clarity
- Audible warning clarity
- Overall user experience score

## Draft Acceptance Criteria

| Criterion | Draft threshold |
|---|---:|
| Calibration Success | >=95% |
| Blink Acceptance | >=95% |
| False Blink | <=1% |
| Long Eye Closure Detection | >=95% |
| Repeated Yawn Detection | >=95% |
| Calibration Time | <=15 seconds |
| User Satisfaction | >=4.5/5 |

## Validation Policy

- Multi-driver validation required.
- Multi-camera validation required.
- Indoor and outdoor validation required.
- Glasses and non-glasses validation required.
- Frame-gap distribution shall be recorded.
- Single-session evidence is not deployment evidence.
- `operationalUseAllowed=false` remains until field validation is completed.

## Discussion

This proposal is classified as a Development Candidate rather than a production change because its supporting evidence comes from a single investigation session and is not sufficient to establish general reliability. The observed result supports further evaluation of pose-aware sample selection, but it does not demonstrate performance across different drivers, eyewear, lighting conditions, camera devices, seating geometry, or repeated sessions.

Existing calibration thresholds remain authoritative. Existing Blink, Yawn, and Risk behavior remains unchanged. The proposal improves calibration quality only by defining a candidate method for selecting the neutral-pose sample subset used by the existing stability evaluation; it does not relax detection thresholds or alter runtime fatigue decisions.

Implementation requires statistically significant validation across multiple drivers before the candidate may replace or modify the current calibration filter. Until the validation policy and draft acceptance criteria are satisfied and reviewed, the proposal remains non-operational, the current calibration behavior remains authoritative, and `operationalUseAllowed=false` remains in force.
