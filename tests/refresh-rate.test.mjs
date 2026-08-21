import assert from 'node:assert/strict';
import { simulateTimeline } from '../src/sim.js';

const baseline = simulateTimeline(60, 120);
for (const hz of [144, 165]) {
  const actual = simulateTimeline(hz, 120);
  assert.ok(Math.abs(actual.time - baseline.time) <= 1 / 120, `${hz}Hz time drift`);
  assert.ok(Math.abs(actual.distance - baseline.distance) < 0.05, `${hz}Hz distance drift`);
  assert.equal(actual.spawns, baseline.spawns, `${hz}Hz spawn count drift`);
}
console.log('REFRESH-RATE PASSED:', baseline);
