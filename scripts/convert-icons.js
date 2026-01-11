import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src', 'icons');

const sizes = [16, 32, 48, 96];

async function convertIcons() {
  // Use icon-48.svg as the source (it has 128x128 viewBox for best detail)
  const svgPath = join(iconsDir, 'icon-48.svg');
  const svgString = readFileSync(svgPath, 'utf8');

  for (const size of sizes) {
    const pngPath = join(iconsDir, `icon-${size}.png`);

    try {
      const resvg = new Resvg(svgString, {
        fitTo: {
          mode: 'width',
          value: size,
        },
        background: 'rgba(0, 0, 0, 0)',
      });

      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();
      writeFileSync(pngPath, pngBuffer);
      console.log(`Created icon-${size}.png (${pngBuffer.length} bytes)`);
    } catch (err) {
      console.error(`Failed to create icon-${size}.png:`, err.message);
    }
  }
}

convertIcons();
