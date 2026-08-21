// Required visual proof: menu + active gameplay at the key hardening sizes.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:8523/?debug=1';
const OUT = 'qa/hardening';
const sizes = [[907,510], [1280,720], [1920,1080], [390,844]];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
for (const [width, height] of sizes) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(URL); await page.waitForFunction(() => window.__astro?.getState().state === 'menu');
  await page.screenshot({ path: `${OUT}/${width}x${height}-menu.png` });
  await page.evaluate(() => window.__astro.restart());
  // Let the authored opening present its marked rival, coin line, and nitro.
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${OUT}/${width}x${height}-gameplay.png` });
  await page.close();
  console.log(`captured ${width}x${height}`);
}
await browser.close();
