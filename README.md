# Velocity Rush

Neon endless lane racer for CrazyGames. Dodge night traffic on a 4-lane highway,
grab nitro and coins, chase near-misses — one crash ends the run.

**Play:** https://tukieav.github.io/velocity-rush/

## Controls
- Left/Right arrows or physical WASD / ZQSD keys — change lane
- Mobile: swipe left/right or tap screen halves
- Garage: visible Back button, Backspace, G, or Escape returns to the menu

## Tech
- Vanilla JS + Canvas 2D, zero asset files (all procedural graphics + WebAudio sound)
- esbuild bundle (~17 KB)
- CrazyGames SDK v3 full integration (ads, data, muteAudio, happytime)

## Dev
```bash
npm install
npm run dev      # esbuild watch + local server
npm run build    # dist/ self-contained bundle
node tests/flow.test.mjs   # Playwright full-flow test (server on :8484)
```
