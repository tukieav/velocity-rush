import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const required = [[907,510],[1216,684],[1077,606],[821,462],[1366,768],[1920,1080],[1536,864],[1280,720],[800,450],[1080,607],[390,844]];
const viewports = process.env.VIEWPORTS ? process.env.VIEWPORTS.split(',').map((v) => v.split('x').map(Number)) : required;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const context = await browser.newContext({ deviceScaleFactor: 1, hasTouch: true });
const errors = [];
for (const [width, height] of viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  page.on('pageerror', (e) => errors.push(`${width}x${height}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${width}x${height}: ${m.text()}`); });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  const menu = await page.evaluate(() => {
    const s = window.__astro.getState(), r = document.getElementById('game').getBoundingClientRect();
    return { s, r: { width: r.width, height: r.height } };
  });
  assert.ok(menu.r.width >= width * .98 && menu.r.height >= height * .98, `${width}x${height}: canvas coverage`);
  const assertButtons = (buttons) => {
    for (const b of buttons) assert.ok(b.x >= -1 && b.y >= -1 && b.x + b.w <= width + 1 && b.y + b.h <= height + 1, `${width}x${height}: clipped ${b.id}`);
  };
  assertButtons(menu.s.buttons);
  const garage = menu.s.buttons.find((b) => b.id === 'garage');
  await page.mouse.click(garage.x + garage.w / 2, garage.y + garage.h / 2);
  await page.waitForFunction(() => window.__astro.getState().state === 'garage');
  await page.waitForFunction(() => window.__astro.getState().buttons.some((b) => b.id === 'back'));
  assertButtons(await page.evaluate(() => window.__astro.getState().buttons));
  const back = await page.evaluate(() => window.__astro.getState().buttons.find((b) => b.id === 'back'));
  await page.mouse.click(back.x + back.w / 2, back.y + back.h / 2);
  await page.waitForFunction(() => window.__astro.getState().state === 'menu');
  await page.waitForFunction(() => window.__astro.getState().buttons.some((b) => b.id === 'play'));
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
  console.log(`OK viewport ${width}x${height}`);
}
await browser.close();
assert.deepEqual(errors, [], errors.join('\n'));
console.log('VIEWPORT PASSED:', viewports.map((v) => v.join('x')).join(', '));
