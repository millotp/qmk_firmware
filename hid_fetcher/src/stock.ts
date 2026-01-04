import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from './fetcher.ts';

const STOCKS = ['DDOG', 'AAPL'] as const;

export class StockData implements Fetcher {
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