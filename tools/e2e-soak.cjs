const { chromium } = require('playwright');
const assert = require('assert');
const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const SECONDS = Number(process.env.SOAK_SECONDS || 120);
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  await page.evaluate(() => window.__astro.restart());
  for (let second = 0; second < SECONDS; second++) {
    await page.evaluate((tick) => {
      const s = window.__astro.getState();
      const threat = s.obstacles.find(o => o.lane === s.lane && o.y + o.h > s.playerY - 260 && o.y < s.playerY + 50);
      if (threat) window.__astro.move(s.lane > 0 ? -1 : 1);
      if (tick % 9 === 0) window.__astro.nitro();
      window.__astro.advance(1);
    }, second);
    let s = await page.evaluate(() => window.__astro.getState());
    if (s.state !== 'playing') { await page.evaluate(() => window.__astro.restart()); s = await page.evaluate(() => window.__astro.getState()); }
    const c = s.debugCounts;
    assert(c.traffic <= 18 && c.pickups <= 36 && c.particles <= 240 && c.trail <= 90 && c.floaters <= 20, `unbounded pool: ${JSON.stringify(c)}`);
    assert.equal(c.listeners, 7, 'listener count changed after restart');
  }
  const fps = await page.evaluate(() => new Promise(resolve => { let n = 0, prev = performance.now(), total = 0; function f(now) { total += now - prev; prev = now; if (++n === 30) resolve(1000 / (total / n)); else requestAnimationFrame(f); } requestAnimationFrame(f); }));
  assert(fps >= 20, `render health too low: ${fps}`);
  await browser.close();
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log(`SOAK PASSED: accelerated ${SECONDS}s, restarts, bounded pools, ${fps.toFixed(1)} FPS`);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
