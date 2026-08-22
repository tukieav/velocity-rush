import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 907, height: 510 } });
await page.goto(process.env.URL || 'http://localhost:8523/?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => window.__astro.restart());
await page.waitForFunction(() => window.__astro?.getState().state === 'playing');
const before = await page.evaluate(() => window.__astro.getState().lane);
// AZERTY reports key "z" for the physical KeyW position; the game must use
// code, so that physical movement key still moves the car.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z', bubbles: true })));
await page.waitForTimeout(40);
const after = await page.evaluate(() => window.__astro.getState().lane);
assert.equal(after, before - 1, 'physical KeyW moves left regardless of key value');
await browser.close();
console.log('CONTROL LAYOUT PASSED: physical KeyW works with AZERTY key z');
