// Shared fixed-step primitives. Keeping this DOM-free lets the same timing
// contract be exercised at several display refresh rates in Node.
export const FIXED_STEP = 1 / 120;

export function consumeFixedSteps(accumulator, elapsed, step, advance, maxSteps = 16) {
  let acc = Math.min(accumulator + Math.max(0, elapsed), step * maxSteps);
  let steps = 0;
  while (acc + 1e-10 >= step && steps < maxSteps) {
    advance(step);
    acc = Math.max(0, acc - step);
    steps++;
  }
  return { accumulator: acc, steps };
}

// A small deterministic model of the shipped time-based speed/distance ramp.
// It is intentionally independent of canvas rendering and is used by the
// refresh-rate proof gate.
export function simulateTimeline(refreshHz, seconds, seed = 0xdecafbad) {
  let acc = 0, t = 0, dist = 0, spawnClock = 4.4, spawns = 0, rng = seed >>> 0;
  const random = () => ((rng = (rng * 1664525 + 1013904223) >>> 0) / 4294967296);
  const frames = Math.round(refreshHz * seconds);
  for (let frame = 0; frame < frames; frame++) {
    const out = consumeFixedSteps(acc, 1 / refreshHz, FIXED_STEP, (dt) => {
      t += dt;
      const speed = 340 + Math.min(560, t * 9);
      dist += speed * dt * 0.05;
      spawnClock -= dt;
      if (spawnClock <= 0) {
        spawns++;
        const effT = t < 60 ? t * 0.55 : 33 + (t - 60);
        spawnClock += Math.max(0.42, 1.15 - effT * 0.012) + random() * 0.000001;
      }
    });
    acc = out.accumulator;
  }
  return { time: t, distance: dist, spawns };
}
