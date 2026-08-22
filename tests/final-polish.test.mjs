import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { speedometerGauge } from '../src/feedback.js';
import { isMarkedNearMiss, trafficCarWidth } from '../src/traffic.js';

// Regression 1: a marked adjacent pass must remain possible on the largest
// official landscape canvas; the old 140px cap leaves too much empty road.
const wideLane = 435;
const wideCar = trafficCarWidth(wideLane, true);
assert.equal(wideCar, 200, 'wide traffic uses the responsive cap');
assert.ok(isMarkedNearMiss(0, wideLane, wideLane, wideCar), 'adjacent marked rival earns a close call at 1920px');
assert.equal(isMarkedNearMiss(0, wideLane, wideLane, 140), false, 'old 140px cap proves the former landscape regression');
assert.equal(isMarkedNearMiss(0, wideLane * 2, wideLane, wideCar), false, 'two lanes away is never a close call');

// Regression 2: nitro may reach 648 KM/H, so it must not pin the dial.
const nitroGauge = speedometerGauge(648);
assert.equal(nitroGauge.max, 700);
assert.ok(nitroGauge.fraction > 0.9 && nitroGauge.fraction < 1, '648 KM/H remains distinguishable from the redline');

// Regression 3: the compact/mobile garage remains fully usable from a
// keyboard or switch-control path, including its primary buy/select action.
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
await page.goto(process.env.URL || 'http://localhost:8523/?debug=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
const garage = await page.evaluate(() => window.__astro.getState().buttons.find((b) => b.id === 'garage'));
await page.mouse.click(garage.x + garage.w / 2, garage.y + garage.h / 2);
await page.waitForFunction(() => window.__astro.getState().state === 'garage');
assert.equal(await page.evaluate(() => window.__astro.getState().garageCar), 'viper');
await page.keyboard.press('ArrowRight');
assert.equal(await page.evaluate(() => window.__astro.getState().garageCar), 'comet');
await page.evaluate(() => window.__astro.grantCoins(300));
await page.keyboard.press('Enter');
const garageState = await page.evaluate(() => window.__astro.getState());
assert.equal(garageState.selected, 'comet');
assert.ok(garageState.owned.includes('comet'));
await browser.close();
console.log('FINAL POLISH PASSED: landscape close call, nitro gauge, keyboard garage');
