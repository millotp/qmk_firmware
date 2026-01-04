import hid from 'node-hid';
import dotenv from 'dotenv';
import { createLogger, format, transports } from 'winston';

dotenv.config({ quiet: true });

const { timestamp, printf } = format;
const logFormat = printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

const logger = createLogger({
    level: 'debug',
    format: format.combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
    defaultMeta: {
        service: 'hid-fetcher',
    },
    transports: [
        new transports.Console(),
        new transports.File({ filename: 'logs.txt' }),
    ]
});

/*
Script that fetches data from different sources and sends it to the keyboard using HID.
Each packet must be exactly 32 bytes long.
*/

const LOCAL_DEV = false;
const MOCK_API_CALLS = true;

const STOCKS = ['DDOG', 'AAPL'] as const;
const METRO_LINES = {
    // '6': 'line:IDFM:C01376',
    // '8': 'line:IDFM:C01378',
    '9': 'line:IDFM:C01379'
} as const;
const CITY = 'Paris,fr'

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY!;
const PRIM_API_KEY = process.env.PRIM_API_KEY!;

if (!OPENWEATHERMAP_API_KEY || !PRIM_API_KEY) {
    throw new Error('.env is not set');
}

const DATA_TYPE = {
    STOCK: 1,
    METRO: 2,
    METRO_MESSAGE_1: 3,
    METRO_MESSAGE_2: 4,
    WEATHER: 5,
};

interface Data {
    refresh(): Promise<void>;
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

    async makeCall() {
        if (MOCK_API_CALLS) {
            return {
                'DDOG': {
                    name: 'Datadog',
                    stockName: 'DDOG',
                    currentPrice: 134.23,
                    dayChangePercent: -1.24,
                    hourlyHistory: [120, 130],
                },
                'AAPL': {
                    name: 'Apple',
                    stockName: 'AAPL',
                    currentPrice: 500.23,
                    dayChangePercent: -20.24,
                    hourlyHistory: [50, 100, 150, 200, 250, 300, 350, 400, 450],
                }
            }
        }


    }

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        for (const stock of STOCKS) {
            this.stocks[stock] = (data as any)[stock] as any;
        }
        return;
    }

    serialize(): Buffer[] {
        const payloads = [];
        for (const stock of Object.values(this.stocks)) {
            const payload = Buffer.alloc(32);
            // first byte is ignored
            payload.writeUInt8(DATA_TYPE.STOCK, 1); // stock data type
            // stock name is always 4 char
            payload.write(stock.stockName, 2, 4, 'utf8');
            payload.writeInt32BE(Math.round(stock.currentPrice * 100), 6);
            payload.writeInt32BE(Math.round(stock.dayChangePercent * 100), 10);
            payload.writeUInt8(stock.hourlyHistory.length, 14);
            // we have 13 bytes remaining, we encode each hour as 5 bits, so we can encode the last 20 hours.
            const max = Math.max(...stock.hourlyHistory);
            let bitPos = 0;
            for (const price of stock.hourlyHistory) {
                let normalized = Math.floor(price / max * 32);
                for (let i = 0; i < 5; i++, bitPos++) {
                    if (normalized & 1) {
                        const byteIndex = bitPos >> 3;
                        const bitIndex = bitPos & 7;
                        payload[byteIndex + 15] |= 1 << bitIndex;
                    }
                    normalized >>= 1;
                }
            }
            payloads.push(payload);
        }

        return payloads;
    }
}

class MetroData implements Data {
    private lines: Record<keyof typeof METRO_LINES, {
        name: string;
        incident: false;
    } | {
        name: string;
        incident: true;
        message: string;
    }> = {} as any;

    constructor() { }

    async makeCall() {
        if (MOCK_API_CALLS) {
            return {
                '9': {
                    disruptions: [
                        {
                            messages: [
                                {
                                    text: "Métro 9 : Ajustement de l'intervalle entre les trains - Train stationne",
                                    channel: {
                                        content_type: "text/plain",
                                        id: "d9dbc5a6-7a06-11e8-8b8c-005056a44da2",
                                        name: "titre",
                                        types: [
                                            "title"
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                }
            };
        }

        const resp = {} as any;
        for (const [line, id] of Object.entries(METRO_LINES)) {
            const response = await fetch(`https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/line_reports/lines/${encodeURIComponent(id)}/line_reports?disable_geojson=true&filter_status%5B%5D=past`, {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': PRIM_API_KEY,
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch metro data: ${response.statusText}`);
            }

            resp[line] = await response.json();
        }

        return resp;
    }

    findMessage(data: any): string {
        // only select relevant info, and remove accents
        const message = data.disruptions[0].messages.find((m: any) => m.channel.name == "titre").text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
        if (message.includes(' : '))
            return message.split(' : ')[1]
        return message;
    }

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        let line: keyof typeof METRO_LINES;
        for (line in METRO_LINES) {
            if (line in data && 'disruptions' in data[line] && data[line].disruptions.length > 0) {
                this.lines[line] = {
                    name: line,
                    incident: true,
                    message: this.findMessage(data[line]),
                }
            } else {
                this.lines[line] = {
                    name: line,
                    incident: false
                };
            }
        }
    }

    serialize(): Buffer[] {
        const payloads = [];
        for (const incidents of Object.values(this.lines).filter(l => l.incident)) {
            const payload = Buffer.alloc(32);
            payload.writeUint8(DATA_TYPE.METRO, 1);
            payload.write(incidents.name, 2, 1, 'utf-8');
            payload.write(incidents.message, 3, 29, 'utf-8');
            payloads.push(payload);

            if (incidents.message.length > 29) {
                const message = Buffer.alloc(32);
                message.writeUint8(DATA_TYPE.METRO_MESSAGE_1, 1);
                message.write(incidents.name, 2, 1, 'utf-8');
                message.write(incidents.message.slice(29), 3, 29, 'utf-8');
                payloads.push(message);
            }

            if (incidents.message.length > 29 * 2) {
                const message = Buffer.alloc(32);
                message.writeUint8(DATA_TYPE.METRO_MESSAGE_2, 1);
                message.write(incidents.name, 2, 1, 'utf-8');
                message.write(incidents.message.slice(29 * 2), 3, 29, 'utf-8');
                payloads.push(message);
            }
        }

        return payloads;
    }
}

const WeatherCondition = {
    CLEAR: 0,
    CLOUDS: 1,
    RAIN: 2,
    STORM: 3,
    SNOW: 4,
    MIST: 5,
} as const;

interface OpenWeatherResponse {
    weather: Array<{
        id: number;
        main: string;
        description: string;
    }>;
    main: {
        temp: number;
        feels_like: number;
        pressure: number;
        humidity: number;
    };
    wind: {
        speed: number;
    };
    sys: {
        sunrise: number;
        sunset: number;
    };
}

class WeatherData implements Data {
    private condition: number = WeatherCondition.CLEAR;
    private temperature: number = 0; // °C
    private feelsLike: number = 0;   // °C
    private humidity: number = 0;    // %
    private pressure: number = 0;    // hPa
    private windSpeed: number = 0;   // m/s
    private sunrise: string = '00:00';
    private sunset: string = '00:00';

    constructor() { }

    private mapWeatherCondition(weatherId: number): number {
        if (weatherId >= 200 && weatherId < 300) return WeatherCondition.STORM;
        if (weatherId >= 300 && weatherId < 400) return WeatherCondition.RAIN;
        if (weatherId >= 500 && weatherId < 600) return WeatherCondition.RAIN;
        if (weatherId >= 600 && weatherId < 700) return WeatherCondition.SNOW;
        if (weatherId >= 700 && weatherId < 800) return WeatherCondition.MIST;
        if (weatherId === 800) return WeatherCondition.CLEAR;
        if (weatherId > 800) return WeatherCondition.CLOUDS;
        return WeatherCondition.CLEAR;
    }

    private formatTime(unixTimestamp: number): string {
        const date = new Date(unixTimestamp * 1000);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    async makeCall(): Promise<OpenWeatherResponse> {
        if (MOCK_API_CALLS) {
            return {
                weather: [
                    {
                        id: 800,
                        main: 'Clear',
                        description: 'clear sky',
                    }
                ],
                main: {
                    temp: 280,
                    feels_like: 275,
                    humidity: 72,
                    pressure: 1013,
                },
                wind: {
                    speed: 3.5,
                },
                sys: {
                    sunrise: 1717396800,
                    sunset: 1717339200,
                }
            };
        }

        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(CITY)}&appid=${OPENWEATHERMAP_API_KEY}&units=metrics`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Weather API error: ${response.status}`);
        }

        return await response.json();
    }

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        this.condition = this.mapWeatherCondition(data.weather[0]?.id || 800);
        this.temperature = Math.round(data.main.temp - 273.15);
        this.feelsLike = Math.round(data.main.feels_like - 273.15);
        this.humidity = data.main.humidity;
        this.pressure = Math.round(data.main.pressure);
        this.windSpeed = Math.round(data.wind.speed);
        this.sunrise = this.formatTime(data.sys.sunrise);
        this.sunset = this.formatTime(data.sys.sunset);
    }

    serialize(): Buffer[] {
        const payload = Buffer.alloc(32);
        let offset = 0;

        // Byte 0: Report ID (ignored by QMK)
        payload.writeUInt8(0x00, offset++);
        payload.writeUInt8(DATA_TYPE.WEATHER, offset++);
        payload.writeUInt8(this.condition, offset++);
        payload.writeInt16BE(this.temperature, offset);
        offset += 2;
        payload.writeInt16BE(this.feelsLike, offset);
        offset += 2;
        payload.writeUInt8(this.humidity, offset++);
        payload.writeUInt16BE(this.pressure, offset);
        offset += 2;
        payload.writeUInt8(this.windSpeed, offset++);
        payload.write(this.sunrise, offset, 5, 'ascii');
        offset += 5;
        payload.write(this.sunset, offset, 5, 'ascii');
        offset += 5;

        return [payload];
    }
}

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

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let keyboard: hid.HIDAsync | null;
let lastHeartbeat = Date.now();

const fetchers: Data[] = [
    // new StockData(),
    new MetroData(),
    new WeatherData()
];

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

        await sleep(10 * 1000);
        await waitForKeyboard();
    });
}



async function refreshAndSend() {
    if (!keyboard) {
        return;
    }

    for (const fetcher of fetchers) {
        await fetcher.refresh();
        logger.debug(JSON.stringify(fetcher, null, 2));

        const payload = fetcher.serialize();
        for (const packet of payload) {
            // spam the packets for macos
            if (process.platform === 'darwin') {
                for (let i = 0; i < 5; i++) {
                    await keyboard.write(packet);
                }
            } else {
                await keyboard.write(packet);
            }
        }
    }
}

async function waitForKeyboard(): Promise<void> {
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

        await sleep(3 * 60 * 1000);
    }
}

async function main() {
    await waitForKeyboard();

    while (true) {
        // sleep for 10 minutes
        await sleep(10 * 60 * 1000);

        if (Date.now() - lastHeartbeat > 10 * 60 * 1000) {
            logger.debug("keyboard is inactive, skip refresh");
            await sleep(1 * 60 * 1000);

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
