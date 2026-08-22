# Velocity Rush — CrazyGames Submission Kit

## Game name

Velocity Rush

## Category and discovery paths

- Primary category: **Driving**
- Primary category path: `/c/driving`
- Secondary discovery: **Arcade**
- Verified tags: **Car, Traffic, Racing, Mobile, Skill, 2D**

## Short description (160 characters)

Thread a neon supercar through night traffic, chain close calls, collect coins,
and unleash nitro on an endless highway.

## Full description

Thread a neon car through night traffic: take the safe lane, collect coin
lines, and choose when a marked rival is close enough for a near-miss bonus.

The core loop is a short, replayable score chase. Traffic keeps a reachable
lane, marked rivals show their close-pass opportunity, and lane-changing cars
signal before moving. Nitro pickups create a brief speed burst; coin streaks,
near-miss chains, speed feedback, and the visible chain timer make the risks
readable rather than random. A shield upgrade can absorb one crash per run.

Coins bank between runs. Spend them on eight cars with different handling,
nitro duration, and coin multipliers, then improve nitro time, coin magnet
range, and crash protection. Missions, a daily reward, best distance, and a
persistent wallet give each few-minute run a clear next goal.

Desktop controls: Left/Right arrows or physical WASD/ZQSD keys steer. Mobile
controls: swipe left/right or tap a screen half. The first run shows a small
visual control card and dismisses it after the first successful steer.

## Current features

- Fair traffic director: speed and handling determine a guaranteed reaction
  window; it preserves a reachable lane and prevents all-lane walls.
- Marked-rival close-pass chain with a visible decay meter, plus signalled
  lane-changing traffic after the safe opening.
- Eight cars, permanent upgrades, missions, daily rewards, and persistent
  wallet/best-score progression.
- Instant local Play Again restart; optional rewarded continue/double-coin ads
  appear only on the natural game-over screen.
- Canvas 2D synthwave city, readable telegraphs, reduced-motion adaptation,
  mute control, keyboard/mouse/touch input, and mobile swipe lane control.

## Controls

- Desktop: Left/Right arrows or physical WASD/ZQSD keys change lanes; mouse
  click on a screen half also changes lane.
- Mobile: Swipe left/right to change lanes, or tap the left/right half of the
  screen. All mobile controls have at least a 44 CSS px hit target.

## SDK, save, and ad behavior

- CrazyGames HTML5 SDK v3 initializes only in the CrazyGames host, with a
  three-second safe fallback for local builds.
- `loadingStart`/`loadingStop` surround boot; `gameplayStart`/`gameplayStop`
  follow active gameplay boundaries. Visibility, blur, and ads pause
  simulation/input/audio and resume once.
- CrazyGames mute settings are observed; players also have an in-game mute
  toggle. `happytime` is throttled.
- Best score and progression use the Data Module with a safe localStorage
  fallback and malformed/old-save recovery.
- Rewarded ads are optional for one continue or doubling a completed run's
  coins. No ad is mandatory for play or restart.

## Rating, live URL, and resubmission note

- PEGI 12 appropriate: stylized vehicle crashes only; no blood, gore, chat,
  user content, or gambling.
- Live URL: https://tukieav.github.io/velocity-rush/
- Quality resubmission: refreshed after traffic-fairness, lifecycle,
  fixed-timestep, accessibility, viewport, and soak hardening. The local
  fallback intentionally runs without CrazyGames SDK calls outside the portal.

## Upload files

- Build: `dist/index.html` + `dist/bundle.js` (or `velocity-rush.zip`)
- Covers: `marketing/cover-16x9.png`, `marketing/cover-1x1.png`,
  `marketing/cover-2x3.png`
- Screenshots: `marketing/screenshot-menu.png`, `marketing/screenshot-gameplay.png`
- Videos: `marketing/video-landscape.mp4`, `marketing/video-portrait.mp4`
