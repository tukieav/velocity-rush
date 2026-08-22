// Render covers + screenshots for Velocity Rush
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const coverPath = 'file://' + join(root, 'marketing/cover.html');
const gameUrl = process.env.URL || 'http://localhost:8523/?debug=1';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });

async function shot(url, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => document.title === 'ready' || document.title !== '', null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(root, 'marketing', out), clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log(out, 'done');
}

await shot(coverPath + '?w=1920&h=1080', 1920, 1080, 'cover-16x9.png');
await shot(coverPath + '?w=800&h=800&sq=1', 800, 800, 'cover-1x1.png');
await shot(coverPath + '?w=800&h=1200&sq=1', 800, 1200, 'cover-2x3.png');

// gameplay screenshots from live game (menu + mid-run)
const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
await page.goto(gameUrl);
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(root, 'marketing', 'screenshot-menu.png') });
console.log('screenshot-menu.png done');

// start & bot-play for a good moment
const btn = await page.evaluate(() => {
  const s = window.__astro.getState();
  const b = s.buttons.find((x) => x.id === 'play');
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  return { x: r.left + (b.x + b.w / 2) * (r.width / (s.width || 540)), y: r.top + (b.y + b.h / 2) * (r.height / (s.height || 960)) };
});
await page.mouse.click(btn.x, btn.y);
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
const t0 = Date.now();
while (Date.now() - t0 < 9000) {
  const s = await page.evaluate(() => window.__astro.getState());
  if (s.state !== 'playing') break;
  const threat = s.obstacles.find((o) => o.lane === s.lane && o.y + o.h > s.playerY - 320 && o.y < s.playerY + 50);
  if (threat) {
    const danger = (l) => s.obstacles.some((o) => o.lane === l && o.y + o.h > s.playerY - 340 && o.y < s.playerY + 60);
    const opts = [s.lane - 1, s.lane + 1].filter((l) => l >= 0 && l <= 3 && !danger(l));
    if (opts.length) await page.keyboard.press(opts[0] < s.lane ? 'ArrowLeft' : 'ArrowRight');
  }
  await page.waitForTimeout(90);
}
await page.screenshot({ path: join(root, 'marketing', 'screenshot-gameplay.png') });
console.log('screenshot-gameplay.png done');

await browser.close();
