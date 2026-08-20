// Velocity Rush — neon endless lane racer for CrazyGames
import { initSDK, gameplayStart, gameplayStop, loadingStart, loadingStop, happytime, requestAd, getMuteSetting, onSettingsChange, loadBest, saveBest } from './sdk.js';
import * as audio from './audio.js';
import { CARS, UPGRADES, M, loadMeta, saveMeta, getCar, nitroDuration, magnetRadius, hasShield, buyCar, selectCar, buyUpgrade, activeMissions, commitRun, addWallet, claimDaily } from './meta.js';

const W = 540, H = 960;
const LANES = 4;
const ROAD_X = 90, ROAD_W = 360;
const LANE_W = ROAD_W / LANES;
const laneX = (i) => ROAD_X + LANE_W * (i + 0.5);
const PLAYER_Y = H * 0.76;
const CAR_W = 54, CAR_H = 92;
const TRUCK_H = 184;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = W; canvas.height = H;

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const s = Math.min(vw / W, vh / H);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
window.addEventListener('resize', resize); resize();

// ---------- state ----------
let state = 'boot'; // boot -> menu -> playing -> gameover | garage
let best = 0;
let debug = new URLSearchParams(location.search).has('debug');
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
  nextHappy: 1000,
  roadScroll: 0,
  crashDone: false,
};

let stars = [];
for (let i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, s: Math.random() * 0.5 + 0.2 });

// side props (trees / lampposts), recycled
let props = [];
for (let i = 0; i < 12; i++) props.push({ y: (i / 12) * H, left: i % 2 === 0, lamp: i % 3 === 0 });

const PALETTE = ['#ff2d78', '#ffb300', '#7c4dff', '#00e5ff', '#76ff03', '#ff6d00'];

// ---------- helpers ----------
function rnd(a, b) { return a + Math.random() * (b - a); }
function speedKmh() { return Math.round(G.speed * 0.45); }

function addFloater(x, y, text, color) {
  G.floaters.push({ x, y, text, t: 1, color: color || '#fff' });
}

function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = rnd(0.3, 1) * (spd || 260);
    G.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 1, color, r: rnd(2, 5) });
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
  G.time = 0; G.spawnT = 0.8; G.pickupT = 2.2; G.nextHappy = 1000;
  G.crashDone = false;
  runResult = null;
}

function startGame() {
  resetRun();
  state = 'playing';
  audio.unlockAudio();
  audio.startEngine();
  gameplayStart();
}

function doCrash() {
  if (G.crashDone) return;
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
  G.crashDone = true;
  audio.stopEngine();
  audio.crashSound();
  burst(G.playerX, PLAYER_Y, '#ff9040', 60, 420);
  burst(G.playerX, PLAYER_Y, '#00e5ff', 30, 320);
  G.shake = 22;
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
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(prevMute); },
  });
  if (ok) {
    G.usedContinue = true;
    G.crashDone = false;
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
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(prevMute); },
  });
  if (ok) {
    addWallet(runResult.earned);
    runResult.doubled = true;
    audio.coinSound(8);
    happytime();
  }
}

async function playAgain() {
  const prevMute = mutedBySettings;
  await requestAd('midgame', {
    onStart: () => { audio.setMuted(true); },
    onFinish: () => { audio.setMuted(prevMute); },
  });
  startGame();
}

// ---------- spawning ----------
function spawnObstacle() {
  // pick lanes that keep at least one lane passable in this "row"
  const truck = Math.random() < 0.22;
  const h = truck ? TRUCK_H : CAR_H;
  const y = -h - 20;
  // lanes blocked near spawn zone
  const blocked = new Set();
  for (const o of G.obstacles) if (o.y < 320) blocked.add(o.lane);
  const free = [];
  for (let i = 0; i < LANES; i++) if (!blocked.has(i)) free.push(i);
  if (free.length <= 1) return; // always leave an escape lane
  const lane = free[Math.floor(Math.random() * free.length)];
  const rel = rnd(0.32, 0.5); // obstacle moves at rel * player speed (slower traffic)
  G.obstacles.push({ lane, y, h, rel, truck, color: PALETTE[Math.floor(Math.random() * PALETTE.length)], passed: false });
}

function spawnPickup() {
  const blocked = new Set();
  for (const o of G.obstacles) if (o.y < 300) blocked.add(o.lane);
  const free = [];
  for (let i = 0; i < LANES; i++) if (!blocked.has(i)) free.push(i);
  if (!free.length) return;
  const lane = free[Math.floor(Math.random() * free.length)];
  if (Math.random() < 0.18) {
    G.pickups.push({ lane, y: -40, kind: 'nitro' });
  } else {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) G.pickups.push({ lane, y: -40 - i * 54, kind: 'coin' });
  }
}

// ---------- update ----------
let mutedBySettings = false;

function update(dt) {
  G.time += dt;
  // stars parallax always
  for (const s of stars) { s.y += s.s * 40 * dt; if (s.y > H) { s.y = -2; s.x = Math.random() * W; } }
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 40);
  // particles & floaters always update
  for (const p of G.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.t -= dt * 1.4; }
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
    G.nitroTrail.push({ x: G.playerX + rnd(-14, 14), y: PLAYER_Y + CAR_H / 2, t: 1 });
  }
  for (const f of G.nitroTrail) f.t -= dt * 2.2;
  G.nitroTrail = G.nitroTrail.filter(f => f.t > 0);

  if (G.invulnT > 0) G.invulnT -= dt;

  audio.setEngineSpeed(Math.min(1.4, (G.speed - 300) / 500));

  // distance: px to meters
  G.dist += G.speed * dt * 0.05;
  if (G.dist >= G.nextHappy) { happytime(); G.nextHappy += 1000; addFloater(W / 2, H * 0.3, Math.floor(G.dist / 1000) + ' KM!', '#00e5ff'); }

  // player lerp to lane (handling stat: higher = snappier)
  const tx = laneX(G.lane);
  G.playerX += (tx - G.playerX) * Math.min(1, dt * getCar().handling);

  // road scroll
  G.roadScroll = (G.roadScroll + G.speed * dt) % 80;

  // props
  for (const p of props) { p.y += G.speed * dt * 0.9; if (p.y > H + 60) { p.y = -60; p.lamp = Math.random() < 0.35; } }

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
    const ox = laneX(o.lane);
    // near-miss: obstacle just passed the player vertically, adjacent lane, close horizontally
    if (!o.passed && o.y > PLAYER_Y + CAR_H / 2) {
      o.passed = true;
      const gap = Math.abs(ox - G.playerX) - (CAR_W); // gap between car edges
      if (gap < 15 && gap > -CAR_W * 0.5) {
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
    if (G.invulnT <= 0 &&
        Math.abs(ox - G.playerX) < CAR_W * 0.88 &&
        PLAYER_Y - CAR_H / 2 < o.y + o.h && PLAYER_Y + CAR_H / 2 > o.y) {
      doCrash();
      if (state !== 'playing') return;
    }
  }
  G.obstacles = G.obstacles.filter(o => o.y < H + 250);

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
  G.pickups = G.pickups.filter(p => !p.taken && p.y < H + 60);
}

// ---------- drawing ----------
function drawCarShape(x, y, w, h, color, glow, headlights, shape = -1) {
  ctx.save();
  ctx.translate(x, y);
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 22; }
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  const r = w * 0.28;
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // cockpit
  ctx.fillStyle = 'rgba(10,14,30,0.85)';
  ctx.fillRect(-w * 0.3, -h * 0.22, w * 0.6, h * 0.34);
  // procedural shape variants (garage cars)
  if (shape >= 0) {
    if (shape % 2 === 1) { // rear spoiler
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-w * 0.46, h / 2 - 16, w * 0.92, 5);
    }
    if (shape >= 4) { // front fins
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h * 0.2); ctx.lineTo(-w / 2 - 7, -h * 0.05); ctx.lineTo(-w / 2, h * 0.1); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w / 2, -h * 0.2); ctx.lineTo(w / 2 + 7, -h * 0.05); ctx.lineTo(w / 2, h * 0.1); ctx.closePath(); ctx.fill();
    }
    if (shape % 3 === 2) { // double stripe
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-w * 0.18, -h / 2 + 4, w * 0.09, h - 8);
      ctx.fillRect(w * 0.09, -h / 2 + 4, w * 0.09, h - 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(-w * 0.06, -h / 2 + 4, w * 0.12, h - 8);
    }
  } else {
    // stripe
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-w * 0.06, -h / 2 + 4, w * 0.12, h - 8);
  }
  if (headlights) {
    ctx.fillStyle = '#fffbe0';
    ctx.fillRect(-w * 0.36, -h / 2 + 2, w * 0.16, 6);
    ctx.fillRect(w * 0.2, -h / 2 + 2, w * 0.16, 6);
  } else {
    // tail lights (we see traffic from behind)
    ctx.fillStyle = '#ff3040';
    ctx.fillRect(-w * 0.36, h / 2 - 8, w * 0.16, 6);
    ctx.fillRect(w * 0.2, h / 2 - 8, w * 0.16, 6);
  }
  ctx.restore();
}

function drawRoad() {
  // shoulders
  ctx.fillStyle = '#0a0d1e';
  ctx.fillRect(0, 0, ROAD_X, H);
  ctx.fillRect(ROAD_X + ROAD_W, 0, W - ROAD_X - ROAD_W, H);
  // road surface
  const rg = ctx.createLinearGradient(ROAD_X, 0, ROAD_X + ROAD_W, 0);
  rg.addColorStop(0, '#131629'); rg.addColorStop(0.5, '#1a1e38'); rg.addColorStop(1, '#131629');
  ctx.fillStyle = rg;
  ctx.fillRect(ROAD_X, 0, ROAD_W, H);
  // edges neon
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 12;
  ctx.fillStyle = '#ff2d78';
  ctx.fillRect(ROAD_X - 4, 0, 4, H);
  ctx.fillRect(ROAD_X + ROAD_W, 0, 4, H);
  ctx.shadowBlur = 0;
  // lane dashes
  ctx.fillStyle = 'rgba(120,200,255,0.55)';
  for (let l = 1; l < LANES; l++) {
    const x = ROAD_X + LANE_W * l;
    for (let y = -80 + G.roadScroll; y < H; y += 80) {
      ctx.fillRect(x - 3, y, 6, 42);
    }
  }
  // props on shoulders
  for (const p of props) {
    const px = p.left ? ROAD_X - 48 : ROAD_X + ROAD_W + 48;
    if (p.lamp) {
      ctx.fillStyle = '#39406b';
      ctx.fillRect(px - 3, p.y - 46, 6, 46);
      ctx.shadowColor = '#ffe27a'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffe27a';
      ctx.beginPath(); ctx.arc(px, p.y - 50, 7, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#3a2b45';
      ctx.fillRect(px - 4, p.y - 14, 8, 22);
      ctx.shadowColor = '#7c4dff'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#5e35b1';
      ctx.beginPath();
      ctx.moveTo(px, p.y - 60); ctx.lineTo(px + 22, p.y - 8); ctx.lineTo(px - 22, p.y - 8);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}

function drawGame() {
  ctx.save();
  if (G.shake > 0) ctx.translate(rnd(-G.shake, G.shake) * 0.5, rnd(-G.shake, G.shake) * 0.5);

  // sky/background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#05060f'); bg.addColorStop(1, '#0c0f22');
  ctx.fillStyle = bg; ctx.fillRect(-30, -30, W + 60, H + 60);
  ctx.fillStyle = '#fff';
  for (const s of stars) { ctx.globalAlpha = 0.5 + s.s; ctx.fillRect(s.x, s.y, s.r, s.r); }
  ctx.globalAlpha = 1;

  drawRoad();

  // speed light streaks at high speed
  const streakA = Math.min(0.5, (G.speed - 500) / 900);
  if (streakA > 0) {
    ctx.strokeStyle = 'rgba(160,220,255,' + streakA + ')';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const x = ROAD_X + ((i * 97 + G.time * 700) % ROAD_W);
      const y = ((i * 233 + G.time * G.speed * 1.4) % (H + 200)) - 100;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 60 + streakA * 90); ctx.stroke();
    }
  }

  // pickups
  for (const p of G.pickups) {
    const x = p.mx != null ? p.mx : laneX(p.lane);
    if (p.kind === 'coin') {
      ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(x, p.y, 13, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#a67c00';
      ctx.font = 'bold 15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('$', x, p.y + 1);
    } else {
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.moveTo(x, p.y - 18); ctx.lineTo(x + 12, p.y); ctx.lineTo(x + 4, p.y); ctx.lineTo(x + 10, p.y + 18);
      ctx.lineTo(x - 12, p.y - 2); ctx.lineTo(x - 4, p.y - 2);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // obstacles
  for (const o of G.obstacles) {
    drawCarShape(laneX(o.lane), o.y + o.h / 2, CAR_W, o.h, o.color, true, false);
  }

  // nitro trail
  for (const f of G.nitroTrail) {
    ctx.globalAlpha = f.t;
    ctx.fillStyle = f.t > 0.5 ? '#00e5ff' : '#ff9040';
    ctx.beginPath(); ctx.arc(f.x, f.y + (1 - f.t) * 60, 8 * f.t + 2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // player (blink while invulnerable)
  if (state === 'playing' || state === 'menu') {
    const car = getCar();
    if (!(G.invulnT > 0 && Math.floor(G.time * 10) % 2 === 0)) {
      drawCarShape(G.playerX, PLAYER_Y, CAR_W, CAR_H, car.color, true, true, car.shape);
      // shield aura
      if (G.shieldReady && state === 'playing') {
        ctx.strokeStyle = 'rgba(118,255,3,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(G.playerX, PLAYER_Y, CAR_H * 0.72, 0, Math.PI * 2); ctx.stroke();
      }
      // headlight beams
      const hb = ctx.createLinearGradient(0, PLAYER_Y - CAR_H / 2, 0, PLAYER_Y - CAR_H / 2 - 180);
      hb.addColorStop(0, 'rgba(255,250,200,0.22)'); hb.addColorStop(1, 'rgba(255,250,200,0)');
      ctx.fillStyle = hb;
      ctx.beginPath();
      ctx.moveTo(G.playerX - CAR_W * 0.32, PLAYER_Y - CAR_H / 2);
      ctx.lineTo(G.playerX - CAR_W * 0.9, PLAYER_Y - CAR_H / 2 - 180);
      ctx.lineTo(G.playerX + CAR_W * 0.9, PLAYER_Y - CAR_H / 2 - 180);
      ctx.lineTo(G.playerX + CAR_W * 0.32, PLAYER_Y - CAR_H / 2);
      ctx.closePath(); ctx.fill();
    }
  }

  // particles
  for (const p of G.particles) {
    ctx.globalAlpha = Math.max(0, p.t);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // floaters
  for (const f of G.floaters) {
    ctx.globalAlpha = Math.max(0, Math.min(1, f.t));
    ctx.fillStyle = f.color;
    ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = f.color; ctx.shadowBlur = 12;
    ctx.fillText(f.text, f.x, f.y);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // contextual first-run hint (teach by playing, no tutorial screen)
  if (state === 'playing' && firstRun && G.time < 6) {
    const a = G.time < 5 ? 1 : 6 - G.time;
    ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(G.time * 6));
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('\u2190  TAP / SWIPE / ARROWS  \u2192', W / 2, H * 0.58);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawHUD() {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(5,8,20,0.55)';
  ctx.fillRect(0, 0, W, 62);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(Math.floor(G.dist) + ' m', 16, 40);
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('$ ' + G.coins, 190, 39);
  ctx.fillStyle = '#00e5ff';
  ctx.textAlign = 'right';
  ctx.fillText(speedKmh() + ' km/h', W - 16, 39);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '15px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('BEST ' + best + ' m', W / 2 + 40, 56);
  if (G.nitroT > 0) {
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(W / 2 - 80, 70, 160 * (G.nitroT / G.nitroMax), 8);
    ctx.strokeStyle = 'rgba(0,229,255,0.5)';
    ctx.strokeRect(W / 2 - 80, 70, 160, 8);
  }
  // near-miss chain indicator
  if (G.nmChain > 1 && G.nmChainT > 0 && state === 'playing') {
    ctx.fillStyle = '#ff2d78';
    ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 10;
    ctx.fillText('CHAIN x' + G.nmChain, W / 2, 105);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,45,120,0.7)';
    ctx.fillRect(W / 2 - 60, 112, 120 * (G.nmChainT / 3), 5);
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
  buttons.push({ id, x, y, w, h });
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

function drawTitle(yc) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff2d78'; ctx.shadowBlur = 30;
  ctx.fillStyle = '#fff';
  ctx.font = '900 64px sans-serif';
  ctx.fillText('VELOCITY', W / 2, yc);
  ctx.shadowColor = '#00e5ff';
  ctx.fillText('RUSH', W / 2, yc + 70);
  ctx.shadowBlur = 0;
}

function drawMenu() {
  drawGame();
  ctx.fillStyle = 'rgba(4,6,16,0.55)';
  ctx.fillRect(0, 0, W, H);
  drawTitle(H * 0.2);
  drawWallet(W - 16, 40);
  if (M.streak > 1) {
    ctx.fillStyle = '#ff6d00'; ctx.font = 'bold 17px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('\uD83D\uDD25 ' + M.streak + ' day streak', W - 16, 66);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('Neon endless racer — dodge the traffic!', W / 2, H * 0.34);
  if (dailyBonus > 0) {
    ctx.fillStyle = '#76ff03'; ctx.font = 'bold 22px sans-serif';
    ctx.shadowColor = '#76ff03'; ctx.shadowBlur = 10;
    ctx.fillText('DAILY BONUS +$' + dailyBonus + '  (streak ' + M.streak + ')', W / 2, H * 0.395);
    ctx.shadowBlur = 0;
  }
  drawButton('play', W / 2 - 120, H * 0.44, 240, 76, 'PLAY', '#00ffc8');
  drawButton('garage', W / 2 - 120, H * 0.44 + 96, 240, 64, 'GARAGE', '#ffb300', CARS.filter(c => M.owned.includes(c.id)).length + '/' + CARS.length + ' cars');
  // next mission teaser
  const am = activeMissions();
  if (am.length) {
    const m = am[0];
    const prog = Math.min(1, (M.stats[m.stat] || 0) / m.goal);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MISSION: ' + m.name + '  (' + Math.floor(prog * 100) + '%)', W / 2, H * 0.68);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '17px sans-serif';
  ctx.fillText('\u2190 \u2192 / A D — change lane  ·  swipe on mobile', W / 2, H * 0.73);
  ctx.fillText('Grab $ coins & NITRO, thread the gaps!', W / 2, H * 0.765);
  if (best > 0) {
    ctx.fillStyle = '#ffd700'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText('BEST: ' + best + ' m', W / 2, H * 0.82);
  }
}

// ---------- garage ----------
function drawGarage() {
  drawGame();
  ctx.fillStyle = 'rgba(4,6,16,0.82)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#ffb300';
  ctx.font = '900 42px sans-serif';
  ctx.fillText('GARAGE', W / 2, 52);
  ctx.shadowBlur = 0;
  drawWallet(W - 16, 40);

  // --- car carousel ---
  const car = CARS[garageIdx];
  const owned = M.owned.includes(car.id);
  const selected = M.selected === car.id;
  drawCarShape(W / 2, 190, CAR_W * 1.5, CAR_H * 1.5, car.color, true, true, car.shape);
  drawSmallButton('prevCar', 60, 160, 60, 60, '\u2190', '#fff', 28);
  drawSmallButton('nextCar', W - 120, 160, 60, 60, '\u2192', '#fff', 28);
  ctx.fillStyle = car.color; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(car.name, W / 2, 292);
  // stats bars
  const statRows = [
    ['HANDLING', (car.handling - 8) / 8],
    ['NITRO', car.nitro / 5],
    ['COIN x' + car.coinMul.toFixed(2), (car.coinMul - 0.75) / 1.5],
  ];
  statRows.forEach(([label, v], i) => {
    const y = 320 + i * 26;
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(label, 110, y + 7);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(250, y, 180, 12);
    ctx.fillStyle = car.color;
    ctx.fillRect(250, y, 180 * Math.max(0.08, Math.min(1, v)), 12);
  });
  if (selected) {
    ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('\u2713 SELECTED', W / 2, 428);
  } else if (owned) {
    drawSmallButton('selectCar', W / 2 - 90, 405, 180, 46, 'SELECT', '#00ffc8', 22);
  } else {
    const afford = M.wallet >= car.cost;
    drawSmallButton('buyCar', W / 2 - 110, 405, 220, 46, 'BUY  $' + car.cost, afford ? '#ffd700' : '#666', 22);
  }

  // --- upgrades ---
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('UPGRADES', 40, 490);
  const keys = Object.keys(UPGRADES);
  keys.forEach((k, i) => {
    const u = UPGRADES[k];
    const lvl = M.upg[k];
    const y = 510 + i * 58;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(u.name, 40, y + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '14px sans-serif';
    ctx.fillText(u.desc, 40, y + 40);
    // level pips
    for (let p = 0; p < u.max; p++) {
      ctx.fillStyle = p < lvl ? '#00e5ff' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(250 + p * 22, y + 10, 16, 16);
    }
    if (lvl < u.max) {
      const cost = u.costs[lvl];
      drawSmallButton('upg_' + k, 390, y + 2, 118, 40, '$' + cost, M.wallet >= cost ? '#ffd700' : '#666', 18);
    } else {
      ctx.fillStyle = '#00ffc8'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('MAX', 410, y + 26);
    }
  });

  // --- missions ---
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MISSIONS', 40, 712);
  const am = activeMissions();
  if (!am.length) {
    ctx.fillStyle = '#00ffc8'; ctx.font = '17px sans-serif';
    ctx.fillText('All missions complete — legend!', 40, 742);
  }
  am.forEach((m, i) => {
    const y = 726 + i * 44;
    const cur = Math.min(m.goal, M.stats[m.stat] || 0);
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(m.name, 40, y + 14);
    ctx.fillStyle = '#ffd700'; ctx.textAlign = 'right'; ctx.font = 'bold 15px sans-serif';
    ctx.fillText('+$' + m.reward, W - 40, y + 14);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(40, y + 22, W - 80, 8);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(40, y + 22, (W - 80) * (cur / m.goal), 8);
  });

  drawButton('back', W / 2 - 100, H - 90, 200, 62, 'BACK', '#00ffc8');
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

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  buttons = [];
  update(dt);
  if (state === 'menu') drawMenu();
  else if (state === 'garage') drawGarage();
  else if (state === 'playing') { drawGame(); drawHUD(); }
  else if (state === 'gameover') { drawGameOver(); drawHUD(); }
  requestAnimationFrame(frame);
}

// ---------- input ----------
function moveLane(dir) {
  if (state !== 'playing') return;
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

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') moveLane(-1);
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') moveLane(1);
  else if ((e.key === ' ' || e.key === 'Enter') && state === 'menu') startGame();
  else if ((e.key === ' ' || e.key === 'Enter') && state === 'gameover') playAgain();
  else if (e.key === 'Escape' && state === 'garage') state = 'menu';
});

function canvasPos(ev) {
  const b = canvas.getBoundingClientRect();
  const cx = (ev.clientX - b.left) * (W / b.width);
  const cy = (ev.clientY - b.top) * (H / b.height);
  return { x: cx, y: cy };
}

let touchStart = null;
canvas.addEventListener('pointerdown', (ev) => {
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

// ---------- boot ----------
async function boot() {
  await initSDK();
  loadingStart();   // MUST come after initSDK (sdk is null before)
  best = loadBest();
  loadMeta();
  firstRun = M.stats.runs === 0;
  dailyBonus = claimDaily();
  mutedBySettings = getMuteSetting();
  audio.setMuted(mutedBySettings);
  onSettingsChange((s) => {
    if (s && typeof s.muteAudio === 'boolean') {
      mutedBySettings = s.muteAudio;
      audio.setMuted(mutedBySettings);
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
    addScore: (n) => { G.dist += n; },
    grantCoins: (n) => { addWallet(n); },
    setStat: (k, v) => { M.stats[k] = v; },
    getState: () => ({
      state,
      score: Math.floor(G.dist),
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
      shieldReady: G.shieldReady,
      runResult: runResult ? { earned: runResult.earned, doubled: runResult.doubled, missions: runResult.missions.map(m => m.id) } : null,
      obstacles: G.obstacles.map(o => ({ lane: o.lane, y: o.y, h: o.h })),
      pickups: G.pickups.map(p => ({ lane: p.lane, y: p.y, kind: p.kind })),
      buttons: buttons.map(b => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
    }),
  };
}

boot();
