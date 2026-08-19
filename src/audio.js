// Velocity Rush — procedural audio via WebAudio (no audio files)
let ctx = null;
let masterGain = null;
let muted = false;

// engine sound state
let engineOsc = null, engineOsc2 = null, engineGain = null;

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : 0.5;
}

export function unlockAudio() { ensureCtx(); }

function tone(freq, dur, type, vol, delay = 0) {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

// Continuous engine hum — pitch scales with speed
export function startEngine() {
  ensureCtx();
  if (engineOsc) return;
  engineOsc = ctx.createOscillator();
  engineOsc2 = ctx.createOscillator();
  engineGain = ctx.createGain();
  engineOsc.type = 'sawtooth';
  engineOsc2.type = 'triangle';
  engineOsc.frequency.value = 60;
  engineOsc2.frequency.value = 121;
  engineGain.gain.value = 0.05;
  engineOsc.connect(engineGain); engineOsc2.connect(engineGain);
  engineGain.connect(masterGain);
  engineOsc.start(); engineOsc2.start();
}

export function setEngineSpeed(speedNorm) {
  // speedNorm 0..1+; pitch grows with speed
  if (!engineOsc || !ctx) return;
  const f = 55 + speedNorm * 110;
  engineOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.1);
  engineOsc2.frequency.setTargetAtTime(f * 2.02, ctx.currentTime, 0.1);
  engineGain.gain.setTargetAtTime(0.04 + speedNorm * 0.04, ctx.currentTime, 0.1);
}

export function stopEngine() {
  if (!engineOsc) return;
  try { engineOsc.stop(); engineOsc2.stop(); } catch (e) {}
  engineOsc = engineOsc2 = engineGain = null;
}

// Lane-change skid
export function skidSound() {
  ensureCtx();
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 1400; flt.Q.value = 1.5;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.14, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
  src.connect(flt); flt.connect(g); g.connect(masterGain);
  src.start(t0);
}

// Crash explosion
export function crashSound() {
  ensureCtx();
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.7, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(3000, t0); flt.frequency.exponentialRampToValueAtTime(120, t0 + 0.6);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.55, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
  src.connect(flt); flt.connect(g); g.connect(masterGain);
  src.start(t0);
  [110, 82, 55].forEach((f, i) => tone(f, 0.5, 'sawtooth', 0.2, i * 0.1));
}

// Coin / pickup
export function coinSound(combo = 0) {
  ensureCtx();
  const base = 880 + Math.min(combo, 10) * 60;
  tone(base, 0.09, 'square', 0.12);
  tone(base * 1.5, 0.12, 'sine', 0.12, 0.04);
}

export function nitroSound() {
  ensureCtx();
  if (muted || !ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator(); const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(900, t0 + 0.45);
  g.gain.setValueAtTime(0.2, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + 0.55);
}

export function nearMissSound() {
  ensureCtx();
  tone(1320, 0.08, 'sine', 0.1);
  tone(1760, 0.1, 'sine', 0.08, 0.05);
}

export function gameOverSound() {
  ensureCtx();
  [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.15, i * 0.15));
}
