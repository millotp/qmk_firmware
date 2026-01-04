/*
Script that fetches data from different sources and sends it to the keyboard using HID.
Each packet must be exactly 32 bytes long.
*/

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { type Fetcher } from './fetcher.ts';
import { MetroData } from './metro.ts';
import { WeatherData } from './weather.ts';
import { sleep } from './sleep.ts';
import { logger } from './logger.ts';
import { isKeyboardActive, sendToKeyboard, waitForKeyboard } from './keyboard.ts';

const fetchers: Fetcher[] = [
    new MetroData(),
    new WeatherData(),
]

export async function refreshAndSend() {
    for (const fetcher of fetchers) {
        await fetcher.refresh();
        logger.debug(JSON.stringify(fetcher, null, 2));

        const payload = fetcher.serialize();
        for (const packet of payload) {
            // spam the packets for macos
            if (process.platform === 'darwin') {
                for (let i = 0; i < 5; i++) {
                    await sendToKeyboard(packet);
                }
            } else {
                await sendToKeyboard(packet);
            }
        }
    }
}

async function main() {
    await waitForKeyboard();

    while (true) {
        // sleep for 10 minutes
        await sleep(10 * 60);

        if (isKeyboardActive()) {
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
}
