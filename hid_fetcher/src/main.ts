/*
Script that fetches data from different sources and sends it to the keyboard using HID.
Each packet must be exactly 32 bytes long.
*/

import dotenv from 'dotenv';
import { type Fetcher } from './fetcher.ts';
import { MetroData } from './metro.ts';
import { WeatherData } from './weather.ts';
import { sleep } from './sleep.ts';
import { logger } from './logger.ts';
import { isKeyboardActive, sendToKeyboard, waitForKeyboard } from './keyboard.ts';
import { StockData } from './stock.ts';

dotenv.config({ quiet: true });

const PRIM_API_KEY = process.env.PRIM_API_KEY!;
const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY!;
const ALPACA_API_KEY = process.env.ALPACA_API_KEY!;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET!;

const fetchers: Fetcher[] = [
    new MetroData(PRIM_API_KEY),
    new WeatherData(OPENWEATHERMAP_API_KEY),
    new StockData(ALPACA_API_KEY, ALPACA_API_SECRET),
]

export async function refreshAndSend() {
    for (const fetcher of fetchers) {
        await fetcher.refresh();
        logger.debug(JSON.stringify(fetcher, null, 2));

        const payload = fetcher.serialize();
        for (const packet of payload) {
            await sendToKeyboard(packet);
        }
    }
}

async function main() {
    await waitForKeyboard();

    while (true) {
        // sleep for 10 minutes
        await sleep(10 * 60);

        if (!isKeyboardActive()) {
            logger.debug("keyboard is inactive, skip refresh");
            await sleep(1 * 60);

            continue;
        }

        await refreshAndSend();
    }
}

try {
    await main();
} catch (err) {
    logger.error(err);
    process.exit(1);
}
