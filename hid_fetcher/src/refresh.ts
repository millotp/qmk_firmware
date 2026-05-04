import dotenv from 'dotenv';
import { type Fetcher } from './fetcher.ts';
import { logger } from './logger.ts';
import { MetroData } from './metro.ts';
import { WeatherData } from './weather.ts';
import { StockData } from './stock.ts';

dotenv.config({ quiet: true });

const fetchers: Fetcher[] = [
    new MetroData(process.env.PRIM_API_KEY!),
    new WeatherData(process.env.OPENWEATHERMAP_API_KEY!),
    new StockData(process.env.ALPACA_API_KEY!, process.env.ALPACA_API_SECRET!),
];

export async function refreshAndSend(sendToKeyboard: (packet: Buffer) => Promise<void>): Promise<void> {
    for (const fetcher of fetchers) {
        await fetcher.refresh();
        logger.debug(`Refreshed ${fetcher.constructor.name}`);
        const payload = fetcher.serialize();
        for (const packet of payload) {
            await sendToKeyboard(packet);
        }
    }
}
