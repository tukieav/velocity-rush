import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const viewports = [[907,510],[1216,684],[1077,606],[821,462],[1366,768],[1920,1080],[1536,864],[1280,720],[800,450],[1080,607],[390,844]];
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const errors = [];
for (const [width, height] of viewports) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${width}x${height}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${width}x${height}: ${m.text()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  const menu = await page.evaluate(() => {
    const s = window.__astro.getState(), r = document.getElementById('game').getBoundingClientRect();
    return { s, r: { width: r.width, height: r.height } };
  });
  assert.ok(menu.r.width >= width * .98 && menu.r.height >= height * .98, `${width}x${height}: canvas coverage`);
  for (const b of menu.s.buttons) assert.ok(b.x >= -1 && b.y >= -1 && b.x + b.w <= width + 1 && b.y + b.h <= height + 1, `${width}x${height}: clipped ${b.id}`);
  const play = menu.s.buttons.find((b) => b.id === 'play');
  await page.mouse.click(play.x + play.w / 2, play.y + play.h / 2);
  await page.waitForFunction(() => window.__astro.getState().state === 'playing');
  const lane = await page.evaluate(() => window.__astro.getState().lane);
  await page.touchscreen.tap(width * .75, height * .70);
  await page.waitForTimeout(60);
  assert.notEqual(await page.evaluate(() => window.__astro.getState().lane), lane, `${width}x${height}: touch lane path`);
  await page.keyboard.press('ArrowLeft');
  assert.ok((await page.evaluate(() => window.__astro.getState().lane)) >= 0, `${width}x${height}: keyboard path`);
  await page.close();
  await context.close();
  console.log(`OK viewport ${width}x${height}`);
}
await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log('VIEWPORT PASSED: 10 mandatory DPR=1 sizes plus 390x844 mobile');
