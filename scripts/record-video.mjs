// Record preview videos (landscape 1280x720, portrait 720x1280)
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, renameSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] || 'landscape';
const size = mode === 'portrait' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
const dir = join(root, 'marketing', 'vid-' + mode);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

async function attempt() {
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir, size } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8523/?debug=1');
  await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
  await page.waitForTimeout(800);
  // click PLAY
  const btn = await page.evaluate(() => {
    const s = window.__astro.getState();
    const b = s.buttons.find((x) => x.id === 'play');
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    return { x: r.left + (b.x + b.w / 2) * (r.width / 540), y: r.top + (b.y + b.h / 2) * (r.height / 960) };
  });
  await page.mouse.click(btn.x, btn.y);
  await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
  const t0 = Date.now();
  let survived = 0;
  while (Date.now() - t0 < 16500) {
    const s = await page.evaluate(() => window.__astro.getState());
    if (s.state !== 'playing') break;
    survived = Date.now() - t0;
    const threat = s.obstacles.find((o) => o.lane === s.lane && o.y + o.h > s.playerY - 340 && o.y < s.playerY + 50);
    if (threat) {
      const danger = (l) => s.obstacles.some((o) => o.lane === l && o.y + o.h > s.playerY - 360 && o.y < s.playerY + 60);
      const opts = [s.lane - 1, s.lane + 1].filter((l) => l >= 0 && l <= 3 && !danger(l));
      if (opts.length) {
        // prefer lane with pickups
        let pick = opts[0];
        for (const l of opts) if (s.pickups.some((p) => p.lane === l && p.y > s.playerY - 400 && p.y < s.playerY)) pick = l;
        await page.keyboard.press(pick < s.lane ? 'ArrowLeft' : 'ArrowRight');
      }
    } else {
      // opportunistic pickup grab if safe
      const near = s.pickups.find((p) => Math.abs(p.lane - s.lane) === 1 && p.y > s.playerY - 380 && p.y < s.playerY - 80);
      if (near) {
        const danger = s.obstacles.some((o) => o.lane === near.lane && o.y + o.h > s.playerY - 380 && o.y < s.playerY + 60);
        if (!danger) await page.keyboard.press(near.lane < s.lane ? 'ArrowLeft' : 'ArrowRight');
      }
    }
    await page.waitForTimeout(80);
  }
  const fin = await page.evaluate(() => window.__astro.getState());
  await ctx.close();
  console.log(mode, 'attempt survived', (survived / 1000).toFixed(1) + 's, final state', fin.state, 'score', fin.score);
  return survived;
}

let ok = false;
for (let i = 0; i < 5 && !ok; i++) {
  const s = await attempt();
  if (s >= 13000) ok = true;
  else {
    // remove failed video
    for (const f of readdirSync(dir)) if (f.endsWith('.webm')) renameSync(join(dir, f), join(dir, 'failed-' + i + '.webm'));
  }
}
await browser.close();
if (!ok) { console.error('FAILED: bot never survived 13s'); process.exit(1); }
// newest webm is the good one
const files = readdirSync(dir).filter((f) => f.endsWith('.webm') && !f.startsWith('failed'));
console.log('good video:', files[files.length - 1]);
renameSync(join(dir, files[files.length - 1]), join(dir, 'raw.webm'));
