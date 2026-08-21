// Capture QA screenshots: menu, driving, nitro, garage, gameover
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const OUT = process.env.OUT || '/tmp/vrqa';
import fs from 'fs';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 620, height: 1050 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/1-menu.png' });

async function clickButton(id) {
  const btn = await page.evaluate((bid) => {
    const s = window.__astro.getState();
    const b = s.buttons.find((x) => x.id === bid);
    if (!b) return null;
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    return { x: r.left + (b.x + b.w / 2) * (r.width / (s.width || 540)), y: r.top + (b.y + b.h / 2) * (r.height / (s.height || 960)) };
  }, id);
  if (!btn) throw new Error('button not found: ' + id);
  await page.mouse.click(btn.x, btn.y);
}

// garage first
await clickButton('garage');
await page.waitForTimeout(900);
await page.screenshot({ path: OUT + '/2-garage.png' });
await clickButton('back');
await page.waitForTimeout(300);

// play, with a simple auto-dodge bot so we don't crash during capture
await clickButton('play');
async function botStep() {
  await page.evaluate(() => {
    const s = window.__astro.getState();
    if (s.state !== 'playing') return;
    const danger = s.obstacles.filter(o => o.lane === s.lane && o.y + o.h > 250 && o.y < s.playerY + 60);
    if (danger.length) {
      const occupied = new Set(s.obstacles.filter(o => o.y + o.h > 200 && o.y < s.playerY + 160).map(o => o.lane));
      for (const cand of [s.lane - 1, s.lane + 1]) {
        if (cand >= 0 && cand < 4 && !occupied.has(cand)) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: cand < s.lane ? 'ArrowLeft' : 'ArrowRight' }));
          break;
        }
      }
    }
  });
}
for (let i = 0; i < 140; i++) { await botStep(); await page.waitForTimeout(50); }
await page.screenshot({ path: OUT + '/3-driving.png' });

// force nitro via state injection is not exposed; simulate by waiting for pickup — instead speed up via addScore then screenshot high speed
await page.evaluate(() => { window.__astro.nitro(); });
for (let i = 0; i < 20; i++) { await botStep(); await page.waitForTimeout(50); }
await page.screenshot({ path: OUT + '/4-nitro.png' });

// force game over for crash/gameover screen
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + '/5-crash-slowmo.png' });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT + '/6-gameover.png' });

console.log('errors:', errors.length, errors.slice(0, 5));
await browser.close();
