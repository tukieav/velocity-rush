# Velocity Rush — CrazyGames Submission Kit

Wszystko poniżej wklejasz w formularz na https://developer.crazygames.com/

## Game name
Velocity Rush

## Category
Racing (secondary: Casual / Arcade)

## Tags
racing, endless, neon, cars, dodge, highway, nitro, one-hand, arcade, high-score

## Short description (max ~140 chars)
Weave through neon night traffic at insane speed! Grab nitro, thread near-misses and chase your best distance in this endless racer.

## Full description
Velocity Rush is a fast, glowing endless lane racer. Pilot your neon car down a
4-lane night highway, weaving through slower traffic that gets denser and faster
the further you go. One crash ends the run — how far can you push it?

FEATURES
- Pure speed: the highway keeps accelerating the longer you survive
- NITRO pickups: 1.6x boost with flame trails and screen shake
- Near-miss CHAIN: consecutive close calls within 3s build a rising bonus multiplier
- Coin combos: chain pickups for multiplied coins
- GARAGE: 8 unlockable neon cars with unique handling, nitro duration and coin multiplier stats
- Permanent upgrades: nitro time +20%/level, coin magnet, crash shield (1 save per run)
- 14 missions (total distance, near-miss counts, chain goals…) with coin rewards
- Daily login streak bonus (up to 7x)
- Persistent coin wallet & progress saved across devices (SDK data module)
- Neon night visuals: glowing cars, light streaks, city vibes — all procedural
- Instant restarts, "one more try" loop under 30 seconds
- Mouse/keyboard AND touch: swipe or tap to change lanes
- Best distance saved across devices

HOW TO PLAY
1. Press PLAY and start rolling
2. Arrow keys / A-D change lanes (swipe or tap halves on mobile)
3. Dodge cars and trucks — trucks are twice as long!
4. Grab $ coins and NITRO bolts
5. Crash? Watch an ad to CONTINUE right where you died (once per run)

## Controls text
Left/Right arrows or A/D — change lane. Mobile: swipe left/right or tap screen halves.

## SDK integration notes (QA reviewer info)
- HTML5 SDK v3, manual init before game start (with 3s timeout fallback)
- gameplayStart/gameplayStop on play/game over/ad breaks
- loadingStart/loadingStop around boot
- Midgame ad on "Play Again" after game over
- Rewarded ad "CONTINUE" (revive at crash spot with 2s invulnerability, once per run)
- Rewarded ad "DOUBLE" (x2 coins earned in the run, on game-over screen)
- happytime() on 1000 m milestones, mission completions, car/upgrade purchases (client-side throttled)
- game.settings.muteAudio respected + settings change listener
- Best score AND full meta-progression (wallet, cars, upgrades, missions, streak) via data module with localStorage fallback
- No external requests, all assets procedural (Canvas 2D + WebAudio), bundle ~17 KB
- Touch + mouse + keyboard; portrait-friendly, works on low-end devices
- Live demo: https://tukieav.github.io/velocity-rush/

## Files to upload
- Build: dist/index.html + dist/bundle.js (or velocity-rush.zip contents)
- Cover 16:9 (1920x1080): marketing/cover-16x9.png
- Cover 1:1 (1080x1080): marketing/cover-1x1.png
- Cover 2:3 (800x1200): marketing/cover-2x3.png
- Screenshots: marketing/screenshot-menu.png, marketing/screenshot-gameplay.png
- Videos: marketing/video-landscape.mp4 (1280x720), marketing/video-portrait.mp4 (720x1280)

## Submission form answers
- "Does your game save progress?" -> "Yes, using the Data Module from the CrazyGames SDK"
- [x] supports mobile devices
- [x] supports CrazyGames muting audio through SDK
- [ ] online multiplayer (NO)

## Age rating / audience
All ages; designed for 10–16. No violence, no blood, no text chat, no user content.
