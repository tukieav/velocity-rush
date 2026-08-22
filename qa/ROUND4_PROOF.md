# Round 4 proof — 2026-08-22

All browser gates used this worktree's freshly built `dist/` served in
isolation at `http://127.0.0.1:8618/?debug=1`.

## Cover brightness gate

Command: `npm run check:covers` — exit `0`.

| Cover | meanLum | darkFrac (lum < 40) | meanSat | Result |
| --- | ---: | ---: | ---: | --- |
| `marketing/cover-16x9.png` | 147.44 | 0.0371 | 0.3902 | PASS |
| `marketing/cover-2x3.png` | 146.19 | 0.0852 | 0.4250 | PASS |
| `marketing/cover-1x1.png` | 146.30 | 0.0481 | 0.4146 | PASS |

All covers clear the R4 thresholds: mean luminance >= 80, dark fraction <=
0.35, and mean saturation >= 0.35.

## Media inspection

`ffprobe -v error -show_entries stream=codec_name,codec_type,width,height,display_aspect_ratio:format=duration,size -of json` — exit `0` for each file:

| File | Codec / audio | Pixels | Ratio | Duration | Bytes | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `marketing/video-landscape.mp4` | H.264 video only | 1920x1080 | 16:9 | 15.700s | 7,638,099 | PASS |
| `marketing/video-portrait.mp4` | H.264 video only | 800x1200 | 2:3 | 15.700s | 3,531,782 | PASS |

Both MP4s were rebuilt by `scripts/record-video.mjs` after regenerating the
covers. The recorder prepends the corresponding current cover for 0.7 seconds.
Frame samples at 0.10s are committed as `qa/round4/video-landscape-opening.png`
and `qa/round4/video-portrait-opening.png`; they visibly match the regenerated
landscape and portrait cover respectively.

## Fresh visual proof

- `qa/round4/907x510-cover.png` — 16:9 cover at the requested review size.
- `qa/round4/907x510-menu.png` — bright menu horizon and headlight sweep.
- `qa/round4/907x510-gameplay.png` — gameplay remains on its authored night-race direction.
- Additional responsive captures: 1280x720, 1920x1080, and 390x844 menu and gameplay.

## Existing gates

Every command below exited `0`:

- `npm run build`
- `node tests/control-layout.test.mjs`
- `node tests/final-polish.test.mjs`
- `node tests/flow.test.mjs`
- `node tests/lifecycle.test.mjs`
- `node tests/live.test.mjs` with `URL=http://127.0.0.1:8618/?debug=1`
- `node tests/meta.test.mjs`
- `node tests/refresh-rate.test.mjs`
- `node tests/traffic.test.mjs`
- `node tools/e2e-desktop.cjs`
- `node tools/e2e-viewport.mjs`
- `SOAK_SECONDS=120 node tools/e2e-soak.cjs` (42.2 FPS)
- `npm run check:covers`
