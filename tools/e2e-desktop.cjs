// Native-canvas desktop regression gate. Run with a local server on :8523:
//   node tools/e2e-desktop.cjs
const { chromium } = require('playwright');
const fs = require('fs');

const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const OUT = process.env.OUT || 'qa/desktop';
const viewports = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
];

fs.mkdirSync(OUT, { recursive: true });

function assert(ok, message) { if (!ok) throw new Error(message); }

async function buttonPoint(page, id) {
  return page.evaluate((buttonId) => {
    const s = window.__astro.getState();
    const b = s.buttons.find((item) => item.id === buttonId);
    if (!b) return null;
    const r = document.getElementById('game').getBoundingClientRect();
    return { x: r.left + b.x * (r.width / s.width) + b.w * (r.width / s.width) / 2,
      y: r.top + b.y * (r.height / s.height) + b.h * (r.height / s.height) / 2 };
  }, id);
}

async function clickButton(page, id) {
  const p = await buttonPoint(page, id);
  assert(p, 'button not found: ' + id);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(180);
}

async function checkCanvas(page, vp) {
  const result = await page.evaluate(() => {
    const c = document.getElementById('game');
    const r = c.getBoundingClientRect();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const sample = (x, y) => {
      const xx = Math.max(0, Math.min(c.width - 1, Math.round(x * (c.width - 1))));
      const yy = Math.max(0, Math.min(c.height - 1, Math.round(y * (c.height - 1))));
      const i = (yy * c.width + xx) * 4;
      return d[i] + d[i + 1] + d[i + 2];
    };
    return { cssW: r.width, cssH: r.height, left: sample(.015, .55), right: sample(.985, .55), top: sample(.5, .03), bottom: sample(.5, .97) };
  });
  assert(Math.abs(result.cssW - vp.width) < 1 && Math.abs(result.cssH - vp.height) < 1,
    'canvas is not full viewport: ' + JSON.stringify(result));
  for (const key of ['left', 'right', 'top', 'bottom']) assert(result[key] > 15, 'dead canvas edge: ' + key + '=' + result[key]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const errors = [];
  try {
    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => errors.push(vp.width + 'x' + vp.height + ' pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(vp.width + 'x' + vp.height + ' console: ' + m.text()); });
      await page.goto(URL, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__astro && window.__astro.getState().state === 'menu', null, { timeout: 15000 });
      const initial = await page.evaluate(() => window.__astro.getState());
      assert(initial.width === vp.width && initial.height === vp.height, 'logical viewport did not adapt');
      assert(initial.desktop === (vp.width / vp.height >= 1.08), 'desktop layout mode incorrect');
      await checkCanvas(page, vp);
      await page.screenshot({ path: OUT + '/' + vp.width + 'x' + vp.height + '-menu.png' });

      await clickButton(page, 'garage');
      assert((await page.evaluate(() => window.__astro.getState().state)) === 'garage', 'garage did not open');
      await checkCanvas(page, vp);
      await page.screenshot({ path: OUT + '/' + vp.width + 'x' + vp.height + '-garage.png' });
      await clickButton(page, 'back');
      await clickButton(page, 'play');
      await page.waitForFunction(() => window.__astro.getState().state === 'playing', null, { timeout: 5000 });
      const before = await page.evaluate(() => window.__astro.getState().lane);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => window.__astro.getState().lane);
      assert(after === Math.min(3, before + 1), 'lane control failed');
      // A launch image must prove that the opening is a game, not an empty
      // road: drive long enough for the scripted reward line and marked rival
      // to enter frame, then require at least two live traffic vehicles.
      await page.waitForTimeout(3200);
      const opening = await page.evaluate(() => window.__astro.getState());
      assert(opening.state === 'playing', 'opening traffic caused an early crash');
      assert(opening.trafficVisible >= 2,
        'opening scene has too little visible traffic: ' + opening.trafficVisible);
      assert(opening.pickups.filter((p) => p.kind === 'coin').length >= 2,
        'opening scene lost its coin line');
      await checkCanvas(page, vp);
      await page.screenshot({ path: OUT + '/' + vp.width + 'x' + vp.height + '-gameplay.png' });
      await page.evaluate(() => window.__astro.nitro());
      await page.waitForTimeout(100);
      assert((await page.evaluate(() => window.__astro.getState().nitroT)) > 0, 'nitro control failed');
      await checkCanvas(page, vp);
      await page.close();
      console.log('OK', vp.width + 'x' + vp.height);
    }
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('DESKTOP E2E PASSED: full canvas, live edges, garage, lanes, nitro, errors=0');
})().catch((err) => { console.error(err.stack || err); process.exit(1); });
