// Objective R4 cover-art gate. Uses standard sRGB relative luminance and HSV saturation.
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const files = process.argv.slice(2);
const targets = files.length ? files : [
  'marketing/cover-16x9.png', 'marketing/cover-2x3.png', 'marketing/cover-1x1.png',
];
let failed = false;
for (const file of targets) {
  const png = PNG.sync.read(readFileSync(file));
  let lumTotal = 0, dark = 0, satTotal = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i] / 255, g = png.data[i + 1] / 255, b = png.data[i + 2] / 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 255;
    lumTotal += lum; if (lum < 40) dark++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    satTotal += max === 0 ? 0 : (max - min) / max;
  }
  const count = png.width * png.height;
  const meanLum = lumTotal / count, darkFrac = dark / count, meanSat = satTotal / count;
  const ok = meanLum >= 80 && darkFrac <= .35 && meanSat >= .35;
  console.log(`${file}: meanLum=${meanLum.toFixed(2)} darkFrac=${darkFrac.toFixed(4)} meanSat=${meanSat.toFixed(4)} ${ok ? 'PASS' : 'FAIL'}`);
  failed ||= !ok;
}
process.exitCode = failed ? 1 : 0;
