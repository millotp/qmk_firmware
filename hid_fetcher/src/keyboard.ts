import hid from 'node-hid';
import { logger } from './logger.ts';
import { sleep } from './sleep.ts';
import { refreshAndSend } from './main.ts';

let keyboard: hid.HIDAsync | null;
let lastHeartbeat = Date.now();

const LOCAL_DEV = false;

async function getKeyboard(): Promise<hid.HIDAsync> {
    if (LOCAL_DEV) {
        return null as any;
    }
    const devices = await hid.devicesAsync();
    const kb = devices.find(device => device.vendorId == 0x8D1D && device.usage == 0x62 && device.usagePage == 0xFF61);

    if (!kb) {
        throw new Error('Keyboard not found');
    }

    return await hid.HIDAsync.open(kb.path!, { nonExclusive: true });
}

function attachHooks() {
    if (!keyboard) {
        throw new Error('tried to attach hooks before finding the keyboard');
    }

    keyboard.on('data', (data) => {
        if (data[1] == 1) {
            lastHeartbeat = Date.now();
        }
    });

    keyboard.on('error', async () => {
        // happens when the keyboard is disconnected.
        // wait for a bit, then try to reconnect.
        logger.info('keyboard disconnected, retrying in a few seconds');

        if (keyboard) {
            keyboard.close();
            keyboard.removeAllListeners();
            keyboard = null;
        }

        await sleep(10);
        await waitForKeyboard();
    });
}

export function isKeyboardActive(): boolean {
    return Date.now() - lastHeartbeat > 10 * 60 * 1000;
}

export async function sendToKeyboard(packet: Buffer): Promise<number | undefined> {
    return keyboard?.write(packet);
}

export async function waitForKeyboard(): Promise<void> {
    while (true) {
        if (keyboard) {
            // keyboard is already set
            return;
        }
        try {
            keyboard = await getKeyboard();
            logger.info(`keyboard found, sending data`);
            attachHooks();
            refreshAndSend();
            return;
        } catch (err) {
            // ignore errors
        }

        await sleep(3 * 60);
    }
}