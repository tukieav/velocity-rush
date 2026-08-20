// Full-flow test for Velocity Rush (port 8515, system Chrome)
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8515/?debug=1';
const errors = [];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
console.log('OK: menu reached');

// click PLAY via debug button rects mapped to screen coords
async function clickButton(id) {
  let btn = null;
  for (let i = 0; i < 20 && !btn; i++) {
    btn = await page.evaluate((bid) => {
      const s = window.__astro.getState();
      const b = s.buttons.find((x) => x.id === bid);
      if (!b) return null;
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      return { x: r.left + (b.x + b.w / 2) * (r.width / 540), y: r.top + (b.y + b.h / 2) * (r.height / 960) };
    }, id);
    if (!btn) await page.waitForTimeout(100);
  }
  if (!btn) throw new Error('button not found: ' + id);
  await page.mouse.click(btn.x, btn.y);
}

await clickButton('play');
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
console.log('OK: playing');

// keyboard lane changes
const lane0 = await page.evaluate(() => window.__astro.getState().lane);
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(300);
const lane1 = await page.evaluate(() => window.__astro.getState().lane);
if (lane1 !== Math.max(0, lane0 - 1)) throw new Error('ArrowLeft lane change failed: ' + lane0 + '->' + lane1);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
console.log('OK: keyboard lane change');

// bot plays 6s avoiding cars via getState
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
  const s = await page.evaluate(() => window.__astro.getState());
  if (s.state !== 'playing') break;
  // find threats in my lane ahead
  const threat = s.obstacles.find((o) => o.lane === s.lane && o.y + o.h > s.playerY - 320 && o.y < s.playerY + 50);
  if (threat) {
    const danger = (l) => s.obstacles.some((o) => o.lane === l && o.y + o.h > s.playerY - 340 && o.y < s.playerY + 60);
    const opts = [s.lane - 1, s.lane + 1].filter((l) => l >= 0 && l <= 3 && !danger(l));
    if (opts.length) await page.keyboard.press(opts[0] < s.lane ? 'ArrowLeft' : 'ArrowRight');
  }
  await page.waitForTimeout(90);
}
const midState = await page.evaluate(() => window.__astro.getState());
console.log('bot survived, state=' + midState.state + ' score=' + midState.score + ' speed=' + midState.speed);
if (midState.score < 20) throw new Error('score did not grow');

// verify canvas is not black
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n++;
  return n;
});
console.log('bright samples:', bright);
if (bright === 0) throw new Error('canvas black!');

// force game over
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForFunction(() => window.__astro.getState().state === 'gameover', null, { timeout: 3000 });
console.log('OK: gameover');

// CONTINUE (rewarded) — locally SDK is absent so rewarded resolves false, state stays gameover
await clickButton('continue');
await page.waitForTimeout(1200);
const afterCont = await page.evaluate(() => window.__astro.getState().state);
console.log('after continue click, state=' + afterCont + ' (gameover expected locally w/o SDK, playing on CG)');

// PLAY AGAIN (midgame ad succeeds as no-op locally)
await clickButton('again');
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
console.log('OK: play again -> playing');

// best score persisted
const best = await page.evaluate(() => localStorage.getItem('velocityrush.best'));
console.log('best saved:', best);
if (!best || parseInt(best) <= 0) throw new Error('best not saved');

await page.screenshot({ path: 'test-gameplay.png' });
await browser.close();

if (errors.length) { console.log('ERRORS:', errors); process.exit(1); }
console.log('ALL TESTS PASSED, console errors: 0');
