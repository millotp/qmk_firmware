import hid from 'node-hid';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/*
Script that fetches data from different sources and sends it to the keyboard using HID.
Each packet must be exactly 32 bytes long.
*/

const LOCAL_DEV = true;
const STOCKS = ['DDOG', 'AAPL'] as const;
const METRO_LINES = ['6', '8', '9'] as const;
const PARIS_LAT = 48.8575;
const PARIS_LON = 2.3514;

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY!;
const PRIM_API_KEY = process.env.PRIM_API_KEY!;

if (!OPENWEATHERMAP_API_KEY || !PRIM_API_KEY) {
    throw new Error('.env is not set');
}

const STOCK_DATA_TYPE = 1;
const METRO_DATA_TYPE = 2;
const WEATHER_DATA_TYPE = 3;

interface Data {
    fetch(): Promise<void>;
    serialize(): Buffer[];
}

class StockData implements Data {
    private stocks: Record<typeof STOCKS[number], {
        name: string;
        stockName: typeof STOCKS[number];
        currentPrice: number;
        dayChangePercent: number;
        hourlyHistory: number[];
    }> = {} as any;

    constructor() { }

    async fetch(): Promise<void> {
        for (const stock of STOCKS) {
            // const response = await fetch(`https://api.iex.cloud/v1/stock/${stock}/quote`);
            // const data = await response.json();
            this.stocks[stock] = {
                name: 'Datadog',
                stockName: stock,
                currentPrice: 134.23,
                dayChangePercent: -1.24,
                hourlyHistory: [120, 130],
            };
        }
        return;
    }

    serialize(): Buffer[] {
        const payloads = [];
        for (const stock of Object.values(this.stocks)) {
            const payload = Buffer.alloc(32);
            // first byte is ignored
            payload.writeUInt8(STOCK_DATA_TYPE, 1); // stock data type
            // stock name is always 4 char
            payload.write(stock.stockName, 2, 4, 'utf8');
            payload.writeFloatLE(stock.currentPrice, 6);
            payload.writeFloatLE(stock.dayChangePercent, 10);
            payload.writeUInt8(stock.hourlyHistory.length, 14);
            // we have 13 bytes remaining, we encode each hour as 5 bits, so we can encode the last 20 hours.
            const max = Math.max(...stock.hourlyHistory);
            for (let i = 0; i < stock.hourlyHistory.length; i++) {
                const price = stock.hourlyHistory[i];
                payload.writeUInt8(Math.floor(price / max * 32), 15 + i);
            }
            payloads.push(payload);
        }

        return payloads;
    }
}

class MetroData implements Data {
    private lines: Record<typeof METRO_LINES[number], {
        name: string;
        incident: boolean;
    }> = {} as any;

    constructor() { }

    async fetch(): Promise<void> {
        const response = await fetch('https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports', {
            headers: {
                'Content-Type': 'application/json',
                'apikey': PRIM_API_KEY,
            },
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch metro data: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(data);
    }

    serialize(): Buffer[] {
        return [Buffer.alloc(32)];
    }
}

class WeatherData implements Data {
    private weather: {
        temperature: number;
        humidity: number;
        pressure: number;
    } = null as any;

    constructor() { }

    async fetch(): Promise<void> {
        // use openweathermap api to fetch weather data for the city
        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=Paris,fr&appid=${OPENWEATHERMAP_API_KEY}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch weather data: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(data);
        this.weather = {
            temperature: data.main.temp,
            humidity: data.main.humidity,
            pressure: data.main.pressure,
        };

        return;
    }

    serialize(): Buffer[] {
        const payload = Buffer.alloc(32);
        payload.writeUInt8(WEATHER_DATA_TYPE, 1);
        payload.writeFloatLE(this.weather.temperature, 2);
        payload.writeFloatLE(this.weather.humidity, 6);
        payload.writeFloatLE(this.weather.pressure, 10);
        return [payload];
    }
}

async function getKeyboard(): Promise<hid.HID> {
    if (LOCAL_DEV) {
        return null as any;
    }
    const devices = await hid.devicesAsync();
    const keyboard = devices.find(device => device.vendorId == 0x8D1D && device.usage == 0x62 && device.usagePage == 0xFF61);

    if (!keyboard) {
        throw new Error('Keyboard not found');
    }

    return new hid.HID(keyboard.path!);
}

async function main() {
    const keyboard = await getKeyboard();
    const fetchers: Data[] = [
        new StockData(),
        // new MetroData(),
        new WeatherData()
    ];

    for (const fetcher of fetchers) {
        await fetcher.fetch();
        if (LOCAL_DEV) {
            console.log(fetcher);
        } else {
            const payload = fetcher.serialize();
            for (const packet of payload) {
                keyboard.write(packet);
            }
        }
    }
}

main();
