# POC Functional Readiness Protocol

Status: development preparation only. `operationalUseAllowed=false`.

## Evidence levels

1. Automated verification: synthetic Geometry V2 Blink/Yawn sequences, local audio integrity, scenario mapping and regression.
2. Manual bench verification: a human performs 20 natural blinks, wink/long-closure separation, five yawns, talking/smile checks and audible Korean review.
3. Parked-vehicle verification: one supervised vehicle, ignition OFF first and ignition ON second.
4. Physical field validation: controlled low-speed area only after the preceding reviews.

Automated verification may set `AUTOMATED_FUNCTIONAL_READY`, but the overall gate remains `NO_GO_FOR_PHYSICAL_POC` until manual evidence is recorded. No public-road, commercial, autonomous or vehicle-control use is authorized. Raw frames, landmarks and audio are not retained.

See `LIVE_BLINK_YAWN_VALIDATION_SHEET.md` for manual observations and `KOREAN_AUDIO_ASSET_REVIEW.md` for audible review.
