import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 907, height: 510 } });
await page.goto(process.env.URL || 'http://localhost:8523/?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
await page.evaluate(() => window.__astro.restart());
await page.waitForTimeout(180);
const beforePause = await page.evaluate(() => window.__astro.getState().score);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(250);
assert.equal(await page.evaluate(() => window.__astro.getState().score), beforePause, 'blur freezes simulation');
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(180);
assert.ok(await page.evaluate(() => window.__astro.getState().score) > beforePause, 'focus resumes simulation');
await browser.close();
console.log('LIFECYCLE PASSED: blur pauses and focus resumes');
