// Velocity Rush — meta-progression: persistent wallet, garage cars, upgrades,
// missions, daily streak. Saved via CrazyGames data module + localStorage fallback.
import { dataGet, dataSet } from './sdk.js';

const KEY = 'velocityrush.meta';

// ---------- car catalog (procedural: shape/color/stats) ----------
export const CARS = [
  { id: 'viper',   name: 'VIPER',   color: '#00ffc8', shape: 0, cost: 0,    handling: 10, nitro: 3.0, coinMul: 1.0 },
  { id: 'comet',   name: 'COMET',   color: '#ffb300', shape: 1, cost: 300,  handling: 12, nitro: 3.0, coinMul: 1.0 },
  { id: 'bolt',    name: 'BOLT',    color: '#00e5ff', shape: 2, cost: 700,  handling: 10, nitro: 4.0, coinMul: 1.0 },
  { id: 'midas',   name: 'MIDAS',   color: '#ffd700', shape: 3, cost: 1200, handling: 10, nitro: 3.0, coinMul: 1.5 },
  { id: 'phantom', name: 'PHANTOM', color: '#7c4dff', shape: 4, cost: 2000, handling: 13, nitro: 3.5, coinMul: 1.25 },
  { id: 'titan',   name: 'TITAN',   color: '#ff6d00', shape: 5, cost: 3200, handling: 9,  nitro: 5.0, coinMul: 1.5 },
  { id: 'aurora',  name: 'AURORA',  color: '#76ff03', shape: 6, cost: 5000, handling: 14, nitro: 4.5, coinMul: 1.75 },
  { id: 'apex',    name: 'APEX',    color: '#ff2d78', shape: 7, cost: 8000, handling: 15, nitro: 5.0, coinMul: 2.0 },
];

// ---------- upgrades ----------
export const UPGRADES = {
  nitro:  { name: 'NITRO TIME',  desc: '+20% nitro / level', max: 5, costs: [150, 300, 600, 1200, 2400] },
  magnet: { name: 'COIN MAGNET', desc: 'pull coins from afar', max: 5, costs: [100, 250, 500, 1000, 2000] },
  shield: { name: 'SHIELD',      desc: 'survive 1 crash per run', max: 1, costs: [800] },
};

// ---------- missions pool (sequential, 3 active) ----------
export const MISSIONS = [
  { id: 'dist5k',    name: 'Drive 5,000 m total',        stat: 'totalDist',  goal: 5000,  reward: 250 },
  { id: 'near50',    name: '50 near misses',             stat: 'nearMisses', goal: 50,    reward: 300 },
  { id: 'coins300',  name: 'Collect 300 coins',          stat: 'coinsEarned', goal: 300,  reward: 200 },
  { id: 'run1500',   name: 'Reach 1,500 m in one run',   stat: 'bestRun',    goal: 1500,  reward: 250 },
  { id: 'nitro15',   name: 'Use 15 nitro boosts',        stat: 'nitros',     goal: 15,    reward: 200 },
  { id: 'chain3',    name: 'Hit a x3 near-miss chain',   stat: 'bestChain',  goal: 3,     reward: 300 },
  { id: 'runs10',    name: 'Finish 10 runs',             stat: 'runs',       goal: 10,    reward: 250 },
  { id: 'dist20k',   name: 'Drive 20,000 m total',       stat: 'totalDist',  goal: 20000, reward: 600 },
  { id: 'near200',   name: '200 near misses',            stat: 'nearMisses', goal: 200,   reward: 700 },
  { id: 'coins1500', name: 'Collect 1,500 coins',        stat: 'coinsEarned', goal: 1500, reward: 500 },
  { id: 'run3000',   name: 'Reach 3,000 m in one run',   stat: 'bestRun',    goal: 3000,  reward: 800 },
  { id: 'chain5',    name: 'Hit a x5 near-miss chain',   stat: 'bestChain',  goal: 5,     reward: 900 },
  { id: 'runs40',    name: 'Finish 40 runs',             stat: 'runs',       goal: 40,    reward: 800 },
  { id: 'dist60k',   name: 'Drive 60,000 m total',       stat: 'totalDist',  goal: 60000, reward: 1500 },
];

function defaults() {
  return {
    wallet: 0,
    owned: ['viper'],
    selected: 'viper',
    upg: { nitro: 0, magnet: 0, shield: 0 },
    stats: { totalDist: 0, nearMisses: 0, coinsEarned: 0, bestRun: 0, nitros: 0, bestChain: 0, runs: 0 },
    missionsDone: 0, // how many missions completed (active = next 3)
    streak: 0,
    lastDay: '',
    controlHintSeen: false,
  };
}

export let M = defaults();

export function loadMeta() {
  let raw = dataGet(KEY);
  if (!raw) { try { raw = localStorage.getItem(KEY); } catch (e) {} }
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid meta shape');
      M = Object.assign(defaults(), p);
      M.upg = Object.assign(defaults().upg, p.upg || {});
      M.stats = Object.assign(defaults().stats, p.stats || {});
      M.controlHintSeen = p.controlHintSeen === true;
      if (!Array.isArray(M.owned)) M.owned = ['viper'];
      if (typeof M.wallet !== 'number' || !Number.isFinite(M.wallet) || M.wallet < 0) M.wallet = 0;
      for (const key of Object.keys(M.upg)) M.upg[key] = Math.max(0, Math.min(UPGRADES[key].max, Number(M.upg[key]) || 0));
      for (const key of Object.keys(M.stats)) M.stats[key] = Math.max(0, Number(M.stats[key]) || 0);
      if (!M.owned.includes('viper')) M.owned.push('viper');
      if (!M.owned.includes(M.selected)) M.selected = 'viper';
    } catch (e) { M = defaults(); }
  }
  return M;
}

export function saveMeta() {
  const raw = JSON.stringify(M);
  dataSet(KEY, raw);
  try { localStorage.setItem(KEY, raw); } catch (e) {}
}

export function getCar() { return CARS.find(c => c.id === M.selected) || CARS[0]; }

export function nitroDuration() { const car = getCar(); return car.nitro * (1 + 0.2 * M.upg.nitro); }
export function magnetRadius() { return M.upg.magnet > 0 ? 70 + 45 * M.upg.magnet : 0; }
export function hasShield() { return M.upg.shield > 0; }

export function buyCar(id) {
  const car = CARS.find(c => c.id === id);
  if (!car || M.owned.includes(id) || M.wallet < car.cost) return false;
  M.wallet -= car.cost;
  M.owned.push(id);
  M.selected = id;
  saveMeta();
  return true;
}

export function selectCar(id) {
  if (!M.owned.includes(id)) return false;
  M.selected = id;
  saveMeta();
  return true;
}

export function buyUpgrade(key) {
  const u = UPGRADES[key];
  if (!u) return false;
  const lvl = M.upg[key];
  if (lvl >= u.max) return false;
  const cost = u.costs[lvl];
  if (M.wallet < cost) return false;
  M.wallet -= cost;
  M.upg[key] = lvl + 1;
  saveMeta();
  return true;
}

export function activeMissions() {
  return MISSIONS.slice(M.missionsDone, M.missionsDone + 3);
}

// Returns list of newly completed missions (with rewards granted).
export function checkMissions() {
  const done = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of activeMissions()) {
      if (M.stats[m.stat] >= m.goal) {
        M.wallet += m.reward;
        M.missionsDone++;
        done.push(m);
        changed = true;
        break;
      }
    }
  }
  if (done.length) saveMeta();
  return done;
}

// Called at end of run. Returns { earned, missions } for UI.
export function commitRun({ dist, coins, nearMisses, nitros, bestChain }) {
  const car = getCar();
  const earned = Math.round(coins * car.coinMul);
  M.wallet += earned;
  M.stats.totalDist += Math.floor(dist);
  M.stats.nearMisses += nearMisses;
  M.stats.coinsEarned += earned;
  M.stats.nitros += nitros;
  M.stats.runs += 1;
  if (dist > M.stats.bestRun) M.stats.bestRun = Math.floor(dist);
  if (bestChain > M.stats.bestChain) M.stats.bestChain = bestChain;
  const missions = checkMissions();
  saveMeta();
  return { earned, missions };
}

export function addWallet(n) { M.wallet += n; saveMeta(); }

// The first-run control card is deliberately stored with the rest of the
// player profile: it should disappear as soon as the player demonstrates a
// control, and never reappear on a later visit with the same save.
export function markControlHintSeen() {
  if (M.controlHintSeen) return;
  M.controlHintSeen = true;
  saveMeta();
}

// Daily streak: call once at boot. Returns bonus coins granted today (0 if already claimed).
export function claimDaily(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (M.lastDay === day) return 0;
  const yest = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  M.streak = M.lastDay === yest ? M.streak + 1 : 1;
  M.lastDay = day;
  const bonus = 25 * Math.min(M.streak, 7);
  M.wallet += bonus;
  saveMeta();
  return bonus;
}
