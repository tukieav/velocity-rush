// Velocity Rush — neon endless lane racer for CrazyGames
import { initSDK, gameplayStart, gameplayStop, loadingStart, loadingStop, happytime, requestAd, getMuteSetting, onSettingsChange, loadBest, saveBest } from './sdk.js';
import * as audio from './audio.js';
import { CARS, UPGRADES, M, loadMeta, saveMeta, getCar, nitroDuration, magnetRadius, hasShield, buyCar, selectCar, buyUpgrade, activeMissions, commitRun, addWallet, claimDaily } from './meta.js';
import { FIXED_STEP, consumeFixedSteps } from './sim.js';
import { chooseTrafficSpawn, isMarkedNearMiss, trafficCarWidth } from './traffic.js';
import { speedometerGauge } from './feedback.js';

// The simulation is expressed in CSS pixels.  On phones it keeps the original
// portrait composition; on desktop it becomes a real landscape canvas instead
// of scaling a phone-shaped render into a letterboxed page.
let W = 540, H = 960;
const LANES = 4;
let ROAD_X = 90, ROAD_W = 360;
let LANE_W = ROAD_W / LANES;
const laneX = (i) => ROAD_X + LANE_W * (i + 0.5);
let PLAYER_Y = H * 0.76;
let CAR_W = 54, CAR_H = 92;
let TRUCK_H = 184;
let HORIZON = 96;
let isDesktop = false;
let sceneryReady = false;
const MAX_TRAFFIC = 18, MAX_PICKUPS = 36, MAX_PARTICLES = 240, MAX_FLOATERS = 20, MAX_TRAIL = 90;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
function resize() {
  const oldW = W, oldH = H;
  const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = vw; H = vh;
  isDesktop = W / H >= 1.08;
  HORIZON = Math.max(70, H * (isDesktop ? 0.15 : 0.10));
  PLAYER_Y = H * (isDesktop ? 0.76 : 0.76);
  // A wide road keeps lanes legible at 1080p while preserving the familiar
  // compact four-lane proportions in portrait.
  ROAD_W = isDesktop ? Math.min(W * 0.84, W - 180) : Math.min(360, W * 0.72);
  ROAD_W = Math.max(300, ROAD_W);
  ROAD_X = (W - ROAD_W) / 2;
  LANE_W = ROAD_W / LANES;
  CAR_W = trafficCarWidth(LANE_W, isDesktop);
  CAR_H = CAR_W * 1.70;
  TRUCK_H = CAR_H * 2;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The city and roadside layers contain positions generated from the logical
  // viewport. Rebuild them after a real size change so rotating a device or
  // resizing a desktop window never exposes a portrait-sized background.
  if (sceneryReady && (oldW !== W || oldH !== H)) rebuildScenery();
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
let state = 'boot'; // boot -> menu -> playing -> gameover | garage
let best = 0;
let debug = new URLSearchParams(location.search).has('debug');
const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let userMuted = false;
let dailyBonus = 0;      // shown on menu once per day
let firstRun = true;     // contextual hint on first run
let garageIdx = 0;       // car carousel index
let runResult = null;    // { earned, missions, doubled }

const G = {
  lane: 1,           // target lane
  playerX: laneX(1),
  dist: 0,           // meters
  coins: 0,
  speed: 0,          // px/s world scroll
  baseSpeed: 0,
  nitroT: 0,         // nitro time left
  nitroMax: 3,
  nitroTrail: [],
  invulnT: 0,
  usedContinue: false,
  shieldReady: false,
  obstacles: [],     // {lane, y, h, color, truck, passed}
  pickups: [],       // {lane, y, kind:'coin'|'nitro', taken}
  particles: [],
  floaters: [],      // {x,y,text,t,color}
  shake: 0,
  coinCombo: 0,
  coinComboT: 0,
  // near-miss chain (short-loop reward)
  nmChain: 0,
  nmChainT: 0,
  // per-run stats for meta
  runNearMisses: 0,
  runNitros: 0,
  runBestChain: 0,
  time: 0,
  spawnT: 0,
  pickupT: 0,
  markedCooldown: 0,
  nextHappy: 1000,
  roadScroll: 0,
  texScroll: 0,
  railScroll: 0,
  crashDone: false,
  crashing: false,
  slowmoT: 0,
  flash: 0,
  tilt: 0,
  fov: 1,
};

let stars = [];
let props = [];

const PALETTE = ['#ff2d78', '#ffb300', '#7c4dff', '#00e5ff', '#76ff03', '#ff6d00'];

// ---------- helpers ----------
function rnd(a, b) { return a + Math.random() * (b - a); }
function speedKmh() { return Math.round(G.speed * 0.45); }

function addFloater(x, y, text, color) {
  boundedPush(G.floaters, { x, y, text, t: 1, color: color || '#fff' }, MAX_FLOATERS);
}

function boundedPush(list, item, max) {
  if (list.length >= max) list.splice(0, list.length - max + 1);
  list.push(item);
}

function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rnd(0.3, 1) * (spd || 260);
    boundedPush(G.particles, { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 1, color, r: rnd(2, 5) }, MAX_PARTICLES);
  }
}

// ---------- run lifecycle ----------
function resetRun() {
  G.lane = 1; G.playerX = laneX(1);
  G.dist = 0; G.coins = 0;
  G.baseSpeed = 340; G.speed = G.baseSpeed;
  G.nitroT = 0; G.invulnT = 0; G.usedContinue = false;
  G.nitroMax = nitroDuration();
  G.shieldReady = hasShield();
  G.obstacles = []; G.pickups = []; G.particles = []; G.floaters = [];
  G.nitroTrail = [];
  G.shake = 0; G.coinCombo = 0; G.coinComboT = 0;
  G.nmChain = 0; G.nmChainT = 0;
  G.runNearMisses = 0; G.runNitros = 0; G.runBestChain = 0;
  G.time = 0; G.spawnT = 4.4; G.pickupT = 5.0; G.markedCooldown = 0; G.nextHappy = 1000;
  G.crashDone = false;
  G.crashing = false; G.slowmoT = 0; G.flash = 0;
  G.tilt = 0; G.fov = 1; G.texScroll = 0; G.railScroll = 0;
  // Script the first few seconds instead of asking the random spawner to make
  // a good first impression. Outside cars frame a safe starting lane; the
  // marked car is far enough ahead to invite, rather than force, a close pass.
  const opening = [
    { lane: 0, y: HORIZON + 30, rel: 0.78, color: '#ff2d78', shape: 4 },
    { lane: 3, y: HORIZON - 86, rel: 0.73, color: '#ffb300', shape: 1 },
    { lane: 2, y: HORIZON - 244, rel: 0.78, color: '#00e5ff', shape: 6, marked: true },
  ];
  for (const o of opening) boundedPush(G.obstacles, { ...o, lanePos: o.lane, h: CAR_H, truck: false, passed: false, intro: true, telegraph: !!o.marked }, MAX_TRAFFIC);
  // The reward line reaches the readable mid-road area in the opening moments
  // without dropping a pickup underneath the player at launch.
  for (let i = 0; i < 5; i++) boundedPush(G.pickups, { lane: 1, y: HORIZON - 690 - i * 54, kind: 'coin', intro: true }, MAX_PICKUPS);
  runResult = null;
}

function startGame() {
  resetRun();
  state = 'playing';
  audio.unlockAudio();
  audio.startEngine();
  gameplayStart();
}

function applyMute() { audio.setMuted(mutedBySettings || userMuted); }

function debrisBurst(x, y, color) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, v = rnd(120, 520);
    boundedPush(G.particles, {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: rnd(0.7, 1.3),
      color: i % 3 === 0 ? '#20242e' : color,
      r: 0, w: rnd(4, 13), h2: rnd(3, 8), rot: Math.random() * Math.PI, vr: rnd(-9, 9),
    }, MAX_PARTICLES);
  }
}

function doCrash() {
  if (G.crashDone || G.crashing) return;
  // permanent shield upgrade: survive one crash per run
  if (G.shieldReady) {
    G.shieldReady = false;
    G.invulnT = 2;
    G.shake = 14;
    addFloater(G.playerX, PLAYER_Y - 80, 'SHIELD SAVED YOU!', '#76ff03');
    burst(G.playerX, PLAYER_Y, '#76ff03', 40, 360);
    audio.nitroSound();
    return;
  }
  // slow-mo crash sequence: flash + debris, then game over 0.35s later
  G.crashing = true;
  G.slowmoT = 0.35;
  G.flash = 0.9;
  G.shake = 26;
  audio.stopEngine();
  audio.crashSound();
  burst(G.playerX, PLAYER_Y, '#ff9040', 40, 420);
  burst(G.playerX, PLAYER_Y, '#00e5ff', 20, 320);
  debrisBurst(G.playerX, PLAYER_Y, getCar().color);
}

function finishCrash() {
  G.crashDone = true;
  state = 'gameover';
  gameplayStop();
  const score = Math.floor(G.dist);
  if (score > best) { best = score; saveBest(best); }
  // commit run to meta-progression (wallet, stats, missions)
  runResult = commitRun({
    dist: G.dist, coins: G.coins,
    nearMisses: G.runNearMisses, nitros: G.runNitros, bestChain: G.runBestChain,
  });
  runResult.doubled = false;
  if (runResult.missions.length) happytime();
  setTimeout(() => audio.gameOverSound(), 200);
}

async function continueRun() {
  if (G.usedContinue || state !== 'gameover') return;
  const prevMute = mutedBySettings;
  const ok = await requestAd('rewarded', {
    onStart: () => { setPaused('ad', true); audio.setMuted(true); },
    onFinish: () => { audio.setMuted(prevMute || userMuted); setPaused('ad', false); },
  });
  if (ok) {
    G.usedContinue = true;
    G.crashDone = false;
    G.crashing = false; G.slowmoT = 0; G.flash = 0;
    G.invulnT = 2;
    // clear obstacles near the player so respawn is fair
    G.obstacles = G.obstacles.filter(o => o.y + o.h < PLAYER_Y - 150 || o.y > PLAYER_Y + 200);
    state = 'playing';
    audio.startEngine();
    gameplayStart();
  }
}

// Rewarded: double the coins earned this run
async function doubleCoins() {
  if (!runResult || runResult.doubled || state !== 'gameover') return;
  const prevMute = mutedBySettings;
  const ok = await requestAd('rewarded', {
    onStart: () => { setPaused('ad', true); audio.setMuted(true); },
    onFinish: () => { audio.setMuted(prevMute || userMuted); setPaused('ad', false); },
  });
  if (ok) {
    addWallet(runResult.earned);
    runResult.doubled = true;
    audio.coinSound(8);
    happytime();
  }
}

async function playAgain() {
  // Restart is immediate; any optional break belongs after a natural run end
  // and must never hold the local one-more-try loop hostage.
  startGame();
}

// ---------- spawning ----------
function spawnObstacle() {
  if (G.obstacles.length >= MAX_TRAFFIC) return;
  const plan = chooseTrafficSpawn({
    random: Math.random, speed: G.speed || G.baseSpeed, handling: getCar().handling,
    playerLane: G.lane, active: G.obstacles, lanes: LANES, horizon: HORIZON, playerY: PLAYER_Y,
  });
  if (!plan) return;
  const truck = Math.random() < 0.22;
  const h = truck ? TRUCK_H : CAR_H;
  const y = -h - 20;
  // The opening is deliberately readable: traffic starts beside the player,
  // providing a safe early weave and a near-miss opportunity before density
  // rises.  Afterwards the original passable-lane rule takes over.
  const lane = plan.lane;
  const rel = rnd(0.32, 0.5); // obstacle moves at rel * player speed (slower traffic)
  const marked = G.time > 5 && G.markedCooldown <= 0 && !G.obstacles.some((o) => o.marked);
  if (marked) G.markedCooldown = 5.5;
  const targetLane = lane > 0 && Math.random() < 0.5 ? lane - 1 : lane < LANES - 1 ? lane + 1 : lane;
  const signal = G.time > 14 && !marked && targetLane !== lane && Math.random() < 0.16;
  boundedPush(G.obstacles, { lane, lanePos: lane, y, h, rel, truck, shape: Math.floor(Math.random() * 8), color: PALETTE[Math.floor(Math.random() * PALETTE.length)], passed: false, marked, telegraph: marked, reaction: plan.window, signal, targetLane, signalT: signal ? 1.0 : 0, changing: false, changeT: 0 }, MAX_TRAFFIC);
}

function spawnPickup() {
  const blocked = new Set();
  for (const o of G.obstacles) if (o.y < 300) blocked.add(o.lane);
  const free = [];
  for (let i = 0; i < LANES; i++) if (!blocked.has(i)) free.push(i);
  if (!free.length) return;
  const lane = free[Math.floor(Math.random() * free.length)];
  // Put the first boost in sight quickly so the player learns the nitro loop.
  if (G.time < 7 || Math.random() < 0.18) {
    boundedPush(G.pickups, { lane, y: -40, kind: 'nitro' }, MAX_PICKUPS);
  } else {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) boundedPush(G.pickups, { lane, y: -40 - i * 54, kind: 'coin' }, MAX_PICKUPS);
  }
}

// ---------- update ----------
let mutedBySettings = false;

function update(dt) {
  if (G.crashing) {
    G.slowmoT -= dt;
    if (G.slowmoT <= 0) { G.crashing = false; finishCrash(); }
    else dt *= 0.22;
  }
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 2.5);
  G.time += dt;
  G.markedCooldown = Math.max(0, G.markedCooldown - dt);
  // stars parallax always
  for (const s of stars) { s.y += s.s * 6 * dt; if (s.y > 90) { s.y = 0; s.x = Math.random() * W; } }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 40);
  // particles & floaters always update
  for (const p of G.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.t -= dt * 1.4; if (p.vr) p.rot += p.vr * dt; }
  G.particles = G.particles.filter(p => p.t > 0);
  for (const f of G.floaters) { f.y -= 60 * dt; f.t -= dt * 0.8; }
  G.floaters = G.floaters.filter(f => f.t > 0);

  if (state !== 'playing') return;

  // speed ramps with time; nitro multiplies
  G.baseSpeed = 340 + Math.min(560, G.time * 9);
  const nitroMul = G.nitroT > 0 ? 1.6 : 1;
  G.speed = G.baseSpeed * nitroMul;
  if (G.nitroT > 0) {
    G.nitroT -= dt;
    G.shake = Math.max(G.shake, 3);
    boundedPush(G.nitroTrail, { x: G.playerX + rnd(-14, 14), y: PLAYER_Y + CAR_H / 2, t: 1 }, MAX_TRAIL);
  }
  for (const f of G.nitroTrail) f.t -= dt * 2.2;
  G.nitroTrail = G.nitroTrail.filter(f => f.t > 0);
  // FOV-like widening under nitro
  G.fov += ((G.nitroT > 0 ? 1.055 : 1) - G.fov) * Math.min(1, dt * 5);
  // exhaust sparks under nitro
  if (G.nitroT > 0 && Math.random() < 0.85) {
    boundedPush(G.particles, {
      x: G.playerX + rnd(-12, 12), y: PLAYER_Y + CAR_H / 2 + 4,
      vx: rnd(-90, 90), vy: rnd(180, 400), t: rnd(0.35, 0.8),
      color: Math.random() < 0.5 ? '#ffd76a' : '#ff9040', r: rnd(1.5, 3),
    }, MAX_PARTICLES);
  }

  if (G.invulnT > 0) G.invulnT -= dt;

  audio.setEngineSpeed(Math.min(1.4, (G.speed - 300) / 500));

  // distance: px to meters
  G.dist += G.speed * dt * 0.05;
  if (G.dist >= G.nextHappy) { happytime(); G.nextHappy += 1000; addFloater(W / 2, H * 0.3, Math.floor(G.dist / 1000) + ' KM!', '#00e5ff'); }

  // player lerp to lane (handling stat: higher = snappier) + body roll
  const tx = laneX(G.lane);
  const prevPX = G.playerX;
  G.playerX += (tx - G.playerX) * Math.min(1, dt * getCar().handling);
  const vxs = (G.playerX - prevPX) / Math.max(dt, 1e-4);
  G.tilt += (Math.max(-0.10, Math.min(0.10, vxs * 0.00028)) - G.tilt) * Math.min(1, dt * 12);

  // road scroll
  G.roadScroll = (G.roadScroll + G.speed * dt) % 80;
  G.texScroll = (G.texScroll + G.speed * dt) % 160;
  G.railScroll = (G.railScroll + G.speed * dt) % 70;

  // roadside choreography: dense rhythm on desktop, while portrait keeps a
  // little breathing room.  Each recycled prop gets a new readable silhouette.
  for (const p of props) {
    p.y += G.speed * dt * 0.9;
    if (p.y > H + 100) {
      p.y = HORIZON - 80;
      const kinds = ['lamp', 'barrier', 'bill', 'palm', 'tower'];
      p.kind = kinds[Math.floor(Math.random() * kinds.length)];
      p.billHue = Math.random() < 0.5 ? '#ff2d78' : '#00e5ff';
      p.billTxt = ['NEON', 'RUSH', 'TURBO', 'DRIVE', '24H'][Math.floor(Math.random() * 5)];
    }
  }

  // spawn — dynamic difficulty: traffic density ramps slower in the 1st minute
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    spawnObstacle();
    const effT = G.time < 60 ? G.time * 0.55 : 33 + (G.time - 60);
    G.spawnT = Math.max(0.42, 1.15 - effT * 0.012);
  }
  G.pickupT -= dt;
  if (G.pickupT <= 0) { spawnPickup(); G.pickupT = rnd(1.8, 3.2); }

  // coin combo timer
  if (G.coinComboT > 0) { G.coinComboT -= dt; if (G.coinComboT <= 0) G.coinCombo = 0; }
  // near-miss chain window
  if (G.nmChainT > 0) { G.nmChainT -= dt; if (G.nmChainT <= 0) G.nmChain = 0; }

  // obstacles
  for (const o of G.obstacles) {
    o.y += G.speed * (1 - o.rel) * dt;
    // Signal vehicles light an indicator before changing lanes. They only
    // begin inside a readable mid-road window, never in the first safe intro.
    if (o.signal && !o.changing && o.y > HORIZON + 36) {
      o.signalT -= dt;
      if (o.signalT <= 0) { o.changing = true; o.changeT = 0; }
    }
    if (o.changing) {
      o.changeT = Math.min(1, o.changeT + dt / 0.7);
      o.lanePos = o.lane + (o.targetLane - o.lane) * o.changeT;
    }
    const ox = laneX(o.lanePos == null ? o.lane : o.lanePos);
    // Only telegraphed rivals grant close-pass chain credit. This makes the
    // reward a visible choice instead of an accidental proximity bonus.
    if (!o.passed && o.y > PLAYER_Y + CAR_H / 2) {
      o.passed = true;
      if (o.marked && isMarkedNearMiss(G.playerX, ox, LANE_W, CAR_W)) {
        // chain: consecutive near misses within 3s build a rising multiplier
        G.nmChain++;
        G.nmChainT = 3;
        G.runNearMisses++;
        if (G.nmChain > G.runBestChain) G.runBestChain = G.nmChain;
        const bonus = 15 * G.nmChain;
        G.dist += bonus;
        addFloater(G.playerX, PLAYER_Y - 70,
          G.nmChain > 1 ? 'CHAIN x' + G.nmChain + '! +' + bonus : 'CLOSE! +' + bonus,
          G.nmChain > 1 ? '#ff2d78' : '#ffe600');
        audio.nearMissSound();
        G.shake = Math.max(G.shake, 4 + G.nmChain);
        if (G.nmChain >= 3) happytime();
      }
    }
    // collision AABB
    if (!G.crashing && G.invulnT <= 0 &&
        Math.abs(ox - G.playerX) < CAR_W * 0.88 &&
        PLAYER_Y - CAR_H / 2 < o.y + o.h && PLAYER_Y + CAR_H / 2 > o.y) {
      doCrash();
      if (state !== 'playing') return;
    }
  }
  G.obstacles = G.obstacles.filter(o => o.y < H + 250).slice(-MAX_TRAFFIC);

  // pickups (coin magnet upgrade pulls coins toward the player)
  const magR = magnetRadius();
  for (const p of G.pickups) {
    p.y += G.speed * dt;
    if (magR > 0 && p.kind === 'coin' && !p.taken) {
      const px = p.mx != null ? p.mx : laneX(p.lane);
      const dx = G.playerX - px, dy = PLAYER_Y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < magR && d > 1) {
        const pull = 520 * dt;
        p.mx = px + (dx / d) * pull;
        p.y += (dy / d) * pull;
      }
    }
    const px = p.mx != null ? p.mx : laneX(p.lane);
    if (!p.taken && Math.abs(px - G.playerX) < LANE_W * 0.5 && Math.abs(p.y - PLAYER_Y) < 46) {
      p.taken = true;
      if (p.kind === 'coin') {
        G.coinCombo++; G.coinComboT = 1.4;
        const bonus = G.coinCombo >= 5 ? 2 : 1;
        G.coins += bonus;
        addFloater(px, p.y - 20, '+' + bonus + (G.coinCombo >= 5 ? ' x' + G.coinCombo : ''), '#ffd700');
        audio.coinSound(G.coinCombo);
        burst(px, p.y, '#ffd700', 6, 160);
      } else {
        G.nitroMax = nitroDuration();
        G.nitroT = G.nitroMax;
        G.runNitros++;
        addFloater(px, p.y - 20, 'NITRO!', '#00e5ff');
        audio.nitroSound();
        burst(px, p.y, '#00e5ff', 18, 280);
        G.shake = Math.max(G.shake, 8);
      }
    }
  }
  G.pickups = G.pickups.filter(p => !p.taken && p.y < H + 60).slice(-MAX_PICKUPS);
}

// ---------- drawing ----------
// visual helpers: fake perspective (converge toward horizon)
function perspT(y) { return Math.max(0, Math.min(1.12, (y - HORIZON) / (PLAYER_Y - HORIZON))); }
function perspS(y) { return 0.30 + 0.70 * Math.pow(perspT(y), 1.08); }
function perspX(x, y) { return W / 2 + (x - W / 2) * perspS(y); }
function perspQuad(x, y1, y2, hw) {
  const s1 = perspS(y1), s2 = perspS(y2);
  const x1 = perspX(x, y1), x2 = perspX(x, y2);
  ctx.beginPath();
  ctx.moveTo(x1 - hw * s1, y1);
  ctx.lineTo(x1 + hw * s1, y1);
  ctx.lineTo(x2 + hw * s2, y2);
  ctx.lineTo(x2 - hw * s2, y2);
  ctx.closePath();
}

function hexRgb(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hexA(c, a) { const v = hexRgb(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
function shade(c, k) {
  const v = hexRgb(c);
  const f = (x) => Math.max(0, Math.min(255, Math.round(k < 0 ? x * (1 + k) : x + (255 - x) * k)));
  return 'rgb(' + f(v[0]) + ',' + f(v[1]) + ',' + f(v[2]) + ')';
}

// pre-rendered asphalt noise
const noiseCv = document.createElement('canvas');
noiseCv.width = 160; noiseCv.height = 160;
{
  const nx = noiseCv.getContext('2d');
  for (let i = 0; i < 1400; i++) {
    nx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.14)';
    nx.fillRect(Math.random() * 160, Math.random() * 160, 1.6, 1.6);
  }
}
const asphaltPat = ctx.createPattern(noiseCv, 'repeat');

// City and roadside layers are generated for the current logical viewport.
// They are rebuilt by resize() so an orientation change does not retain a
// narrow portrait skyline on a newly wide canvas.
function genSkyline(hMin, hMax) {
  const b = []; let x = -50;
  while (x < W + 70) {
    const w = 24 + Math.random() * 48;
    b.push({
      x, w, h: hMin + Math.random() * (hMax - hMin),
      win: Math.random(), neon: Math.random() < 0.26,
      hue: Math.random() < 0.5 ? '#ff2d78' : '#00e5ff',
      ant: Math.random() < 0.3,
    });
    x += w + 2 + Math.random() * 9;
  }
  return b;
}
let SKY_FAR = [];
let SKY_MID = [];
let SKY_NEAR = [];
let MTS = [];

function rebuildScenery() {
  stars = Array.from({ length: 90 }, () => ({
    x: Math.random() * W, y: Math.random() * Math.max(92, HORIZON - 8),
    r: Math.random() * 1.6 + 0.4, s: Math.random() * 0.5 + 0.2,
  }));
  const propCount = isDesktop ? 34 : 16;
  const propKinds = ['lamp', 'barrier', 'bill', 'palm', 'tower', 'lamp', 'barrier', 'bill'];
  props = Array.from({ length: propCount }, (_, i) => ({
    y: HORIZON + (i / propCount) * (H - HORIZON + 80), left: i % 2 === 0,
    kind: propKinds[i % propKinds.length],
    billHue: i % 2 ? '#ff2d78' : '#00e5ff', billTxt: ['NEON', 'RUSH', 'TURBO', 'VOID', 'NITE'][i % 5],
  }));
  SKY_FAR = genSkyline(24, 52);
  SKY_MID = genSkyline(34, 74);
  SKY_NEAR = genSkyline(16, 40);
  MTS = [];
  for (let mx = -40; mx < W + 60;) {
    const mw = 80 + Math.random() * 120;
    MTS.push({ x: mx, w: mw, h: 28 + Math.random() * 36 });
    mx += mw * 0.55;
  }
}
rebuildScenery();
sceneryReady = true;

function drawSkyLayer(list, base, color, winColor, par, winA) {
  const off = (W / 2 - G.playerX) * par;
  ctx.fillStyle = color;
  for (const b of list) {
    const bx = b.x + off;
    ctx.fillRect(bx, base - b.h, b.w, b.h);
    if (b.ant) ctx.fillRect(bx + b.w / 2 - 1, base - b.h - 8, 2, 8);
  }
  for (const b of list) {
    const bx = b.x + off;
    let k = 0;
    ctx.fillStyle = winColor;
    ctx.globalAlpha = winA;
    for (let wy = base - b.h + 4; wy < base - 6; wy += 7) {
      for (let wx = bx + 3; wx < bx + b.w - 4; wx += 7) {
        k++;
        if (((Math.sin(b.win * 911 + k * 13.7) + 1) / 2) < 0.4) ctx.fillRect(wx, wy, 3, 3.5);
      }
    }
    ctx.globalAlpha = 1;
    if (b.neon && Math.sin(G.time * 2.6 + b.win * 40) > -0.35) {
      ctx.shadowColor = b.hue; ctx.shadowBlur = 9;
      ctx.fillStyle = b.hue;
      ctx.fillRect(bx + 2, base - b.h + 5, Math.min(b.w - 4, 17), 4.5);
      ctx.shadowBlur = 0;
    }
  }
}

function drawBackground() {
  // night sky -> synthwave dusk near horizon
  const bg = ctx.createLinearGradient(0, 0, 0, HORIZON + 26);
  bg.addColorStop(0, '#04030f');
  bg.addColorStop(0.55, '#0d0925');
  bg.addColorStop(1, '#33104e');
  ctx.fillStyle = bg; ctx.fillRect(-40, -40, W + 80, HORIZON + 66);
  // stars (twinkle)
  ctx.fillStyle = '#fff';
  for (const s of stars) {
    if (s.y < HORIZON - 6) {
      ctx.globalAlpha = (0.35 + s.s * 0.6) * (0.7 + 0.3 * Math.sin(G.time * 2 + s.x * 0.7));
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
  }
  ctx.globalAlpha = 1;
  // crescent moon
  ctx.shadowColor = '#cfe4ff'; ctx.shadowBlur = 22;
  ctx.fillStyle = '#e8f1ff';
  ctx.beginPath(); ctx.arc(W - 86, 32, 14, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0b0820';
  ctx.beginPath(); ctx.arc(W - 92, 28, 12, 0, Math.PI * 2); ctx.fill();
  // synthwave sun sinking behind skyline
  const sx0 = W * 0.60, sy0 = HORIZON + 4, sr = 54;
  ctx.save();
  ctx.beginPath(); ctx.arc(sx0, sy0, sr, Math.PI, 0); ctx.closePath(); ctx.clip();
  const sg = ctx.createLinearGradient(0, sy0 - sr, 0, sy0);
  sg.addColorStop(0, '#ffd76a'); sg.addColorStop(0.55, '#ff6d9e'); sg.addColorStop(1, '#ff2d78');
  ctx.fillStyle = sg; ctx.fillRect(sx0 - sr, sy0 - sr, sr * 2, sr);
  ctx.fillStyle = '#140a2c';
  for (let i = 0; i < 5; i++) ctx.fillRect(sx0 - sr, sy0 - 5 - i * 9, sr * 2, 1.6 + i * 0.9);
  ctx.restore();
  // mountains
  const mg = ctx.createLinearGradient(0, HORIZON - 60, 0, HORIZON);
  mg.addColorStop(0, '#221145'); mg.addColorStop(1, '#160b30');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.moveTo(-40, HORIZON);
  for (const m of MTS) { ctx.lineTo(m.x + m.w / 2, HORIZON - m.h); ctx.lineTo(m.x + m.w, HORIZON); }
  ctx.lineTo(W + 40, HORIZON);
  ctx.closePath(); ctx.fill();
  // skyline: far -> near with parallax
  drawSkyLayer(SKY_FAR, HORIZON, '#151038', '#ffb2d0', 0.02, 0.35);
  drawSkyLayer(SKY_MID, HORIZON, '#1c1444', '#ffe27a', 0.05, 0.55);
  drawSkyLayer(SKY_NEAR, HORIZON, '#251a54', '#9ff3ff', 0.09, 0.8);
  // horizon neon line
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 14;
  ctx.strokeStyle = 'rgba(255,45,120,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-30, HORIZON); ctx.lineTo(W + 30, HORIZON); ctx.stroke();
  ctx.shadowBlur = 0;
}

// 8 distinct procedural car silhouettes (garage catalog order)
const CARBODY = [
  { hood: 0.62, tail: 0.85, spoiler: 0, fin: 0, cab: [0.30, 0.62], stripe: 1 }, // VIPER  wedge
  { hood: 0.55, tail: 0.92, spoiler: 1, fin: 0, cab: [0.34, 0.64], stripe: 2 }, // COMET  muscle
  { hood: 0.44, tail: 0.78, spoiler: 1, fin: 1, cab: [0.30, 0.56], stripe: 0 }, // BOLT   formula
  { hood: 0.72, tail: 0.95, spoiler: 0, fin: 0, cab: [0.34, 0.70], stripe: 1 }, // MIDAS  luxury
  { hood: 0.38, tail: 0.84, spoiler: 1, fin: 1, cab: [0.28, 0.55], stripe: 2 }, // PHANTOM arrow
  { hood: 0.80, tail: 1.00, spoiler: 0, fin: 0, cab: [0.28, 0.74], stripe: 0 }, // TITAN  heavy
  { hood: 0.52, tail: 0.76, spoiler: 1, fin: 0, cab: [0.24, 0.52], stripe: 1 }, // AURORA proto
  { hood: 0.42, tail: 0.88, spoiler: 1, fin: 1, cab: [0.26, 0.54], stripe: 2 }, // APEX   hyper
];

function bodyPath(w, h, p) {
  const hw = w / 2, hh = h / 2;
  ctx.beginPath();
  ctx.moveTo(-hw * p.hood, -hh);
  ctx.quadraticCurveTo(-hw * 1.02, -hh * 0.45, -hw, -hh * 0.15);
  ctx.lineTo(-hw * 0.94, hh * 0.55);
  ctx.quadraticCurveTo(-hw * p.tail, hh * 0.92, -hw * p.tail * 0.8, hh);
  ctx.lineTo(hw * p.tail * 0.8, hh);
  ctx.quadraticCurveTo(hw * p.tail, hh * 0.92, hw * 0.94, hh * 0.55);
  ctx.lineTo(hw, -hh * 0.15);
  ctx.quadraticCurveTo(hw * 1.02, -hh * 0.45, hw * p.hood, -hh);
  ctx.quadraticCurveTo(0, -hh * 1.05, -hw * p.hood, -hh);
  ctx.closePath();
}

function drawCarShape(x, y, w, h, color, glow, headlights, shape = -1, tilt = 0) {
  const isTruck = h / w > 2.4;
  const p = CARBODY[((Math.max(0, shape) % 8) + 8) % 8];
  const hw = w / 2, hh = h / 2;
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  // neon underglow pool
  if (glow) {
    const ug = ctx.createRadialGradient(0, hh * 0.05, hw * 0.2, 0, hh * 0.05, hw * 2.0);
    ug.addColorStop(0, hexA(color, 0.5)); ug.addColorStop(1, hexA(color, 0));
    ctx.fillStyle = ug;
    ctx.beginPath(); ctx.ellipse(0, hh * 0.08, hw * 2.0, hh * 1.28, 0, 0, Math.PI * 2); ctx.fill();
  }
  // wheels peeking out
  ctx.fillStyle = '#07080f';
  const wys = isTruck ? [-hh * 0.72, -hh * 0.3, hh * 0.4, hh * 0.72] : [-hh * 0.52, hh * 0.5];
  for (const wy of wys) {
    for (const wx of [-hw * 0.94, hw * 0.94]) {
      roundRect(wx - w * 0.09, wy - h * (isTruck ? 0.06 : 0.10), w * 0.18, h * (isTruck ? 0.12 : 0.20), 3);
      ctx.fill();
    }
  }
  if (isTruck) {
    // truck: cab + container
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 14; }
    const cg = ctx.createLinearGradient(-hw, 0, hw, 0);
    cg.addColorStop(0, shade(color, -0.5)); cg.addColorStop(0.35, color);
    cg.addColorStop(0.5, shade(color, 0.3)); cg.addColorStop(0.65, color); cg.addColorStop(1, shade(color, -0.5));
    ctx.fillStyle = cg;
    roundRect(-hw * 0.92, -hh, w * 0.92, h * 0.26, 6); ctx.fill();  // cab
    ctx.shadowBlur = 0;
    ctx.fillStyle = shade(color, -0.35);
    roundRect(-hw, -hh + h * 0.28, w, h * 0.72, 5); ctx.fill();      // container
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      const ly = -hh + h * 0.28 + (h * 0.72) * (i / 5);
      ctx.beginPath(); ctx.moveTo(-hw + 3, ly); ctx.lineTo(hw - 3, ly); ctx.stroke();
    }
    // cab glass
    ctx.fillStyle = '#101a3a';
    ctx.fillRect(-hw * 0.6, -hh + h * 0.10, w * 0.6, h * 0.09);
    // side marker lights
    ctx.fillStyle = '#ffb300';
    for (let i = 0; i < 4; i++) {
      const ly = -hh + h * 0.36 + i * h * 0.16;
      ctx.fillRect(-hw - 1, ly, 3, 5); ctx.fillRect(hw - 2, ly, 3, 5);
    }
  } else {
    // body with paint reflection gradient
    bodyPath(w, h, p);
    const bg2 = ctx.createLinearGradient(-hw, 0, hw, 0);
    bg2.addColorStop(0, shade(color, -0.5));
    bg2.addColorStop(0.3, color);
    bg2.addColorStop(0.5, shade(color, 0.4));
    bg2.addColorStop(0.7, color);
    bg2.addColorStop(1, shade(color, -0.5));
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
    ctx.fillStyle = bg2; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // cabin glass
    const cy1 = -hh + h * p.cab[0], cy2 = -hh + h * p.cab[1];
    ctx.beginPath();
    ctx.moveTo(-hw * 0.62, cy1 + (cy2 - cy1) * 0.28);
    ctx.quadraticCurveTo(0, cy1 - (cy2 - cy1) * 0.18, hw * 0.62, cy1 + (cy2 - cy1) * 0.28);
    ctx.lineTo(hw * 0.56, cy2);
    ctx.quadraticCurveTo(0, cy2 + (cy2 - cy1) * 0.22, -hw * 0.56, cy2);
    ctx.closePath();
    const gl = ctx.createLinearGradient(0, cy1, 0, cy2);
    gl.addColorStop(0, '#0b1230'); gl.addColorStop(0.5, '#1c2c58'); gl.addColorStop(1, '#0a0f28');
    ctx.fillStyle = gl; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(180,220,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(-hw * 0.6, cy1); ctx.lineTo(-hw * 0.12, cy1);
    ctx.lineTo(-hw * 0.4, cy2); ctx.lineTo(-hw * 0.62, cy2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // racing stripes
    if (p.stripe === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-w * 0.05, -hh + 4, w * 0.10, h * p.cab[0] - 6);
      ctx.fillRect(-w * 0.05, cy2 + 3, w * 0.10, hh - cy2 - 7);
    } else if (p.stripe === 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      for (const sxx of [-w * 0.15, w * 0.06]) {
        ctx.fillRect(sxx, -hh + 4, w * 0.09, h * p.cab[0] - 6);
        ctx.fillRect(sxx, cy2 + 3, w * 0.09, hh - cy2 - 7);
      }
    }
    // front canards
    if (p.fin) {
      ctx.fillStyle = shade(color, -0.2);
      ctx.beginPath();
      ctx.moveTo(-hw * 0.96, -hh * 0.28); ctx.lineTo(-hw * 1.14, -hh * 0.12); ctx.lineTo(-hw * 0.94, -hh * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hw * 0.96, -hh * 0.28); ctx.lineTo(hw * 1.14, -hh * 0.12); ctx.lineTo(hw * 0.94, -hh * 0.02);
      ctx.closePath(); ctx.fill();
    }
    // rear wing
    if (p.spoiler) {
      ctx.fillStyle = shade(color, -0.55);
      ctx.fillRect(-hw * 1.0, hh * 0.72, w * 0.09, h * 0.16);
      ctx.fillRect(hw * 0.91, hh * 0.72, w * 0.09, h * 0.16);
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.fillStyle = shade(color, -0.25);
      ctx.fillRect(-hw * 1.04, hh * 0.76, w * 1.04, Math.max(3, h * 0.055));
      ctx.shadowBlur = 0;
    }
  }
  // lights
  if (headlights) {
    ctx.shadowColor = '#fff7d0'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#fffbe6';
    ctx.beginPath(); ctx.ellipse(-hw * Math.min(0.66, p.hood * 0.85), -hh + 4, w * 0.09, 3.4, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hw * Math.min(0.66, p.hood * 0.85), -hh + 4, w * 0.09, 3.4, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = '#ff2050'; ctx.shadowBlur = 9;
    ctx.fillStyle = '#ff2050';
    ctx.fillRect(-hw * 0.6, hh - 6, hw * 1.2, 3.6);
    ctx.shadowBlur = 0;
  } else {
    ctx.shadowColor = '#ff3040'; ctx.shadowBlur = 9;
    ctx.fillStyle = '#ff3546';
    ctx.fillRect(-hw * 0.58, hh - 6, hw * 1.16, 3.6);
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawNitroFlame(x, y) {
  const f = 0.72 + 0.28 * Math.sin(G.time * 42);
  ctx.save();
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 16;
  const layers = [['#7ce8ff', 78, 13, 0.8], ['#00e5ff', 55, 9, 0.9], ['#ffffff', 28, 4.5, 1]];
  for (const [col, len, hwF, a] of layers) {
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    for (const ex of [-CAR_W * 0.22, CAR_W * 0.22]) {
      ctx.beginPath();
      ctx.moveTo(x + ex - hwF, y);
      ctx.lineTo(x + ex, y + len * f);
      ctx.lineTo(x + ex + hwF, y);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRoad() {
  // ground beside the road
  const gg = ctx.createLinearGradient(0, HORIZON, 0, H);
  gg.addColorStop(0, '#170e2f'); gg.addColorStop(1, '#0a0d1e');
  ctx.fillStyle = gg; ctx.fillRect(-40, HORIZON, W + 80, H - HORIZON + 40);

  // road body (converging trapezoid)
  ctx.beginPath();
  ctx.moveTo(perspX(ROAD_X, HORIZON), HORIZON);
  for (let y = HORIZON; y <= H + 24; y += 32) ctx.lineTo(perspX(ROAD_X, y), y);
  for (let y = H + 24; y >= HORIZON; y -= 32) ctx.lineTo(perspX(ROAD_X + ROAD_W, y), y);
  ctx.closePath();
  const rg = ctx.createLinearGradient(0, HORIZON, 0, H);
  rg.addColorStop(0, '#171331'); rg.addColorStop(1, '#1d2140');
  ctx.fillStyle = rg; ctx.fill();

  ctx.save();
  ctx.clip();
  // asphalt noise texture scrolling with the world
  ctx.save();
  ctx.translate(0, G.texScroll || 0);
  ctx.fillStyle = asphaltPat;
  ctx.fillRect(-20, -180, W + 40, H + 380);
  ctx.restore();
  // wet asphalt: city neon reflections (converging colored streaks)
  const refl = [['#ff2d78', 0.14, ROAD_X + 45], ['#00e5ff', 0.12, ROAD_X + 150], ['#7c4dff', 0.11, ROAD_X + 235], ['#ffb300', 0.09, ROAD_X + 320]];
  for (const [col, a, x] of refl) {
    ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(G.time * 1.6 + x));
    const g2 = ctx.createLinearGradient(0, HORIZON, 0, H * 0.8);
    g2.addColorStop(0, col); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.moveTo(perspX(x - 7, HORIZON), HORIZON);
    ctx.lineTo(perspX(x + 7, HORIZON), HORIZON);
    ctx.lineTo(perspX(x + 17, H * 0.8), H * 0.8);
    ctx.lineTo(perspX(x - 17, H * 0.8), H * 0.8);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // tire wear marks per lane
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let l = 0; l < LANES; l++) {
    for (const dxm of [-15, 15]) {
      const x = laneX(l) + dxm;
      ctx.beginPath();
      ctx.moveTo(perspX(x - 3, HORIZON), HORIZON);
      ctx.lineTo(perspX(x + 3, HORIZON), HORIZON);
      ctx.lineTo(perspX(x + 5, H), H);
      ctx.lineTo(perspX(x - 5, H), H);
      ctx.closePath(); ctx.fill();
    }
  }
  // lamp light pools on the road
  for (const p of props) {
    if (p.kind !== 'lamp' || p.y < HORIZON) continue;
    const s = perspS(p.y);
    const edge = p.left ? ROAD_X + 40 : ROAD_X + ROAD_W - 40;
    const px = perspX(edge, p.y);
    const lg = ctx.createRadialGradient(px, p.y, 4, px, p.y, 95 * s);
    lg.addColorStop(0, 'rgba(255,226,122,0.16)'); lg.addColorStop(1, 'rgba(255,226,122,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.ellipse(px, p.y, 95 * s, 42 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // lane dashes: converge + motion-stretch with speed
  const dashLen = 42 + Math.min(70, Math.max(0, (G.speed - 340) * 0.07));
  for (let l = 1; l < LANES; l++) {
    const x = ROAD_X + LANE_W * l;
    for (let y = -80 + G.roadScroll; y < H; y += 80) {
      const y2 = y + dashLen;
      if (y2 < HORIZON + 2) continue;
      const ya = Math.max(y, HORIZON + 1);
      ctx.fillStyle = 'rgba(150,215,255,0.55)';
      perspQuad(x, ya, y2, 3);
      ctx.fill();
      if (dashLen > 60) { // blur ghost at speed
        ctx.fillStyle = 'rgba(150,215,255,0.16)';
        perspQuad(x, y2, y2 + dashLen * 0.5, 3);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // neon road edges (converging, glowing)
  for (const [ex, col] of [[ROAD_X - 3, '#ff2d78'], [ROAD_X + ROAD_W + 3, '#00e5ff']]) {
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(perspX(ex - 3, HORIZON), HORIZON);
    ctx.lineTo(perspX(ex + 3, HORIZON), HORIZON);
    for (let y = HORIZON; y <= H + 20; y += 40) ctx.lineTo(perspX(ex + 3, y), y);
    for (let y = H + 20; y >= HORIZON; y -= 40) ctx.lineTo(perspX(ex - 3, y), y);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // guardrail posts + beams
  const rs = G.railScroll || 0;
  for (const ex of [ROAD_X - 20, ROAD_X + ROAD_W + 20]) {
    for (let y = HORIZON + rs; y < H + 40; y += 70) {
      const s = perspS(y);
      const x = perspX(ex, y);
      ctx.fillStyle = '#252b4e';
      ctx.fillRect(x - 2.2 * s, y - 15 * s, 4.4 * s, 15 * s);
    }
    ctx.strokeStyle = 'rgba(125,145,210,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(perspX(ex, HORIZON), HORIZON - 4);
    for (let y = HORIZON; y <= H + 20; y += 36) ctx.lineTo(perspX(ex, y), y - 14 * perspS(y));
    ctx.stroke();
  }

  // roadside props: lampposts and neon palms, with speed smear
  const smear = Math.min(1, Math.max(0, (G.speed - 480) / 500));
  for (const p of props) {
    if (p.y < HORIZON - 6) continue;
    const s = perspS(p.y);
    const side = p.left ? ROAD_X - 52 : ROAD_X + ROAD_W + 52;
    const px = perspX(side, p.y);
    if (smear > 0.05) { // motion blur streak under prop
      ctx.globalAlpha = 0.16 * smear;
      ctx.fillStyle = p.kind === 'lamp' ? '#ffe27a' : '#7c4dff';
      ctx.fillRect(px - 2 * s, p.y - 40 * s, 4 * s, 70 * s * (0.6 + smear));
      ctx.globalAlpha = 1;
    }
    if (p.kind === 'bill') {
      // neon billboard on posts
      const bw = 64 * s, bh = 34 * s;
      ctx.fillStyle = '#20264a';
      ctx.fillRect(px - bw * 0.32, p.y - 58 * s, 4 * s, 58 * s);
      ctx.fillRect(px + bw * 0.28, p.y - 58 * s, 4 * s, 58 * s);
      const on = Math.sin(G.time * 3.1 + p.y * 0.03) > -0.5;
      ctx.fillStyle = '#0c0f24';
      ctx.fillRect(px - bw / 2, p.y - 58 * s - bh, bw, bh);
      ctx.strokeStyle = on ? p.billHue : 'rgba(90,90,130,0.5)';
      ctx.lineWidth = 2 * s;
      if (on) { ctx.shadowColor = p.billHue; ctx.shadowBlur = 12; }
      ctx.strokeRect(px - bw / 2, p.y - 58 * s - bh, bw, bh);
      if (on) {
        ctx.fillStyle = p.billHue;
        ctx.font = '900 ' + Math.max(6, Math.round(14 * s)) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.billTxt || 'NEON', px, p.y - 58 * s - bh / 2);
      }
      ctx.shadowBlur = 0;
    } else if (p.kind === 'lamp') {
      ctx.fillStyle = '#39406b';
      ctx.fillRect(px - 2.6 * s, p.y - 62 * s, 5.2 * s, 62 * s);
      const armDir = p.left ? 1 : -1;
      ctx.fillRect(px, p.y - 62 * s, armDir * 24 * s, 4 * s);
      ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.arc(px + armDir * 24 * s, p.y - 58 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (p.kind === 'barrier') {
      // chunky foreground crash barriers give the road a useful close layer
      // and punctuate the lamps instead of leaving a dark shoulder.
      const bw = 82 * s, bh = 20 * s;
      ctx.fillStyle = '#222a46';
      roundRect(px - bw / 2, p.y - bh, bw, bh, 3 * s); ctx.fill();
      ctx.fillStyle = '#ffb300';
      for (let stripe = -2; stripe <= 2; stripe++) {
        ctx.save(); ctx.translate(px + stripe * 18 * s, p.y - bh * 0.5); ctx.rotate(-0.48);
        ctx.fillRect(-3 * s, -bh * 0.52, 6 * s, bh * 1.05); ctx.restore();
      }
      ctx.fillStyle = '#3a4566';
      ctx.fillRect(px - bw * 0.32, p.y, 5 * s, 20 * s); ctx.fillRect(px + bw * 0.26, p.y, 5 * s, 20 * s);
    } else if (p.kind === 'tower') {
      // near roadside storefront / service tower with animated windows
      const tw = 44 * s, th = 116 * s;
      ctx.fillStyle = '#171b37'; ctx.fillRect(px - tw / 2, p.y - th, tw, th);
      ctx.fillStyle = 'rgba(170,230,255,0.5)';
      for (let wy = p.y - th + 12 * s; wy < p.y - 12 * s; wy += 18 * s) {
        ctx.fillRect(px - tw * 0.28, wy, tw * 0.16, 6 * s); ctx.fillRect(px + tw * 0.12, wy, tw * 0.16, 6 * s);
      }
      ctx.shadowColor = p.billHue; ctx.shadowBlur = 10;
      ctx.fillStyle = p.billHue; ctx.fillRect(px - tw * 0.6, p.y - th - 8 * s, tw * 1.2, 6 * s);
      ctx.shadowBlur = 0;
    } else {
      // neon palm
      ctx.strokeStyle = '#3a2b55'; ctx.lineWidth = 5 * s;
      ctx.beginPath(); ctx.moveTo(px, p.y); ctx.quadraticCurveTo(px + 6 * s, p.y - 30 * s, px + 3 * s, p.y - 56 * s); ctx.stroke();
      ctx.strokeStyle = '#8e5cff'; ctx.lineWidth = 3 * s;
      ctx.shadowColor = '#7c4dff'; ctx.shadowBlur = 8;
      for (let i = 0; i < 5; i++) {
        const fa = -Math.PI * 0.9 + i * (Math.PI * 0.42);
        ctx.beginPath();
        ctx.moveTo(px + 3 * s, p.y - 56 * s);
        ctx.quadraticCurveTo(px + 3 * s + Math.cos(fa) * 20 * s, p.y - 56 * s + Math.sin(fa) * 16 * s - 8 * s,
          px + 3 * s + Math.cos(fa) * 30 * s, p.y - 56 * s + Math.sin(fa) * 20 * s + 4 * s);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
  }
}

function drawGame() {
  ctx.save();
  const shakeAmt = (G.shake + Math.min(5, Math.max(0, (G.speed - 640) / 100))) * (reducedMotion ? 0.22 : 1);
  if (shakeAmt > 0) ctx.translate(rnd(-shakeAmt, shakeAmt) * 0.5, rnd(-shakeAmt, shakeAmt) * 0.5);
  // FOV-like widening under nitro
  const fov = G.fov || 1;
  if (!reducedMotion && fov > 1.002) {
    ctx.translate(W / 2, H * 0.62);
    ctx.scale(fov, 1 + (fov - 1) * 0.35);
    ctx.translate(-W / 2, -H * 0.62);
  }

  drawBackground();
  drawRoad();

  // pickups (perspective)
  for (const p of G.pickups) {
    const bx = p.mx != null ? p.mx : laneX(p.lane);
    const s = perspS(p.y);
    const x = p.mx != null ? p.mx : perspX(bx, p.y);
    if (p.y < HORIZON) continue;
    if (p.kind === 'coin') {
      ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
      const spin = 0.35 + 0.65 * Math.abs(Math.sin(G.time * 5 + p.y * 0.02));
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.ellipse(x, p.y, 13 * s * spin, 13 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a6a00';
      ctx.font = 'bold ' + Math.round(15 * s) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (spin > 0.6) ctx.fillText('$', x, p.y + 1);
    } else {
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#00e5ff';
      ctx.save();
      ctx.translate(x, p.y); ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(0, -18); ctx.lineTo(12, 0); ctx.lineTo(4, 0); ctx.lineTo(10, 18);
      ctx.lineTo(-12, -2); ctx.lineTo(-4, -2);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
    }
  }

  // traffic with taillight smears
  for (const o of G.obstacles) {
    const yc = o.y + o.h / 2;
    if (yc + o.h / 2 < HORIZON) continue;
    const s = perspS(yc);
    const x = perspX(laneX(o.lanePos == null ? o.lane : o.lanePos), yc);
    const streakL = Math.min(120, G.speed * (1 - o.rel) * 0.11);
    if (streakL > 16) {
      for (const lx of [-CAR_W * 0.28, CAR_W * 0.28]) {
        const sxp = x + lx * s;
        const gr = ctx.createLinearGradient(0, o.y + o.h, 0, o.y + o.h + streakL);
        gr.addColorStop(0, 'rgba(255,45,70,0.45)'); gr.addColorStop(1, 'rgba(255,45,70,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(sxp - 2.6 * s, o.y + o.h - 4, 5.2 * s, streakL);
      }
    }
    drawCarShape(x, yc, CAR_W * s, o.h * s, o.color, true, false, o.shape != null ? o.shape : 0, 0);
    if (o.marked && !o.passed) {
      ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = Math.max(1, 2 * s);
      ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.ellipse(x, yc, CAR_W * s * 0.82, o.h * s * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ff8fb3'; ctx.font = '900 ' + Math.max(10, Math.round(15 * s)) + 'px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PASS CLOSE +', x, o.y - 10 * s);
      ctx.shadowBlur = 0;
    }
    if (o.signal && !o.changing && o.y > HORIZON) {
      const dir = o.targetLane > o.lane ? 1 : -1;
      if (Math.floor(G.time * 5) % 2 === 0) {
        ctx.fillStyle = '#ffb300'; ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.arc(x + dir * CAR_W * s * 0.55, yc, Math.max(2, 4 * s), 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
    }
  }

  // nitro trail
  for (const f of G.nitroTrail) {
    ctx.globalAlpha = f.t * 0.9;
    ctx.fillStyle = f.t > 0.5 ? '#00e5ff' : '#ff9040';
    ctx.beginPath(); ctx.arc(f.x, f.y + (1 - f.t) * 70, 9 * f.t + 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // player
  if (state === 'playing' || state === 'menu') {
    const car = getCar();
    if (!(G.invulnT > 0 && Math.floor(G.time * 10) % 2 === 0)) {
      // headlight beams (converging toward horizon)
      const byTop = PLAYER_Y - CAR_H / 2 - 220;
      const hb = ctx.createLinearGradient(0, PLAYER_Y - CAR_H / 2, 0, byTop);
      hb.addColorStop(0, 'rgba(255,250,200,0.22)'); hb.addColorStop(1, 'rgba(255,250,200,0)');
      ctx.fillStyle = hb;
      ctx.beginPath();
      ctx.moveTo(G.playerX - CAR_W * 0.30, PLAYER_Y - CAR_H / 2);
      ctx.lineTo(perspX(G.playerX - CAR_W * 1.15, byTop), byTop);
      ctx.lineTo(perspX(G.playerX + CAR_W * 1.15, byTop), byTop);
      ctx.lineTo(G.playerX + CAR_W * 0.30, PLAYER_Y - CAR_H / 2);
      ctx.closePath(); ctx.fill();
      if (G.nitroT > 0) drawNitroFlame(G.playerX, PLAYER_Y + CAR_H / 2 - 4);
      drawCarShape(G.playerX, PLAYER_Y, CAR_W, CAR_H, car.color, true, true, car.shape, G.tilt || 0);
      if (G.shieldReady && state === 'playing') {
        ctx.strokeStyle = 'rgba(118,255,3,0.5)';
        ctx.shadowColor = '#76ff03'; ctx.shadowBlur = 10;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(G.playerX, PLAYER_Y, CAR_H * 0.72, 0, Math.PI * 2); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }

  // particles (circles + debris shards)
  for (const p of G.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.t));
    ctx.fillStyle = p.color;
    if (p.w) {
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot || 0);
      ctx.fillRect(-p.w / 2, -p.h2 / 2, p.w, p.h2);
      ctx.restore();
    } else {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // floaters
  for (const f of G.floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.t));
    ctx.fillStyle = f.color;
    ctx.font = '900 26px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = f.color; ctx.shadowBlur = 14;
    ctx.fillText(f.text, f.x, f.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // speed lines at screen edges (nitro / high speed)
  const spd = speedKmh();
  const slA = G.nitroT > 0 ? 0.9 : Math.max(0, Math.min(0.45, (spd - 250) / 400));
  if (slA > 0.05 && state === 'playing') {
    const nLines = reducedMotion ? 6 : (G.nitroT > 0 ? 26 : 14);
    for (let i = 0; i < nLines; i++) {
      const off = ((G.time * (760 + i * 83)) % (H + 260)) - 130;
      const edge = i % 2 === 0;
      const x = edge ? 6 + ((i * 13) % (G.nitroT > 0 ? 110 : 64)) : W - 6 - ((i * 13) % (G.nitroT > 0 ? 110 : 64));
      const len = 80 + 160 * slA;
      ctx.strokeStyle = 'rgba(220,240,255,' + (0.45 * slA * (1 - ((i * 7) % 10) / 14)).toFixed(3) + ')';
      ctx.lineWidth = 1.5 + (i % 3);
      ctx.beginPath(); ctx.moveTo(x, off); ctx.lineTo(x + (edge ? -5 : 5), off + len); ctx.stroke();
    }
  }
  // chromatic-aberration-like edge fringe at 300+ km/h
  const ca = Math.max(0, Math.min(1, (spd - 300) / 170));
  if (!reducedMotion && ca > 0 && state === 'playing') {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const gL = ctx.createLinearGradient(0, 0, 100, 0);
    gL.addColorStop(0, 'rgba(255,0,70,' + (0.28 * ca).toFixed(3) + ')'); gL.addColorStop(1, 'rgba(255,0,70,0)');
    ctx.fillStyle = gL; ctx.fillRect(0, 0, 100, H);
    const gR = ctx.createLinearGradient(W, 0, W - 100, 0);
    gR.addColorStop(0, 'rgba(0,230,255,' + (0.28 * ca).toFixed(3) + ')'); gR.addColorStop(1, 'rgba(0,230,255,0)');
    ctx.fillStyle = gR; ctx.fillRect(W - 100, 0, 100, H);
    ctx.restore();
  }
  // subtle vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = vg; ctx.fillRect(-40, -40, W + 80, H + 80);

  // crash flash
  if (G.flash > 0) {
    ctx.fillStyle = 'rgba(255,235,235,' + (G.flash * 0.75).toFixed(3) + ')';
    ctx.fillRect(-40, -40, W + 80, H + 80);
  }

  // contextual first-run hint
  if (state === 'playing' && firstRun && G.time < 6) {
    const a = G.time < 5 ? 1 : 6 - G.time;
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(G.time * 6));
    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 12;
    ctx.font = '900 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('\u2190  TAP / SWIPE / ARROWS  \u2192', W / 2, H * 0.58);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------- HUD ----------
function drawSpeedo() {
  const cx = W - 82, cy = H - 86, R = 60;
  const spd = speedKmh(), gauge = speedometerGauge(spd), maxV = gauge.max;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  ctx.save();
  ctx.globalAlpha = 0.92;
  const dg = ctx.createRadialGradient(cx, cy, 8, cx, cy, R + 8);
  dg.addColorStop(0, 'rgba(18,12,44,0.96)'); dg.addColorStop(1, 'rgba(6,4,20,0.82)');
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(cx, cy, R + 8, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,229,255,0.7)'; ctx.lineWidth = 2;
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(cx, cy, R + 7, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  // speed arc
  const frac = gauge.fraction;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx, cy, R - 8, a0, a1); ctx.stroke();
  const hot = spd > 300;
  ctx.strokeStyle = hot ? '#ff2d78' : '#00e5ff';
  ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(cx, cy, R - 8, a0, a0 + (a1 - a0) * frac); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineCap = 'butt';
  // ticks
  for (let v = 0; v <= maxV; v += 100) {
    const a = a0 + (a1 - a0) * (v / maxV);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (R - 17), cy + Math.sin(a) * (R - 17));
    ctx.lineTo(cx + Math.cos(a) * (R - 23), cy + Math.sin(a) * (R - 23));
    ctx.stroke();
  }
  // needle
  const na = a0 + (a1 - a0) * frac;
  ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 3;
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(na) * 10, cy - Math.sin(na) * 10);
  ctx.lineTo(cx + Math.cos(na) * (R - 26), cy + Math.sin(na) * (R - 26));
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  // digital readout
  ctx.fillStyle = hot ? '#ff8fb3' : '#9ff3ff';
  ctx.font = '900 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(spd), cx, cy + 36);
  ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = 'bold 10px sans-serif';
  ctx.fillText('KM/H', cx, cy + 49);
  // nitro ring
  if (G.nitroT > 0) {
    ctx.strokeStyle = '#00ffc8'; ctx.lineWidth = 4;
    ctx.shadowColor = '#00ffc8'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(cx, cy, R + 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (G.nitroT / G.nitroMax));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawHUD() {
  ctx.textBaseline = 'alphabetic';
  // top glass panel fading out
  const tp = ctx.createLinearGradient(0, 0, 0, 78);
  tp.addColorStop(0, 'rgba(7,5,22,0.88)'); tp.addColorStop(1, 'rgba(7,5,22,0)');
  ctx.fillStyle = tp; ctx.fillRect(0, 0, W, 78);
  ctx.strokeStyle = 'rgba(0,229,255,0.28)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(W, 64); ctx.stroke();
  // distance
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 10;
  ctx.font = '900 30px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(Math.floor(G.dist) + ' m', 16, 40);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('BEST ' + best + ' m', 17, 58);
  // coins
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 10;
  ctx.font = '900 24px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('$ ' + G.coins, W - 16, 40);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('BANK $' + M.wallet, W - 17, 59);
  // analog speedometer
  drawSpeedo();
  // nitro bar (center, under panel)
  if (G.nitroT > 0 && state === 'playing') {
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(W / 2 - 80, 72, 160 * (G.nitroT / G.nitroMax), 7);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,229,255,0.5)';
    ctx.strokeRect(W / 2 - 80, 72, 160, 7);
    ctx.fillStyle = '#9ff3ff'; ctx.font = '900 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('NITRO', W / 2, 95);
  }
  // An explicit launch event reads as a game objective in screenshots and
  // points to the marked opening vehicle without obstructing the road view.
  if (state === 'playing' && G.time < 8) {
    const eventW = isDesktop ? 270 : 230;
    const eventX = W / 2 - eventW / 2;
    const eventY = 16;
    ctx.fillStyle = 'rgba(19,8,35,0.84)'; ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 2;
    ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 12;
    roundRect(eventX, eventY, eventW, 45, 10); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff8fb3'; ctx.font = '900 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('CLOSE CALL CHALLENGE  +' + 15, W / 2, eventY + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.68)'; ctx.font = 'bold 11px sans-serif';
    ctx.fillText('thread past the marked rival', W / 2, eventY + 35);
  }
  const marked = G.obstacles.find((o) => o.marked && !o.passed && o.y > HORIZON && o.y < PLAYER_Y);
  if (state === 'playing' && marked) {
    ctx.fillStyle = 'rgba(19,8,35,0.84)'; ctx.strokeStyle = '#ff2d78'; ctx.lineWidth = 2;
    roundRect(W / 2 - 112, 104, 224, 34, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffb4cc'; ctx.font = '900 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MARKED RIVAL: PASS CLOSE', W / 2, 126);
  }
  // A concise first-run callout makes the boost loop discoverable without
  // covering traffic.  It lives in a lower corner on landscape broadcast HUD.
  if (state === 'playing' && G.time < 8 && G.nitroT <= 0) {
    const a = Math.min(1, (8 - G.time) * 1.2);
    const x = isDesktop ? 22 : W / 2 - 100;
    const y = isDesktop ? H - 122 : H - 170;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(5,12,29,0.82)';
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
    roundRect(x, y, 200, 48, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9ff3ff'; ctx.font = '900 15px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚡ GRAB NITRO TO BOOST', x + 100, y + 30);
    ctx.globalAlpha = 1;
  }
  // near-miss chain with rising glow
  if (G.nmChain > 0 && G.nmChainT > 0 && state === 'playing') {
    const gsz = 22 + Math.min(14, G.nmChain * 2.5);
    ctx.fillStyle = '#ff2d78';
    ctx.font = '900 ' + Math.round(gsz) + 'px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 10 + G.nmChain * 4;
    ctx.fillText('CHAIN x' + G.nmChain + ' · KEEP IT ALIVE', W / 2, marked ? 168 : 130);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,45,120,0.75)';
    ctx.fillRect(W / 2 - 60, marked ? 176 : 138, 120 * (G.nmChainT / 3), 5);
  }
}

// buttons (canvas-space rects)
let buttons = [];
function drawButton(id, x, y, w, h, label, color, sub) {
  buttons.push({ id, x, y, w, h });
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 18;
  ctx.fillStyle = 'rgba(10,14,32,0.9)';
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  roundRect(x, y, w, h, 14); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 - (sub ? 10 : 0));
  if (sub) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '15px sans-serif';
    ctx.fillText(sub, x + w / 2, y + h / 2 + 18);
  }
  ctx.restore();
}
function drawSmallButton(id, x, y, w, h, label, color, fs) {
  // Compact desktop art still gets a 44px minimum mobile hit target.
  const hitH = Math.max(44, h), hitW = Math.max(44, w);
  buttons.push({ id, x: x - (hitW - w) / 2, y: y - (hitH - h) / 2, w: hitW, h: hitH });
  ctx.save();
  ctx.fillStyle = 'rgba(10,14,32,0.9)';
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold ' + (fs || 20) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWallet(x, y) {
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 8;
  ctx.fillText('$ ' + M.wallet, x, y);
  ctx.shadowBlur = 0;
}

function drawTitle(yc, compact = false) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const tg = ctx.createLinearGradient(0, yc - 36, 0, yc + 36);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.5, '#ffd1e6'); tg.addColorStop(1, '#ff2d78');
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 34;
  ctx.fillStyle = tg;
  const titleSize = compact ? 46 : 64, rushOffset = compact ? 52 : 70;
  ctx.font = '900 ' + titleSize + 'px sans-serif';
  ctx.fillText('VELOCITY', W / 2, yc);
  const tg2 = ctx.createLinearGradient(0, yc + 34, 0, yc + 106);
  tg2.addColorStop(0, '#ffffff'); tg2.addColorStop(0.5, '#c9f6ff'); tg2.addColorStop(1, '#00e5ff');
  ctx.shadowColor = '#00e5ff';
  ctx.fillStyle = tg2;
  ctx.fillText('RUSH', W / 2, yc + rushOffset);
  ctx.shadowBlur = 0;
  // scanline accent under the title
  ctx.fillStyle = 'rgba(0,229,255,0.5)';
  ctx.fillRect(W / 2 - 130, yc + rushOffset + 42, 260, 2);
}

function drawMenu() {
  const compact = isDesktop && H < 620;
  drawGame();
  ctx.fillStyle = 'rgba(4,6,16,0.55)';
  ctx.fillRect(0, 0, W, H);
  drawTitle(H * (compact ? 0.16 : 0.2), compact);
  drawWallet(W - 16, 40);
  drawSmallButton('mute', W - 68, 72, 52, 44, (mutedBySettings || userMuted) ? '🔇' : '🔊', '#fff', 18);
  if (M.streak > 1) {
    ctx.fillStyle = '#ff6d00'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('\uD83D\uDD25 ' + M.streak + ' day streak', W - 16, 66);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Neon endless racer — dodge the traffic!', W / 2, H * (compact ? 0.32 : 0.34));
  if (dailyBonus > 0) {
    ctx.fillStyle = '#76ff03'; ctx.font = 'bold 22px sans-serif';
    ctx.shadowColor = '#76ff03'; ctx.shadowBlur = 10;
    ctx.fillText('DAILY BONUS +$' + dailyBonus + '  (streak ' + M.streak + ')', W / 2, H * (compact ? 0.375 : 0.395));
    ctx.shadowBlur = 0;
  }
  const playY = H * (compact ? 0.43 : 0.44), playH = compact ? 62 : 76, garageH = compact ? 52 : 64;
  drawButton('play', W / 2 - 120, playY, 240, playH, 'PLAY', '#00ffc8');
  drawButton('garage', W / 2 - 120, playY + playH + (compact ? 12 : 20), 240, garageH, 'GARAGE', '#ffb300', CARS.filter(c => M.owned.includes(c.id)).length + '/' + CARS.length + ' cars');
  // next mission teaser
  const am = activeMissions();
  if (am.length) {
    const m = am[0];
    const prog = Math.min(1, (M.stats[m.stat] || 0) / m.goal);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MISSION: ' + m.name + '  (' + Math.floor(prog * 100) + '%)', W / 2, H * (compact ? 0.79 : 0.68));
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '17px sans-serif';
  ctx.fillText('\u2190 \u2192 / A D — change lane  ·  swipe on mobile', W / 2, H * (compact ? 0.86 : 0.73));
  ctx.fillText('Grab $ coins & NITRO, thread the gaps!', W / 2, H * (compact ? 0.91 : 0.765));
  if (best > 0) {
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText('BEST: ' + best + ' m', W / 2, H * 0.82);
  }
}

// ---------- garage ----------
function drawGarageWorkshop() {
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#11152b'); wall.addColorStop(0.58, '#1b1835'); wall.addColorStop(0.59, '#0a0d19'); wall.addColorStop(1, '#151126');
  ctx.fillStyle = wall; ctx.fillRect(0, 0, W, H);
  // Ceiling trusses and long fluorescent strips make the wide room feel built,
  // not like a portrait menu pasted over a game background.
  ctx.strokeStyle = 'rgba(145,170,230,0.28)'; ctx.lineWidth = 3;
  for (let x = -80; x < W + 120; x += 170) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 95, H * 0.56); ctx.lineTo(x + 185, 0); ctx.stroke();
  }
  for (const y of [62, 128]) {
    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(155,245,255,0.72)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(26, y); ctx.lineTo(W - 26, y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Side workbenches, tool cabinets and stacked tyres remain alive beyond the
  // central interactive panel on both desktop edges.
  for (const side of [0, 1]) {
    const x = side ? W - 165 : 24;
    ctx.fillStyle = '#1d2944'; ctx.fillRect(x, H * 0.36, 140, H * 0.24);
    ctx.fillStyle = '#303f61'; ctx.fillRect(x - 8, H * 0.36 - 10, 156, 12);
    for (let r = 0; r < 3; r++) {
      ctx.fillStyle = r % 2 ? '#263351' : '#24304b'; ctx.fillRect(x + 10, H * 0.39 + r * 42, 118, 34);
      ctx.fillStyle = '#ffb300'; ctx.fillRect(x + 61, H * 0.404 + r * 42, 16, 3);
    }
    for (let t = 0; t < 3; t++) {
      ctx.strokeStyle = '#10131f'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(x + 24 + t * 42, H * 0.73, 23, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#596582'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x + 24 + t * 42, H * 0.73, 23, 0, Math.PI * 2); ctx.stroke();
    }
  }
  const floor = ctx.createLinearGradient(0, H * 0.56, 0, H);
  floor.addColorStop(0, 'rgba(85,72,150,0.2)'); floor.addColorStop(1, 'rgba(3,5,13,0.86)');
  ctx.fillStyle = floor; ctx.fillRect(0, H * 0.56, W, H * 0.44);
  ctx.strokeStyle = 'rgba(0,229,255,0.18)'; ctx.lineWidth = 1;
  for (let y = H * 0.60; y < H; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // Workshop depth cues: lift arms, service monitors and long floor-light
  // reflections. They intentionally live behind the panels so the garage is
  // a room first and an interface second.
  for (const x of [W * 0.19, W * 0.81]) {
    ctx.strokeStyle = 'rgba(116,145,195,0.7)'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(x - 54, H * 0.78); ctx.lineTo(x - 16, H * 0.42); ctx.lineTo(x + 26, H * 0.78); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 54, H * 0.78); ctx.lineTo(x + 16, H * 0.42); ctx.lineTo(x - 26, H * 0.78); ctx.stroke();
    ctx.fillStyle = '#0b1024'; ctx.fillRect(x - 46, H * 0.27, 92, 52);
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.strokeRect(x - 46, H * 0.27, 92, 52);
    ctx.fillStyle = 'rgba(0,229,255,0.32)'; ctx.fillRect(x - 36, H * 0.283, 72, 28);
  }
  for (const x of [W * 0.25, W * 0.5, W * 0.75]) {
    const rg = ctx.createLinearGradient(x - 70, H * 0.57, x + 70, H);
    rg.addColorStop(0, 'rgba(0,229,255,0.16)'); rg.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(x - 70, H * 0.57, 140, H * 0.43);
  }
}

function drawGaragePanel(x, y, w, h, title, color) {
  const pg = ctx.createLinearGradient(x, y, x, y + h);
  pg.addColorStop(0, 'rgba(11,15,35,0.93)'); pg.addColorStop(1, 'rgba(5,8,21,0.82)');
  ctx.fillStyle = pg; ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  roundRect(x, y, w, h, 16); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = color; ctx.font = '900 20px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(title, x + 20, y + 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 18, y + 48); ctx.lineTo(x + w - 18, y + 48); ctx.stroke();
}

function drawGarageDesktop() {
  drawGarageWorkshop();
  const car = CARS[garageIdx];
  const owned = M.owned.includes(car.id);
  const selected = M.selected === car.id;
  const pad = 34;
  const panelW = Math.min(360, Math.max(280, W * 0.205));
  const panelY = 145;
  const panelH = H - panelY - 116;
  const leftX = pad, rightX = W - pad - panelW, gc = W / 2;
  const centerL = leftX + panelW + 26, centerR = rightX - 26;
  const centerW = centerR - centerL;

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffb300'; ctx.font = '900 46px sans-serif'; ctx.fillText('GARAGE', gc, 55); ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(210,239,255,0.65)'; ctx.font = 'bold 14px sans-serif';
  ctx.fillText('NIGHT SHIFT PERFORMANCE LAB', gc, 88);
  drawWallet(W - 28, 42);

  drawGaragePanel(leftX, panelY, panelW, panelH, 'PERFORMANCE', '#00e5ff');
  drawGaragePanel(rightX, panelY, panelW, panelH, 'MISSIONS', '#ffb300');

  // Central showroom, deliberately large enough to read as a vehicle bay at
  // 1080p instead of a compact menu illustration.
  const garageCarW = Math.min(210, CAR_W * 1.45);
  const garageCarH = garageCarW * 1.70;
  const carY = Math.max(290, H * 0.38);
  const platformY = carY + garageCarH * 0.62;
  const ga = G.time * 0.55;
  const spotlight = ctx.createLinearGradient(0, 110, 0, platformY + 30);
  spotlight.addColorStop(0, 'rgba(255,255,255,0.17)'); spotlight.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spotlight;
  ctx.beginPath(); ctx.moveTo(gc - 45, 112); ctx.lineTo(gc + 45, 112); ctx.lineTo(gc + 240, platformY + 20); ctx.lineTo(gc - 240, platformY + 20); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.translate(gc, platformY);
  ctx.fillStyle = 'rgba(14,18,46,0.96)'; ctx.beginPath(); ctx.ellipse(0, 0, Math.min(255, centerW * 0.40), 54, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = car.color; ctx.lineWidth = 3; ctx.shadowColor = car.color; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.ellipse(0, 0, Math.min(255, centerW * 0.40), 54, 0, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = car.color;
  for (let i = 0; i < 16; i++) { const a = ga + i * Math.PI / 8; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.arc(Math.cos(a) * Math.min(225, centerW * 0.35), Math.sin(a) * 43, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.save(); ctx.globalAlpha = 0.14; ctx.beginPath(); ctx.ellipse(gc, platformY + 38, Math.min(245, centerW * 0.38), 45, 0, 0, Math.PI * 2); ctx.clip(); ctx.translate(gc, platformY + 48); ctx.scale(1, -0.45); ctx.rotate(-ga); drawCarShape(0, 0, garageCarW, garageCarH, car.color, false, true, car.shape); ctx.restore();
  ctx.save(); ctx.translate(gc, carY); ctx.rotate(ga); drawCarShape(0, 0, garageCarW, garageCarH, car.color, true, true, car.shape); ctx.restore();
  const arrowGap = Math.min(centerW * 0.42, 300);
  drawSmallButton('prevCar', gc - arrowGap - 30, carY - 30, 60, 60, '←', '#fff', 28);
  drawSmallButton('nextCar', gc + arrowGap - 30, carY - 30, 60, 60, '→', '#fff', 28);
  ctx.fillStyle = car.color; ctx.font = '900 34px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(car.name, gc, platformY + 84);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(selected ? 'ACTIVE VEHICLE' : owned ? 'OWNED VEHICLE' : 'LOCKED VEHICLE', gc, platformY + 108);
  if (selected) { ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 19px sans-serif'; ctx.fillText('✓ SELECTED', gc, platformY + 137); }
  else if (owned) drawSmallButton('selectCar', gc - 90, platformY + 116, 180, 44, 'SELECT', '#00ffc8', 20);
  else drawSmallButton('buyCar', gc - 112, platformY + 116, 224, 44, 'BUY  $' + car.cost, M.wallet >= car.cost ? '#ffd700' : '#666', 20);

  const stats = [['HANDLING', (car.handling - 8) / 8], ['NITRO', car.nitro / 5], ['COIN BONUS', (car.coinMul - 0.75) / 1.5]];
  stats.forEach(([label, value], i) => {
    const y = panelY + 82 + i * 53;
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, leftX + 20, y);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; roundRect(leftX + 20, y + 13, panelW - 40, 12, 5); ctx.fill();
    ctx.fillStyle = car.color; roundRect(leftX + 20, y + 13, (panelW - 40) * Math.max(0.08, Math.min(1, value)), 12, 5); ctx.fill();
  });
  ctx.fillStyle = '#fff'; ctx.font = '900 17px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('UPGRADES', leftX + 20, panelY + 264);
  Object.keys(UPGRADES).forEach((k, i) => {
    const u = UPGRADES[k], lvl = M.upg[k], y = panelY + 288 + i * 94;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(u.name, leftX + 20, y);
    ctx.fillStyle = 'rgba(255,255,255,0.56)'; ctx.font = '13px sans-serif'; ctx.fillText(u.desc, leftX + 20, y + 19);
    for (let p = 0; p < u.max; p++) { ctx.fillStyle = p < lvl ? '#00e5ff' : 'rgba(255,255,255,0.16)'; ctx.fillRect(leftX + 20 + p * 18, y + 33, 13, 11); }
    if (lvl < u.max) drawSmallButton('upg_' + k, leftX + panelW - 102, y + 27, 82, 34, '$' + u.costs[lvl], M.wallet >= u.costs[lvl] ? '#ffd700' : '#666', 15);
    else { ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('MAX', leftX + panelW - 55, y + 48); }
  });

  const am = activeMissions();
  ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('COMPLETE RUNS TO UNLOCK THE FULL FLEET', rightX + 20, panelY + 77);
  if (!am.length) { ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 17px sans-serif'; ctx.fillText('All missions complete — legend!', rightX + 20, panelY + 114); }
  am.slice(0, 5).forEach((m, i) => {
    const y = panelY + 112 + i * 94, cur = Math.min(m.goal, M.stats[m.stat] || 0);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(m.name, rightX + 20, y);
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'right'; ctx.fillText('+$' + m.reward, rightX + panelW - 20, y);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; roundRect(rightX + 20, y + 16, panelW - 40, 10, 5); ctx.fill();
    ctx.fillStyle = '#00e5ff'; roundRect(rightX + 20, y + 16, (panelW - 40) * (cur / m.goal), 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(cur + ' / ' + m.goal, rightX + 20, y + 44);
  });
  drawButton('back', gc - 100, H - 82, 200, 58, 'BACK', '#00ffc8');
}

function drawGarageCompact() {
  drawGarageWorkshop();
  const car = CARS[garageIdx], gc = W / 2;
  const owned = M.owned.includes(car.id), selected = M.selected === car.id;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb300'; ctx.font = '900 30px sans-serif'; ctx.fillText('GARAGE', gc, 32);
  drawWallet(W - 18, 32);
  drawSmallButton('prevCar', gc - 148, 74, 58, 44, '←', '#fff', 24);
  drawSmallButton('nextCar', gc + 90, 74, 58, 44, '→', '#fff', 24);
  drawCarShape(gc, 128, 68, 116, car.color, true, true, car.shape);
  ctx.fillStyle = car.color; ctx.font = '900 24px sans-serif'; ctx.fillText(car.name, gc, 205);
  const stats = [['HANDLING', (car.handling - 8) / 8], ['NITRO', car.nitro / 5], ['COINS', (car.coinMul - .75) / 1.5]];
  stats.forEach(([label, value], index) => {
    const x = 24 + index * ((W - 48) / 3), w = (W - 64) / 3, y = 232;
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(label, x, y);
    ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(x, y + 12, w, 8);
    ctx.fillStyle = car.color; ctx.fillRect(x, y + 12, w * Math.max(.08, Math.min(1, value)), 8);
  });
  if (selected) { ctx.textAlign = 'center'; ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('✓ SELECTED', gc, 278); }
  else if (owned) drawSmallButton('selectCar', gc - 90, 258, 180, 44, 'SELECT', '#00ffc8', 19);
  else drawSmallButton('buyCar', gc - 110, 258, 220, 44, 'BUY  $' + car.cost, M.wallet >= car.cost ? '#ffd700' : '#666', 19);
  ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('UPGRADES', gc, 322);
  Object.keys(UPGRADES).forEach((key, index) => {
    const u = UPGRADES[key], level = M.upg[key], x = 26 + index * ((W - 52) / 3), w = (W - 66) / 3;
    const label = level >= u.max ? u.name + ' MAX' : u.name + '  $' + u.costs[level];
    drawSmallButton('upg_' + key, x, 336, w, 44, label, level < u.max && M.wallet >= u.costs[level] ? '#ffd700' : '#666', 12);
  });
  drawButton('back', gc - 100, H - 58, 200, 44, 'BACK', '#00ffc8');
}

function drawGarage() {
  if (isDesktop && H < 760) { drawGarageCompact(); return; }
  if (!isDesktop && W < 540) { drawGarageCompact(); return; }
  if (isDesktop) { drawGarageDesktop(); return; }
  drawGarageWorkshop();
  const gc = W / 2;
  const gx = gc - 270;
  ctx.fillStyle = 'rgba(4,6,16,0.38)';
  ctx.fillRect(Math.max(0, W / 2 - 292), 18, Math.min(W, 584), H - 36);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffb300';
  ctx.font = '900 42px sans-serif';
  ctx.fillText('GARAGE', gc, 52);
  ctx.shadowBlur = 0;
  drawWallet(W - 16, 40);

  // --- car carousel ---
  const car = CARS[garageIdx];
  const owned = M.owned.includes(car.id);
  const selected = M.selected === car.id;
  // Garage presentation has its own scale: gameplay traffic grows with wide
  // lanes, but a turntable car must remain framed under the workshop lights.
  const garageCarW = Math.min(72, CAR_W);
  const garageCarH = garageCarW * 1.70;
  // showroom: spotlight cone
  const ga = G.time * 0.55;
  const sp = ctx.createLinearGradient(0, 72, 0, 258);
  sp.addColorStop(0, 'rgba(255,255,255,0.16)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sp;
  ctx.beginPath();
  ctx.moveTo(gc - 26, 72); ctx.lineTo(gc + 26, 72);
  ctx.lineTo(gc + 134, 258); ctx.lineTo(gc - 134, 258);
  ctx.closePath(); ctx.fill();
  // rotating platform
  ctx.save();
  ctx.translate(gc, 238);
  ctx.fillStyle = 'rgba(20,16,48,0.92)';
  ctx.beginPath(); ctx.ellipse(0, 0, 128, 34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = car.color; ctx.globalAlpha = 0.85; ctx.lineWidth = 2.5;
  ctx.shadowColor = car.color; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.ellipse(0, 0, 128, 34, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = car.color;
  for (let i = 0; i < 12; i++) {
    const a = ga + i * Math.PI / 6;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(Math.cos(a) * 112, Math.sin(a) * 29, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // floor reflection (flipped, faded)
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.beginPath(); ctx.ellipse(gc, 258, 126, 32, 0, 0, Math.PI * 2); ctx.clip();
  ctx.translate(gc, 262); ctx.scale(1, -0.5); ctx.rotate(-ga);
  drawCarShape(0, 0, garageCarW * 1.55, garageCarH * 1.55, car.color, false, true, car.shape);
  ctx.restore();
  ctx.globalAlpha = 1;
  // the car on the turntable
  ctx.save();
  ctx.translate(gc, 186); ctx.rotate(ga);
  drawCarShape(0, 0, garageCarW * 1.55, garageCarH * 1.55, car.color, true, true, car.shape);
  ctx.restore();
  drawSmallButton('prevCar', gx + 60, 160, 60, 60, '\u2190', '#fff', 28);
  drawSmallButton('nextCar', gx + 420, 160, 60, 60, '\u2192', '#fff', 28);
  ctx.fillStyle = car.color; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(car.name, gc, 292);
  // stats bars
  const statRows = [
    ['HANDLING', (car.handling - 8) / 8],
    ['NITRO', car.nitro / 5],
    ['COIN x' + car.coinMul.toFixed(2), (car.coinMul - 0.75) / 1.5],
  ];
  statRows.forEach(([label, v], i) => {
    const y = 320 + i * 26;
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(label, gx + 110, y + 7);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(gx + 250, y, 180, 12);
    ctx.fillStyle = car.color;
    ctx.fillRect(gx + 250, y, 180 * Math.max(0.08, Math.min(1, v)), 12);
  });
  if (selected) {
    ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('\u2713 SELECTED', gc, 428);
  } else if (owned) {
    drawSmallButton('selectCar', gc - 90, 405, 180, 46, 'SELECT', '#00ffc8', 22);
  } else {
    const afford = M.wallet >= car.cost;
    drawSmallButton('buyCar', gc - 110, 405, 220, 46, 'BUY  $' + car.cost, afford ? '#ffd700' : '#666', 22);
  }

  // --- upgrades ---
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('UPGRADES', gx + 40, 490);
  const keys = Object.keys(UPGRADES);
  keys.forEach((k, i) => {
    const u = UPGRADES[k];
    const lvl = M.upg[k];
    const y = 510 + i * 58;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(u.name, gx + 40, y + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '14px sans-serif';
    ctx.fillText(u.desc, gx + 40, y + 40);
    // level pips
    for (let p = 0; p < u.max; p++) {
      ctx.fillStyle = p < lvl ? '#00e5ff' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(gx + 250 + p * 22, y + 10, 16, 16);
    }
    if (lvl < u.max) {
      const cost = u.costs[lvl];
      drawSmallButton('upg_' + k, gx + 390, y + 2, 118, 40, '$' + cost, M.wallet >= cost ? '#ffd700' : '#666', 18);
    } else {
      ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('MAX', gx + 410, y + 26);
    }
  });

  // --- missions ---
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MISSIONS', gx + 40, 712);
  const am = activeMissions();
  if (!am.length) {
    ctx.fillStyle = '#00ffc8'; ctx.font = '17px sans-serif';
    ctx.fillText('All missions complete — legend!', gx + 40, 742);
  }
  am.forEach((m, i) => {
    const y = 726 + i * 44;
    const cur = Math.min(m.goal, M.stats[m.stat] || 0);
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(m.name, gx + 40, y + 14);
    ctx.fillStyle = '#ffd700'; ctx.textAlign = 'right'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('+$' + m.reward, gx + 500, y + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(gx + 40, y + 22, 460, 8);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(gx + 40, y + 22, 460 * (cur / m.goal), 8);
  });

  drawButton('back', gc - 100, H - 90, 200, 62, 'BACK', '#00ffc8');
}

function drawGameOver() {
  drawGame();
  ctx.fillStyle = 'rgba(4,6,16,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 24;
  ctx.fillStyle = '#ff5d8f';
  ctx.font = '900 58px sans-serif';
  ctx.fillText('CRASHED!', W / 2, H * 0.17);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(Math.floor(G.dist) + ' m', W / 2, H * 0.26);
  if (runResult) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 24px sans-serif';
    const earnedTxt = '+$' + runResult.earned + (runResult.doubled ? ' x2!' : '') + '  \u2192  bank $' + M.wallet;
    ctx.fillText(earnedTxt, W / 2, H * 0.32);
    // completed missions
    runResult.missions.slice(0, 2).forEach((m, i) => {
      ctx.fillStyle = '#76ff03'; ctx.font = 'bold 18px sans-serif';
      ctx.fillText('\u2713 ' + m.name + '  +$' + m.reward, W / 2, H * 0.365 + i * 26);
    });
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '20px sans-serif';
  ctx.fillText('BEST: ' + best + ' m', W / 2, H * 0.435);
  let by = H * 0.48;
  if (!G.usedContinue) {
    drawButton('continue', W / 2 - 150, by, 300, 78, 'CONTINUE', '#ffd700', 'watch ad · keep your run');
    by += 96;
  }
  if (runResult && !runResult.doubled && runResult.earned > 0) {
    drawButton('double', W / 2 - 150, by, 300, 70, 'DOUBLE $' + runResult.earned, '#ffb300', 'watch ad · x2 coins');
    by += 88;
  }
  drawButton('again', W / 2 - 150, by, 300, 72, 'PLAY AGAIN', '#00ffc8');
  by += 88;
  drawButton('garage', W / 2 - 100, by, 200, 56, 'GARAGE', '#ffb300');
}

// ---------- lifecycle + fixed-step main loop ----------
const pauseReasons = new Set();
let suspended = false;
function setPaused(reason, shouldPause) {
  if (shouldPause) pauseReasons.add(reason); else pauseReasons.delete(reason);
  const next = pauseReasons.size > 0;
  if (next === suspended) return;
  suspended = next;
  if (suspended) {
    audio.pauseAudio();
    if (state === 'playing') gameplayStop();
  } else {
    audio.resumeAudio();
    if (state === 'playing') gameplayStart();
  }
}
document.addEventListener('visibilitychange', () => setPaused('hidden', document.hidden));
window.addEventListener('blur', () => setPaused('blur', true));
window.addEventListener('focus', () => setPaused('blur', false));

let last = performance.now(), accumulator = 0;
function frame(now) {
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  buttons = [];
  if (!suspended) {
    const consumed = consumeFixedSteps(accumulator, dt, FIXED_STEP, update);
    accumulator = consumed.accumulator;
  }
  if (state === 'menu') drawMenu();
  else if (state === 'garage') drawGarage();
  else if (state === 'playing') { drawGame(); drawHUD(); }
  else if (state === 'gameover') { drawGameOver(); drawHUD(); }
  requestAnimationFrame(frame);
}

// ---------- input ----------
function moveLane(dir) {
  if (state !== 'playing' || G.crashing) return;
  const nl = Math.max(0, Math.min(LANES - 1, G.lane + dir));
  if (nl !== G.lane) { G.lane = nl; audio.skidSound(); }
}

function garageAction(id) {
  const car = CARS[garageIdx];
  if (id === 'prevCar') { garageIdx = (garageIdx + CARS.length - 1) % CARS.length; audio.skidSound(); }
  else if (id === 'nextCar') { garageIdx = (garageIdx + 1) % CARS.length; audio.skidSound(); }
  else if (id === 'buyCar') { if (buyCar(car.id)) { audio.coinSound(6); happytime(); } }
  else if (id === 'selectCar') { if (selectCar(car.id)) audio.coinSound(2); }
  else if (id.startsWith('upg_')) { if (buyUpgrade(id.slice(4))) { audio.coinSound(6); happytime(); } }
  else if (id === 'back') { state = 'menu'; }
}

function garagePrimaryAction() {
  const car = CARS[garageIdx];
  if (M.owned.includes(car.id)) {
    if (M.selected !== car.id && selectCar(car.id)) audio.coinSound(2);
  } else if (buyCar(car.id)) {
    audio.coinSound(6);
    happytime();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (state === 'garage') {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') garageAction('prevCar');
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') garageAction('nextCar');
    else if (e.key === ' ' || e.key === 'Enter') garagePrimaryAction();
    else if (e.key === 'Escape') state = 'menu';
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveLane(-1);
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveLane(1);
  else if ((e.key === ' ' || e.key === 'Enter') && state === 'menu') startGame();
  else if ((e.key === ' ' || e.key === 'Enter') && state === 'gameover') playAgain();
});

function canvasPos(ev) {
  const b = canvas.getBoundingClientRect();
  const cx = (ev.clientX - b.left) * (W / b.width);
  const cy = (ev.clientY - b.top) * (H / b.height);
  return { x: cx, y: cy };
}

let touchStart = null;
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch') ev.preventDefault();
  canvas.setPointerCapture?.(ev.pointerId);
  audio.unlockAudio();
  const p = canvasPos(ev);
  touchStart = { x: p.x, y: p.y, t: performance.now(), moved: false };
  // buttons
  for (const b of buttons) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      if (b.id === 'play') startGame();
      else if (b.id === 'again') playAgain();
      else if (b.id === 'continue') continueRun();
      else if (b.id === 'double') doubleCoins();
      else if (b.id === 'garage') { garageIdx = CARS.findIndex(c => c.id === M.selected); if (garageIdx < 0) garageIdx = 0; state = 'garage'; }
      else if (b.id === 'mute') { userMuted = !userMuted; applyMute(); }
      else garageAction(b.id);
      touchStart = null;
      return;
    }
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (!touchStart || state !== 'playing') return;
  const p = canvasPos(ev);
  const dx = p.x - touchStart.x;
  if (Math.abs(dx) > 40 && !touchStart.moved) {
    touchStart.moved = true;
    moveLane(dx > 0 ? 1 : -1);
  }
});
canvas.addEventListener('pointerup', (ev) => {
  if (!touchStart) return;
  const p = canvasPos(ev);
  const dx = p.x - touchStart.x;
  if (state === 'playing' && !touchStart.moved && Math.abs(dx) < 20) {
    // tap: left/right half
    moveLane(p.x < W / 2 ? -1 : 1);
  }
  touchStart = null;
});
canvas.addEventListener('pointercancel', () => { touchStart = null; });

// ---------- boot ----------
async function boot() {
  await initSDK();
  loadingStart();   // MUST come after initSDK (sdk is null before)
  best = loadBest();
  loadMeta();
  firstRun = M.stats.runs === 0;
  dailyBonus = claimDaily();
  mutedBySettings = getMuteSetting();
  applyMute();
  onSettingsChange((s) => {
    if (s && typeof s.muteAudio === 'boolean') {
      mutedBySettings = s.muteAudio;
      applyMute();
    }
  });
  resetRun();
  state = 'menu';
  loadingStop();
  requestAnimationFrame(frame);
}

if (debug) {
  window.__astro = {
    forceGameOver: () => { if (state === 'playing') doCrash(); },
    nitro: () => { if (state === 'playing') { G.nitroMax = nitroDuration(); G.nitroT = G.nitroMax; } },
    move: (dir) => moveLane(dir),
    restart: () => startGame(),
    advance: (seconds) => {
      const steps = Math.min(30000, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps && state === 'playing'; i++) update(FIXED_STEP);
    },
    addScore: (n) => { G.dist += n; },
    grantCoins: (n) => { addWallet(n); },
    setStat: (k, v) => { M.stats[k] = v; },
    getState: () => ({
      state,
      score: Math.floor(G.dist),
      width: W,
      height: H,
      desktop: isDesktop,
      lane: G.lane,
      speed: speedKmh(),
      coins: G.coins,
      playerY: PLAYER_Y,
      wallet: M.wallet,
      owned: M.owned.slice(),
      selected: M.selected,
      upgrades: Object.assign({}, M.upg),
      missionsDone: M.missionsDone,
      stats: Object.assign({}, M.stats),
      streak: M.streak,
      nmChain: G.nmChain,
      nitroT: G.nitroT,
      shieldReady: G.shieldReady,
      runResult: runResult ? { earned: runResult.earned, doubled: runResult.doubled, missions: runResult.missions.map(m => m.id) } : null,
      garageCar: CARS[garageIdx].id,
      trafficVisible: G.obstacles.filter(o => o.y + o.h > HORIZON && o.y < H).length,
      obstacles: G.obstacles.map(o => ({ lane: o.lane, lanePos: o.lanePos, y: o.y, h: o.h, marked: !!o.marked, signal: !!o.signal })),
      pickups: G.pickups.map(p => ({ lane: p.lane, y: p.y, kind: p.kind })),
      debugCounts: { traffic: G.obstacles.length, pickups: G.pickups.length, particles: G.particles.length, trail: G.nitroTrail.length, floaters: G.floaters.length, listeners: 7 },
      buttons: buttons.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
    }),
  };
}

boot();
