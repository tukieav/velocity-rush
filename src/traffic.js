// Deterministic, conservative traffic director. It never schedules a new car
// into the final reachable lane and spaces rows by a speed/handling-dependent
// reaction window.
export function reactionWindow(speed, handling) {
  const reactionSeconds = Math.max(0.72, Math.min(1.25, 1.22 - (handling - 8) * 0.055));
  return { seconds: reactionSeconds, distance: Math.round(speed * reactionSeconds + 110) };
}

// Desktop lanes grow with the viewport, so traffic must grow with them too.
// Otherwise the discrete adjacent-lane pass is visually and mechanically too
// distant to earn its intended close-call reward on wide CrazyGames canvases.
export function trafficCarWidth(laneWidth, isDesktop) {
  return isDesktop ? Math.min(200, Math.max(64, laneWidth * 0.55)) : 54;
}

export function isMarkedNearMiss(playerX, obstacleX, laneWidth, carWidth) {
  const edgeGap = Math.abs(obstacleX - playerX) - carWidth;
  return edgeGap < Math.max(15, laneWidth * 0.58) && edgeGap > -carWidth * 0.5;
}

export function chooseTrafficSpawn({ random, speed, handling, playerLane, active, lanes = 4, horizon = 90, playerY = 500 }) {
  const window = reactionWindow(speed, handling);
  // A car claims its lane for the whole visible approach. The reaction window
  // then controls row spacing in the caller; being conservative here prevents
  // staggered rows from becoming an all-lane wall later in the approach.
  const claimed = new Set();
  for (const o of active) {
    if (o.y <= playerY - 30) claimed.add(Math.round(o.lanePos ?? o.lane));
  }
  const free = Array.from({ length: lanes }, (_, lane) => lane).filter((lane) => !claimed.has(lane));
  // Preserve an escape route and preferentially leave the player lane / an
  // adjacent lane open. Returning null is a valid director decision.
  if (free.length <= 1) return null;
  const escape = free.filter((lane) => Math.abs(lane - playerLane) <= 1);
  const candidates = free.filter((lane) => !(escape.length === 1 && lane === escape[0]));
  const pool = candidates.length ? candidates : free.filter((lane) => lane !== playerLane);
  if (!pool.length) return null;
  const lane = pool[Math.floor(random() * pool.length)];
  return { lane, window, claimed: [...claimed], safeLanes: free.filter((x) => x !== lane) };
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
