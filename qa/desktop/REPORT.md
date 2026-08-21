# Desktop vision and objective-gate report

Run: 2026-08-21, local production bundle, Chromium headless.

## Automated objective gate

`node tools/e2e-desktop.cjs` passed at 1280x720, 1920x1080, and 390x844.
For every viewport it proved a full CSS-pixel canvas, living pixels at all four
edges, garage entry, keyboard lane change, nitro activation, and zero browser
errors. The adjacent PNGs are the exact captures from that run.

## Three-round commercial-racer vision gate

1. **Wide composition — pass.** `1280x720-gameplay.png` and
   `1920x1080-gameplay.png` show a native edge-to-edge scene: horizon skyline,
   road, rails, palms, lamps and billboards all use the landscape canvas; there
   is no portrait render, black band, or blurred video backing.
2. **Play readability — pass.** The broadcast layout keeps distance/best at the
   upper left, run coins and bank at the upper right, speedometer at the lower
   right, and a lower-corner nitro callout. Road lanes are broad enough for
   readable traffic and remain visible around the player car.
3. **Feature presentation — pass.** Garage captures show a full workshop with
   trusses, strip lights, cabinets, tyres, floor grid and a centered turntable;
   `390x844-gameplay.png` confirms the established portrait composition still
   fills the display without desktop-only controls.

## Deliverables checked

- `marketing/video-landscape.mp4`: direct 1280x720 gameplay recording, H.264.
- `marketing/video-portrait.mp4`: fresh direct 720x1280 gameplay recording,
  H.264.
- `velocity-rush.zip`: rebuilt from the current `dist/` bundle (ignored release
  artifact, intentionally not committed).
