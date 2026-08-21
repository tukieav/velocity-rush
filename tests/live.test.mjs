// Live verification: console errors + canvas pixels + play a few moves
import { chromium } from 'playwright';
const URL = 'https://tukieav.github.io/velocity-rush/?debug=1';
const errors = [];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 25000 });
console.log('menu reached on live');
// pixels on menu
async function brightCount() {
  return page.evaluate(() => {
    const c = document.getElementById('game');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n++;
    return n;
  });
}
console.log('menu bright samples:', await brightCount());
// play
const btn = await page.evaluate(() => {
  const s = window.__astro.getState();
  const b = s.buttons.find((x) => x.id === 'play');
  const c = document.getElementById('game');
  const r = c.getBoundingClientRect();
  return { x: r.left + (b.x + b.w / 2) * (r.width / (s.width || 540)), y: r.top + (b.y + b.h / 2) * (r.height / (s.height || 960)) };
});
await page.mouse.click(btn.x, btn.y);
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
// a few moves
await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(400);
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(2500);
const s = await page.evaluate(() => window.__astro.getState());
console.log('live playing, score:', s.score, 'speed:', s.speed);
const bright = await brightCount();
console.log('gameplay bright samples:', bright);
await browser.close();
// SDK timeout warning is expected on Pages; check errors
const realErrors = errors.filter((e) => !e.includes('sdk') && !e.includes('crazygames'));
console.log('all console errors:', JSON.stringify(errors));
if (bright === 0) { console.log('FAIL: black canvas'); process.exit(1); }
if (realErrors.length) { console.log('FAIL errors:', realErrors); process.exit(1); }
console.log('LIVE VERIFIED OK, pixels bright:', bright, 'errors:', realErrors.length);
