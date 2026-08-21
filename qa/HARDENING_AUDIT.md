# Velocity Rush hardening audit

Audit date: 2026-08-21.  Baseline exercised from the freshly built local
`dist/` at DPR 1: menu, garage, play, lane changes, forced crash/restart and
progression persistence at 907x510 and 1920x1080. The existing desktop gate
also covered menu, garage and opening play at 1280x720, 1920x1080 and
390x844. The loop is an endless four-lane dodge racer: collect coins and
nitro, take deliberate close passes for a chain bonus, bank coins on a crash,
then buy cars/upgrades and advance missions. Its visual depth comes from the
procedural synthwave city, parallax road and vehicle silhouettes.

## Prioritized findings before hardening

1. **FAIL — no complete required viewport gate.** `tools/e2e-desktop.cjs:8-12`
   tests only three sizes, not the ten mandatory landscape sizes, and has no
   button visibility/overlap or touch assertion.
2. **FAIL — lifecycle is not suspended.** `src/main.js:1719-1728` schedules an
   unconditional RAF loop; no `visibilitychange`, `blur`, or SDK-ad pause
   handler exists. Simulation and WebAudio can continue in background.
3. **FAIL — traffic fairness is only a near-spawn lane count.**
   `src/main.js:255-276` excludes lanes only while `y < 320`; it does not
   calculate a reaction window at current speed/handling or reserve a reachable
   lane at the player. Repeated rows can create an unfair late wall.
4. **FAIL — random traffic has no seeded stress coverage.**
   `src/main.js:248-276` uses `Math.random()` directly and the test suite has
   no many-seed spawn fairness test.
5. **PARTIAL — the marked rival is not a true pre-near-miss telegraph.**
   `src/main.js:164-168` marks one opening car and `src/main.js:1082-1089`
   draws its ring only while `G.time < 8`; ordinary rewarding passes remain
   random proximity and the chain timer has no readable decay state until x2.
6. **PARTIAL — frame dependence remains in visual spawning.**
   `src/main.js:309-316` emits nitro particles on per-frame probability, and
   `src/main.js:1719-1724` integrates a variable clamped frame delta rather
   than a fixed simulation step. No 60/144/165 Hz equivalence test exists.
7. **PARTIAL — long-run pools are unbounded at creation.**
   `src/main.js:118-121`, `src/main.js:307-316`, `src/main.js:346-352` append
   particles/trail/traffic without caps. Normal expiry helps, but a slow frame
   or crash burst can still exceed a defensible budget.
8. **PARTIAL — restart can wait for a midgame ad.** `src/main.js:247-253`
   awaits `requestAd('midgame')` before `startGame()`, so a remote ad can block
   the promised sub-second local restart.
9. **PARTIAL — input has broad global touch suppression and no pointer cancel.**
   `index.html:11-14` applies `touch-action: none` to the whole page and
   `src/main.js:1767-1804` lacks `pointercancel`, capture and explicit
   touch-path validation. Arrow keys are present, but the touch implementation
   needs a safer mobile path.
10. **FAIL — marketing taxonomy is stale and inaccurate.**
    `marketing/SUBMISSION.md:8-14` calls the category Racing and lists
    invented SEO tags. The supplied validated map requires primary **Driving**
    and exact tags Car, Traffic, Racing, Mobile, Skill, 2D.

## Quit-risk assessment

| Moment | Likely quit cause | Evidence | Severity |
|---|---|---|---|
| First 10 seconds | No persistent explanation of the marked rival / close-pass reward after the brief opening card; a player can treat it as arbitrary dodge traffic. | `src/main.js:1082-1089`, `1246-1263` | High |
| First 60 seconds | Traffic rows can be mathematically passable at spawn but unreachable as speed rises; difficulty accelerates from time, not a reaction budget. | `src/main.js:255-276`, `329-334` | Critical |
| Five minutes | Uncapped effect and spawn allocations plus background simulation increase performance/battery risk; no soak proof. | `src/main.js:307-316`, `346-352`, `1719-1728` | High |

## Requirement matrix (baseline)

| Requirement | Baseline | Evidence / disposition |
|---|---|---|
| Gameplay after at most one click | PASS | PLAY invokes `startGame` directly, `src/main.js:1761-1762`. |
| English intuitive controls | PASS | `src/main.js:1740-1747`, first-run hint `src/main.js:1197-1208`. |
| Required 10 DPR=1 viewport gate | FAIL | only three sizes in `tools/e2e-desktop.cjs:8-12`. |
| 60/144/165 Hz consistency | PARTIAL | time delta movement, but variable-step loop and no proof, `src/main.js:1719-1728`. |
| Visibility/blur/ad lifecycle | FAIL | no lifecycle listeners. |
| Save/malformed-save fallback | PASS | migration fallback in `src/meta.js:78-91`; reload test exists. |
| Soak/performance bounds | FAIL | no 120 s gate or hard pool limits. |
| Keyboard/mouse/touch and 44px mobile targets | PARTIAL | controls exist; no touch gate and small controls in garage. |
| SDK/audio handling | PARTIAL | init timeout/mute/happytime exist, but ad does not lifecycle-pause simulation. |
| Reduced motion / accessibility | FAIL | no media-query adaptation or player mute UI. |
| PEGI 12 suitability | PASS | stylized crash, no blood; submission incorrectly says all ages. |
| No custom fullscreen/cross-promo | PASS | none present. |

## Marketing audit

The gameplay description is broadly accurate but must remove the unsupported
"insane speed" and generic portal tags. The primary category is **Driving**
(not Racing); secondary discovery is Arcade; exact verified tags are **Car,
Traffic, Racing, Mobile, Skill, 2D**. Existing screenshots/videos are from the
pre-hardening build and must be regenerated after final visual validation.
