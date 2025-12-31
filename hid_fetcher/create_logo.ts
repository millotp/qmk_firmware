import { PNG, type PNGWithMetadata } from 'pngjs';
import fsp from 'fs/promises';
import path from 'path';

type MODE = 'icon' | 'font';
const mode: MODE = 'font';

function isOn(r: number, g: number, b: number): boolean {
    // convert to greyscale, and apply a threshold to only turn on white pixels.
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    return grey <= 127;
}

function resizeImage(png: PNGWithMetadata, w: number): PNG {
    const h = Math.round(w / png.width * png.height);
    const resized = new PNG({ width: w, height: h });

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const sx = Math.floor((x / w) * png.width);
            const sy = Math.floor((y / h) * png.height);

            const si = (sy * png.width + sx) << 2;
            const di = (y * w + x) << 2;

            resized.data[di] = png.data[si];
            resized.data[di + 1] = png.data[si + 1];
            resized.data[di + 2] = png.data[si + 2];
            resized.data[di + 3] = png.data[si + 3];
        }
    }

    return resized;
}

async function convert() {
    const filename = process.argv[2];
    if (!filename) {
        throw new Error('Usage: node create_logo.ts <png>');
    }

    const data = await fsp.readFile(filename);
    let png: PNG | PNGWithMetadata = PNG.sync.read(data);

    if (png.width > 32) {
        png = resizeImage(png as any, 16);
    }
    if (png.height < 8) {
        throw new Error('please use an image with height >= 8 pixels');
    }

    const w = png.width;
    const wChar = Math.ceil(w / 6);
    const h = 16;
    const rows = Math.ceil(h / 8);
    const name = path.basename(filename, '.png');

    if (mode == 'icon') {
        const padding = 32 - w;
        // output the data row by row, each row being 8 pixel tall.
        console.log(`static const char PROGMEM ${name}_logo[] = {`);
        for (let row = 0; row < rows * 8; row += 8) {
            process.stdout.write('    ');
            for (let x = 0; x < w; x++) {
                let elem = 0;
                for (let y_off = 0; y_off < 8; y_off++) {
                    if (row + y_off >= h) {
                        continue;
                    }
                    const r = png.data[(x + (row + y_off) * w) * 4];
                    const g = png.data[(x + (row + y_off) * w) * 4 + 1];
                    const b = png.data[(x + (row + y_off) * w) * 4 + 2];
                    if (isOn(r, g, b)) {
                        elem |= 1 << y_off;
                    }
                }
                process.stdout.write(`0x${elem.toString(16).padStart(2, '0').toUpperCase()}, `);
            }

            for (let x = 0; x < padding; x++) {
                process.stdout.write('0x00, ');
            }
            console.log();
        }
        console.log('};');
    } else {
        // the font grid is 32x7 char
        let currChar = 0x89;
        const padding = wChar * 6 - w;
        // output the data row by row, char by char.
        process.stdout.write('  ');
        for (let row = 0; row < rows * 8; row += 8) {
            process.stdout.write('---------------------\n  ');
            for (let x = 0; x < w; x++) {
                if (x != 0 && x % 6 == 0) {
                    process.stdout.write(` // 0x${currChar.toString(16).padStart(2, '0').toUpperCase()} -- ${name} ${row / 8 * wChar + x / 6}\n  `);
                    currChar++;
                }
                let elem = 0;
                for (let y_off = 0; y_off < 8; y_off++) {
                    if (row + y_off >= h) {
                        continue;
                    }
                    const r = png.data[(x + (row + y_off) * w) * 4];
                    const g = png.data[(x + (row + y_off) * w) * 4 + 1];
                    const b = png.data[(x + (row + y_off) * w) * 4 + 2];
                    if (isOn(r, g, b)) {
                        elem |= 1 << y_off;
                    }
                }
                process.stdout.write(`0x${elem.toString(16).padStart(2, '0').toUpperCase()}, `);
            }
            for (let x = 0; x < padding; x++) {
                process.stdout.write('0x00, ');
            }
            process.stdout.write(` // 0x${currChar.toString(16).padStart(2, '0').toUpperCase()} -- ${name} ${(row / 8 + 1) * wChar}\n  `);
            currChar += 33 - wChar;
        }
    }
}

convert();
