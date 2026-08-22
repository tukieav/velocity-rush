// Record a clean gameplay reel, then prepend the matching cover for the
// CrazyGames-required opening hold. Usage: node scripts/record-video.mjs
// landscape|portrait. The final files are 1920x1080 and 800x1200 (2:3).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] || 'landscape';
const config = {
  landscape: { size: { width: 1920, height: 1080 }, cover: 'cover-16x9.png', output: 'video-landscape.mp4' },
  portrait: { size: { width: 800, height: 1200 }, cover: 'cover-2x3.png', output: 'video-portrait.mp4' },
}[mode];
if (!config) throw new Error('mode must be landscape or portrait');

const url = process.env.URL || 'http://localhost:8523/?debug=1';
const scratch = mkdtempSync(join(tmpdir(), 'velocity-rush-video-'));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

async function recordAttempt() {
  const context = await browser.newContext({ viewport: config.size, recordVideo: { dir: scratch, size: config.size } });
  const page = await context.newPage();
  const video = page.video();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu', null, { timeout: 15000 });
  const play = await page.evaluate(() => {
    const s = window.__astro.getState();
    const b = s.buttons.find((x) => x.id === 'play');
    const r = document.getElementById('game').getBoundingClientRect();
    return { x: r.left + (b.x + b.w / 2) * (r.width / s.width), y: r.top + (b.y + b.h / 2) * (r.height / s.height) };
  });
  await page.mouse.click(play.x, play.y);
  await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
  // A real early steer removes the first-run control card before the trimmed
  // gameplay starts, leaving a clean in-motion reel after the cover hold.
  await page.keyboard.press('ArrowRight');
  const started = Date.now();
  let survived = true;
  while (Date.now() - started < 17100) {
    const s = await page.evaluate(() => window.__astro.getState());
    if (s.state !== 'playing') { survived = false; break; }
    const threat = s.obstacles.find((o) => o.lane === s.lane && o.y + o.h > s.playerY - 360 && o.y < s.playerY + 70);
    if (threat) {
      const safe = [s.lane - 1, s.lane + 1].filter((lane) => lane >= 0 && lane < 4 && !s.obstacles.some((o) => o.lane === lane && o.y + o.h > s.playerY - 410 && o.y < s.playerY + 90));
      if (safe.length) await page.keyboard.press(safe[0] < s.lane ? 'ArrowLeft' : 'ArrowRight');
    }
    await page.waitForTimeout(65);
  }
  const final = await page.evaluate(() => window.__astro.getState().state);
  await context.close();
  return { survived: survived && final === 'playing', raw: await video.path() };
}

let raw;
for (let attempt = 1; attempt <= 5 && !raw; attempt++) {
  const result = await recordAttempt();
  console.log(`${mode} attempt ${attempt}: ${result.survived ? 'clean gameplay' : 'rejected after crash'}`);
  if (result.survived) raw = result.raw;
}
await browser.close();
if (!raw) { rmSync(scratch, { recursive: true, force: true }); throw new Error('could not record a clean 15-second gameplay reel'); }

const output = join(root, 'marketing', config.output);
execFileSync('ffmpeg', [
  '-y', '-loop', '1', '-framerate', '30', '-t', '0.7', '-i', join(root, 'marketing', config.cover),
  // Remove navigation/menu lead-in. The recorded run is deliberately longer
  // than the 15-second gameplay segment that follows.
  '-ss', '2.2', '-t', '15', '-i', raw,
  '-filter_complex', `[0:v]fps=30,scale=${config.size.width}:${config.size.height},format=yuv420p[cover];[1:v]fps=30,scale=${config.size.width}:${config.size.height},format=yuv420p[game];[cover][game]concat=n=2:v=1:a=0[v]`,
  '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-movflags', '+faststart', output,
], { stdio: 'inherit' });
rmSync(scratch, { recursive: true, force: true });
console.log('wrote', output);
