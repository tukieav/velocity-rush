# Final polish audit — Velocity Rush

Audit date: 2026-08-22. Current `dist/` was built from `be44e32` and exercised
at DPR 1 in the required 907x510, 1920x1080 and 390x844 viewports. The run
included a 90-second assisted route, a forced crash/retry, garage/progression,
and a five-minute accelerated automated traffic trace. Existing viewport,
refresh-rate, lifecycle, persistence
and bounded-pool gates passed. This report deliberately records only the three
defects reproduced below.

1. **Landscape close-call progression is unreachable.** At 1920x1080, press
   PLAY and remain in the starting lane while the marked rival passes in the
   adjacent lane. The `CLOSE CALL CHALLENGE +15` prompt is displayed, but no
   `CLOSE!`/chain reward is granted: the road has 435px lanes while the rendered
   car is capped at 140px. The eligibility expression at
   `src/main.js:420-421` therefore compares a 295px edge gap with a 252px
   allowance. This makes the advertised early-loop reward and the near-miss
   missions materially slower on the largest official viewport. Evidence:
   `qa/hardening/1920x1080-gameplay.png` shows the marked rival one discrete
   lane away, plus the live debug state after the pass (`nmChain: 0`).

2. **Nitro speed is visually clipped at high speed.** Survive past the first
   speed ramp, collect/use nitro, and read the lower-right dial. The digital
   readout can reach 648 KM/H (`1440px/s * 0.45`), while
   `src/main.js:1204-1205` fixes the dial maximum to 460 KM/H and clamps the
   needle/fill to 100%. The player loses the useful distinction between fast
   cruising and full nitro, precisely when the visual feedback should be most
   legible. Evidence state: `speedKmh() === 648`, `maxV === 460`,
   `Math.min(1, 648 / 460) === 1`.

3. **The garage has no keyboard-operable carousel or primary action.** From
   the menu, open GARAGE with the pointer, then press Left/Right or Enter/Space.
   Nothing changes: `src/main.js:1909-1913` sends Left/Right only to
   `moveLane()`, which immediately exits outside `playing`, and provides no
   garage action for Enter/Space. A keyboard or switch-control player can only
   leave with Escape; they cannot inspect, select, or buy a vehicle. Evidence
   state: garage index and selected car remain unchanged after all four keys.
