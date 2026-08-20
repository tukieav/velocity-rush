// Meta-progression test: wallet, garage buy/select, upgrades, missions, streak, persistence
import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:8515/?debug=1';
const errors = [];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
console.log('OK: menu');

async function st() { return page.evaluate(() => window.__astro.getState()); }
async function clickButton(id) {
  let btn = null;
  for (let i = 0; i < 30 && !btn; i++) {
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
  await page.waitForTimeout(150);
}

// daily bonus should have granted some wallet on first boot (streak 1 => +25)
let s = await st();
console.log('wallet after daily:', s.wallet, 'streak:', s.streak);
if (s.streak !== 1) throw new Error('streak expected 1, got ' + s.streak);
if (s.wallet < 25) throw new Error('daily bonus not granted');

// open garage
await clickButton('garage');
s = await st();
if (s.state !== 'garage') throw new Error('garage not opened');
console.log('OK: garage opened');

// grant coins, buy next car (comet 300) and upgrade
await page.evaluate(() => window.__astro.grantCoins(5000));
await clickButton('nextCar');
await clickButton('buyCar');
s = await st();
if (!s.owned.includes('comet')) throw new Error('comet not bought: ' + JSON.stringify(s.owned));
if (s.selected !== 'comet') throw new Error('comet not selected');
console.log('OK: bought + selected comet, wallet:', s.wallet);

// buy nitro upgrade level 1 + magnet + shield
await clickButton('upg_nitro');
await clickButton('upg_magnet');
await clickButton('upg_shield');
s = await st();
if (s.upgrades.nitro !== 1 || s.upgrades.magnet !== 1 || s.upgrades.shield !== 1)
  throw new Error('upgrades failed: ' + JSON.stringify(s.upgrades));
console.log('OK: upgrades', JSON.stringify(s.upgrades));

// back to menu, play a run; shield should be active
await clickButton('back');
await clickButton('play');
await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
s = await st();
if (!s.shieldReady) throw new Error('shield not active in run');
console.log('OK: playing with shield');

// simulate near-misses stat & end run — missions should complete
await page.evaluate(() => { window.__astro.addScore(500); window.__astro.setStat('nearMisses', 49); });
await page.waitForTimeout(800);
const before = await st();
await page.evaluate(() => window.__astro.forceGameOver());
// first crash consumed by shield -> still playing
await page.waitForTimeout(300);
s = await st();
if (s.state !== 'playing' || s.shieldReady) throw new Error('shield did not absorb crash: ' + s.state);
console.log('OK: shield absorbed crash');
await page.evaluate(() => window.__astro.forceGameOver());
await page.waitForFunction(() => window.__astro.getState().state === 'gameover', null, { timeout: 3000 });
s = await st();
if (!s.runResult) throw new Error('no runResult after crash');
console.log('OK: gameover, earned:', s.runResult.earned, 'wallet:', s.wallet, 'missions done:', s.missionsDone, 'stats:', JSON.stringify(s.stats));
if (s.runResult.earned < 0) throw new Error('bad earned');
if (s.stats.runs !== 1) throw new Error('runs stat wrong');

// persistence: reload, meta must survive
const walletBefore = s.wallet;
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
s = await st();
console.log('after reload: wallet', s.wallet, 'owned', JSON.stringify(s.owned), 'upgrades', JSON.stringify(s.upgrades), 'streak', s.streak);
if (s.wallet !== walletBefore) throw new Error('wallet lost on reload: ' + walletBefore + ' -> ' + s.wallet);
if (!s.owned.includes('comet') || s.selected !== 'comet') throw new Error('garage state lost on reload');
if (s.upgrades.nitro !== 1 || s.upgrades.shield !== 1) throw new Error('upgrades lost on reload');
if (s.streak !== 1) throw new Error('streak wrong after reload (same day should not increment)');
console.log('OK: persistence across reload');

// canvas pixels
const bright = await page.evaluate(() => {
  const c = document.getElementById('game');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 400) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) n++;
  return n;
});
console.log('bright samples:', bright);
if (bright === 0) throw new Error('canvas black');

await page.screenshot({ path: 'test-meta.png' });
await browser.close();
if (errors.length) { console.log('ERRORS:', errors); process.exit(1); }
console.log('META TESTS PASSED, console errors: 0');
