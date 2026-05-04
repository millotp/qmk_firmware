/**
 * Fetches metro, weather, and stock data and sends 32-byte HID packets to the keyboard.
 */

import { sleep } from './sleep.ts';
import { logger } from './logger.ts';
import { refreshAndSend } from './refresh.ts';
import { isKeyboardActive, isKeyboardConnected, sendToKeyboard, waitForKeyboard } from './keyboard.ts';

async function pushData(): Promise<void> {
    await refreshAndSend(sendToKeyboard);
}

async function main(): Promise<void> {
    await waitForKeyboard(pushData);

    while (true) {
        await sleep(10 * 60);

        if (!isKeyboardConnected()) {
            logger.debug('keyboard is not connected, skipping refresh');
            continue;
        }

        if (!isKeyboardActive()) {
            logger.debug('keyboard is inactive, skip refresh');
            continue;
        }

        await pushData();
    }
}

try {
    await main();
} catch (err) {
    logger.error(err);
    process.exit(1);
}
