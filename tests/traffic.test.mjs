import assert from 'node:assert/strict';
import { chooseTrafficSpawn, mulberry32, reactionWindow } from '../src/traffic.js';

// Mutation-resistant invariants: changing the director to select every free
// lane (or removing the final reachable-lane reservation) fails these seeds.
for (let seed = 1; seed <= 400; seed++) {
  const random = mulberry32(seed);
  let active = [], playerLane = 1;
  for (let tick = 0; tick < 180; tick++) {
    const speed = 340 + Math.min(560, tick * 5);
    const plan = chooseTrafficSpawn({ random, speed, handling: 8 + (seed % 8), playerLane, active, playerY: 500, horizon: 90 });
    if (plan) {
      assert.ok(plan.safeLanes.length >= 1, `seed ${seed}: director consumed every safe lane`);
      assert.ok(plan.safeLanes.some((lane) => Math.abs(lane - playerLane) <= 1), `seed ${seed}: no reachable escape lane`);
      active.push({ lane: plan.lane, lanePos: plan.lane, y: -110, h: 90 });
    }
    for (const car of active) car.y += speed * 0.035;
    active = active.filter((car) => car.y < 650);
    const open = [0, 1, 2, 3].filter((lane) => !active.some((car) => car.lane === lane && car.y > 90 && car.y < 420));
    assert.ok(open.length >= 1, `seed ${seed}: all-lane wall at tick ${tick}`);
    playerLane = open.sort((a, b) => Math.abs(a - playerLane) - Math.abs(b - playerLane))[0];
  }
}
assert.ok(reactionWindow(900, 8).distance > reactionWindow(340, 8).distance, 'faster traffic needs more reaction distance');
assert.ok(reactionWindow(600, 15).seconds < reactionWindow(600, 8).seconds, 'handling must improve the reaction window');
console.log('TRAFFIC DIRECTOR PASSED: 400 seeded runs, escape lane and speed/handling windows');
