import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from './fetcher.ts';
import { logger } from './logger.ts';

const STOCKS = ['DDOG', 'AAPL'] as const;
type Stock = typeof STOCKS[number];

type AlpacaResponse = {
    bars: Array<{
        t: string;
        vw: number;
    }> | null,
    next_page_token: string | null;
    symbol: string;
}

export class StockData implements Fetcher {
    private stocks: Record<Stock, {
        symbol: Stock;
        open: boolean;
        currentPrice: number;
        dayChangePercent: number;
        hourlyHistory: number[];
    }> = {} as any;

    #apiKey: string;
    #apiSecret: string;

    constructor(apiKey: string, apiSecret: string) {
        this.#apiKey = apiKey;
        this.#apiSecret = apiSecret;

        if (!this.#apiKey || !this.#apiSecret) {
            throw new Error('API key not found for Alpaca');
        }
    }

    async makeCall(): Promise<Record<Stock, AlpacaResponse>> {
        if (MOCK_API_CALLS) {
            return {
                'DDOG': {
                    bars: [
                        { t: '2026-01-02T14:00:00Z', vw: 136.681662 },
                        { t: '2026-01-02T15:00:00Z', vw: 133.681842 },
                        { t: '2026-01-02T16:00:00Z', vw: 133.15958 },
                        { t: '2026-01-02T17:00:00Z', vw: 133.424684 },
                        { t: '2026-01-02T18:00:00Z', vw: 132.563116 },
                    ],
                    next_page_token: null,
                    symbol: 'DDOG'
                },
                'AAPL': {
                    bars: [
                        { t: '2026-01-02T14:00:00Z', vw: 136.681662 },
                        { t: '2026-01-02T15:00:00Z', vw: 133.681842 },
                        { t: '2026-01-02T16:00:00Z', vw: 133.15958 },
                        { t: '2026-01-02T17:00:00Z', vw: 133.424684 },
                        { t: '2026-01-02T18:00:00Z', vw: 132.563116 },
                    ],
                    next_page_token: null,
                    symbol: 'AAPL'
                }
            }
        }

        const params = new URLSearchParams({
            timeframe: "1Hour",
            start: '2026-01-02',
            feed: 'iex',
        });

        const data: Record<Stock, AlpacaResponse> = {} as any;

        for (const symbol of STOCKS) {
            const res = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${params}`, {
                headers: {
                    'APCA-API-KEY-ID': this.#apiKey,
                    'APCA-API-SECRET-KEY': this.#apiSecret,
                },
            });
            if (!res.ok) throw new Error(`request to Alpaca failed: ${res.status} ${await res.text()}`);
            data[symbol] = await res.json();
        }

        return data;
    }

    async refresh(): Promise<void> {
        try {
            const data = await this.makeCall();
            for (const [symbol, stock] of (Object.entries(data) as Array<[Stock, AlpacaResponse]>)) {
                if (!stock.bars || stock.bars.length == 0) {
                    this.stocks[symbol] = {
                        symbol: symbol,
                        open: false,
                        currentPrice: 0,
                        dayChangePercent: 0,
                        hourlyHistory: [],
                    }

                    continue;
                }

                this.stocks[symbol] = {
                    symbol: symbol,
                    open: true,
                    currentPrice: stock.bars.at(-1)!.vw,
                    dayChangePercent: 0,
                    hourlyHistory: stock.bars.map((b: any) => b.vw),
                }
            }
        } catch (err) {
            logger.error(`Failed to refresh stock data: ${err}`);
        }
    }

    serialize(): Buffer[] {
        const payloads = [];
        for (const stock of Object.values(this.stocks)) {
            const payload = Buffer.alloc(32);
            // first byte is ignored
            payload.writeUInt8(DATA_TYPE.STOCK, 1); // stock data type
            // stock index
            payload.writeUInt8(STOCKS.indexOf(stock.symbol), 2);
            payload.writeUint8(stock.open ? 1 : 0, 3);
            payload.writeInt32BE(Math.round(stock.currentPrice * 100), 4);
            payload.writeInt32BE(Math.round(stock.dayChangePercent * 100), 8);
            payload.writeUInt8(stock.hourlyHistory.length, 12);
            // we have 12 bytes remaining, we encode each hour as 5 bits, so we can encode the last 20 hours.
            const max = Math.max(...stock.hourlyHistory);
            let bitPos = 0;
            for (const price of stock.hourlyHistory) {
                let normalized = Math.floor(price / max * 32);
                for (let i = 0; i < 5; i++, bitPos++) {
                    if (normalized & 1) {
                        const byteIndex = bitPos >> 3;
                        const bitIndex = bitPos & 7;
                        payload[byteIndex + 13] |= 1 << bitIndex;
                    }
                    normalized >>= 1;
                }
            }
            payloads.push(payload);
        }

        return payloads;
    }
}
