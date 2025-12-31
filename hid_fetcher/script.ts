import hid from 'node-hid';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

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

const STOCK_DATA_TYPE = 1;
const METRO_DATA_TYPE = 2;
const WEATHER_DATA_TYPE = 3;

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
            payload.writeUInt8(STOCK_DATA_TYPE, 1); // stock data type
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

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        let line: keyof typeof METRO_LINES;
        for (line in METRO_LINES) {
            if (line in data && 'disruptions' in data[line] && data[line].disruptions.length > 0) {
                this.lines[line] = {
                    name: line,
                    incident: true,
                    message: data[line].disruptions[0].messages.find((m: any) => m.channel.name == "titre").text,
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
            payload.writeUint8(METRO_DATA_TYPE, 1);
            payload.write(incidents.name, 2, 1, 'utf-8');
            payload.write(incidents.message, 3, 29, 'utf-8');
            payloads.push(payload);
        }

        return payloads;
    }
}

class WeatherData implements Data {
    private weather: {
        temperature: number;
        feelsLike: number;
        humidity: number;
        pressure: number;
        sunset: number;
    } = null as any;

    constructor() { }

    async makeCall() {
        if (MOCK_API_CALLS) {
            return {
                main: {
                    temp: 280,
                    feels_like: 275,
                    humidity: 56,
                    pressure: 1000,
                },
                sys: {
                    sunset: 1767110521,
                }
            };
        }

        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${CITY}&appid=${OPENWEATHERMAP_API_KEY}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch weather data: ${response.statusText}`);
        }
        return await response.json();
    }

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        this.weather = {
            temperature: data.main.temp - 273.15,
            feelsLike: data.main.feels_like - 273.15,
            humidity: data.main.humidity,
            pressure: data.main.pressure,
            sunset: data.sys.sunset,
        };

        return;
    }

    serialize(): Buffer[] {
        const payload = Buffer.alloc(32);
        payload.writeUInt8(WEATHER_DATA_TYPE, 1);
        payload.writeInt16BE(Math.round(this.weather.temperature), 2);
        payload.writeInt16BE(Math.round(this.weather.feelsLike), 4);
        payload.writeUInt8(this.weather.humidity, 6);
        payload.writeUInt16BE(this.weather.pressure, 7);
        const sunset = new Date(this.weather.sunset * 1000);
        payload.write(`${String(sunset.getHours()).padStart(2, '0')}:${String(sunset.getMinutes()).padStart(2, '0')}`, 9);
        return [payload];
    }
}

async function getKeyboard(): Promise<hid.HID> {
    if (LOCAL_DEV) {
        return null as any;
    }
    const devices = hid.devices();
    const keyboard = devices.find(device => device.vendorId == 0x8D1D && device.usage == 0x62 && device.usagePage == 0xFF61);

    if (!keyboard) {
        throw new Error('Keyboard not found');
    }

    return new hid.HID(keyboard.path!);
}

async function main() {
    const keyboard = await getKeyboard();
    const fetchers: Data[] = [
        // new StockData(),
        // new MetroData(),
        new WeatherData()
    ];

    for (const fetcher of fetchers) {
        await fetcher.refresh();
        console.log(JSON.stringify(fetcher, null, 2));

        const payload = fetcher.serialize();
        for (const packet of payload) {
            console.log(packet);
            keyboard.write(packet);
        }
    }
}

main();
