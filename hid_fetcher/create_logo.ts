import { PNG } from 'pngjs';
import fsp from 'fs/promises';
import path from 'path';

function isOn(r: number, g: number, b: number): boolean {
    // convert to greyscale, and apply a threshold to only turn on white pixels.
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    return grey >= 127;
}

async function convert() {
    const filename = process.argv[2];
    if (!filename) {
        throw new Error('Usage: node create_logo.ts <png>');
    }

    const data = await fsp.readFile(filename);
    const png = PNG.sync.read(data);

    if (png.width > 32) {
        throw new Error('please use an image with width <= 32 pixels');
    }
    if (png.height < 8) {
        throw new Error('please use an image with height >= 8 pixels');
    }
    const padding = 32 - png.width;
    const rows = Math.ceil(png.height / 8);
    const name = path.basename(filename, '.png');
    console.log(`static const char PROGMEM ${name}_logo[] = {`);

    // output the data row by row, each row being 8 pixel tall.
    for (let row = 0; row < rows * 8; row += 8) {
        process.stdout.write('    ');
        for (let x = 0; x < png.width; x++) {
            let elem = 0;
            for (let y_off = 0; y_off < 8; y_off++) {
                if (row + y_off >= png.height) {
                    continue;
                }
                const r = png.data[(x + (row + y_off) * png.width) * 4];
                const g = png.data[(x + (row + y_off) * png.width) * 4 + 1];
                const b = png.data[(x + (row + y_off) * png.width) * 4 + 2];
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
}

convert();
