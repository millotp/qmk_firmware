import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from './fetcher.ts';
import { logger } from './logger.ts';

const STOCKS = ['DDOG', 'AAPL'] as const;
type Stock = typeof STOCKS[number];

type AlpacaBar = {
    t: string;
    vw: number;
};

type AlpacaBarResponse = {
    bars: Array<AlpacaBar> | null,
    next_page_token: string | null;
    symbol: string;
}

type AlpacaLatestTradeResponse = {
    trade: {
        p: number; // price
        t: string; // timestamp
    };
    symbol: string;
}

type AlpacaSnapshotResponse = {
    latestTrade: {
        p: number;
        t: string;
    };
    prevDailyBar: {
        c: number; // previous day close
    };
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

    async fetchBars(): Promise<Record<Stock, AlpacaBarResponse>> {
        if (MOCK_API_CALLS) {
            return {
                'DDOG': {
                    bars: [
                        { t: '2026-01-02T14:00:00Z', vw: 100, },
                        { t: '2026-01-02T15:00:00Z', vw: 110, },
                        { t: '2026-01-02T16:00:00Z', vw: 130, },
                        { t: '2026-01-02T17:00:00Z', vw: 110, },
                        { t: '2026-01-02T18:00:00Z', vw: 90, },
                    ],
                    next_page_token: null,
                    symbol: 'DDOG'
                },
                'AAPL': {
                    bars: [],
                    next_page_token: null,
                    symbol: 'AAPL'
                }
            }
        }

        // the market is open for 6h30m each weekday, we can fit 80 data point on the screen.
        // we limit to 78 points so that they are each 5 min appart exactly.
        const params = new URLSearchParams({
            timeframe: "5Min",
            feed: 'iex',
        });

        const data: Record<Stock, AlpacaBarResponse> = {} as any;

        for (const symbol of STOCKS) {
            const res = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${params}`, {
                headers: {
                    'APCA-API-KEY-ID': this.#apiKey,
                    'APCA-API-SECRET-KEY': this.#apiSecret,
                },
            });
            if (!res.ok) throw new Error(`request to Alpaca bars failed: ${res.status} ${await res.text()}`);
            data[symbol] = await res.json();
        }

        return data;
    }

    async fetchSnapshot(symbol: Stock): Promise<AlpacaSnapshotResponse> {
        if (MOCK_API_CALLS) {
            return {
                latestTrade: { p: symbol === 'DDOG' ? 132.50 : 187.50, t: new Date().toISOString() },
                prevDailyBar: { c: symbol === 'DDOG' ? 130.00 : 185.00 }
            };
        }

        const res = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/snapshot?feed=iex`, {
            headers: {
                'APCA-API-KEY-ID': this.#apiKey,
                'APCA-API-SECRET-KEY': this.#apiSecret,
            },
        });
        if (!res.ok) throw new Error(`request to Alpaca snapshot failed: ${res.status} ${await res.text()}`);
        return await res.json();
    }

    async refresh(): Promise<void> {
        try {
            const barData = await this.fetchBars();

            for (const [symbol, stock] of (Object.entries(barData) as Array<[Stock, AlpacaBarResponse]>)) {
                // Fetch snapshot to get previous day's close (used for day change calculation)
                const snapshot = await this.fetchSnapshot(symbol);
                const prevClose = snapshot.prevDailyBar.c;

                if (!stock.bars || stock.bars.length === 0) {
                    // No bar data - market is closed, use latest trade
                    const currentPrice = snapshot.latestTrade.p;
                    const dayChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
                    this.stocks[symbol] = {
                        symbol: symbol,
                        open: false,
                        currentPrice: currentPrice,
                        dayChangePercent: dayChange,
                        hourlyHistory: [],
                    };
                    continue;
                }

                // discard data outside of open hours (14h30-21h UTC)
                stock.bars = stock.bars.filter(b => {
                    const t = new Date(b.t);
                    const h = t.getUTCHours();  // Use UTC!
                    const m = t.getUTCMinutes();
                    return (h > 14 || (h === 14 && m >= 30)) && h < 21;
                });

                if (stock.bars.length === 0) {
                    // All bars were outside market hours
                    const currentPrice = snapshot.latestTrade.p;
                    const dayChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
                    this.stocks[symbol] = {
                        symbol: symbol,
                        open: false,
                        currentPrice: currentPrice,
                        dayChangePercent: dayChange,
                        hourlyHistory: [],
                    };
                    continue;
                }

                // Fill gaps in data with linear interpolation
                const FIVE_MIN_MS = 5 * 60 * 1000;
                const interpolated: AlpacaBar[] = [stock.bars[0]];

                for (let i = 1; i < stock.bars.length; i++) {
                    const prev = stock.bars[i - 1];
                    const curr = stock.bars[i];
                    const prevTime = new Date(prev.t).getTime();
                    const currTime = new Date(curr.t).getTime();
                    const gapMs = currTime - prevTime;

                    // Calculate how many 5-min intervals this gap spans
                    const intervals = Math.round(gapMs / FIVE_MIN_MS);

                    // Insert interpolated points for missing intervals
                    for (let step = 1; step < intervals; step++) {
                        const ratio = step / intervals;
                        interpolated.push({
                            t: new Date(prevTime + step * FIVE_MIN_MS).toISOString(),
                            vw: prev.vw + ratio * (curr.vw - prev.vw),
                        });
                    }
                    interpolated.push(curr);
                }
                stock.bars = interpolated;

                const currentPrice = stock.bars.at(-1)!.vw;
                // Calculate day change from previous day's close (like Google/Yahoo Finance)
                const dayChange = prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;

                console.log(`${symbol}: prevClose: ${prevClose}  current: ${currentPrice}  change: ${dayChange.toFixed(2)}%  points: ${stock.bars.length}`);

                this.stocks[symbol] = {
                    symbol: symbol,
                    open: true,
                    currentPrice: currentPrice,
                    dayChangePercent: dayChange,
                    hourlyHistory: stock.bars.map((b) => b.vw),
                };
            }
        } catch (err) {
            logger.error(`Failed to refresh stock data: ${err}`);
        }
    }

    serialize(): Buffer[] {
        const payloads: Buffer[] = [];
        for (const stock of Object.values(this.stocks)) {
            const payload = Buffer.alloc(32);
            // first byte is ignored
            payload.writeUInt8(DATA_TYPE.STOCK_1, 1);
            // stock index
            payload.writeUInt8(STOCKS.indexOf(stock.symbol), 2);
            payload.writeUint8(stock.open ? 1 : 0, 3);
            // price on 3 bytes
            const price = Math.round(stock.currentPrice * 100);
            payload.writeUint16BE(price >> 8, 4);
            payload.writeUint8(price & 0xFF, 6);
            payload.writeInt16BE(Math.round(stock.dayChangePercent * 100), 7);
            payload.writeUInt8(stock.hourlyHistory.length, 9);  // byte 9, not 8!
            // bytes 10-31: we have 22 bytes = 176 bits, can encode 35 5-bit values
            const min = Math.min(...stock.hourlyHistory);
            const max = Math.max(...stock.hourlyHistory);
            const range = max - min || 1;  // avoid division by zero
            let bitPos = 0;
            for (const price of stock.hourlyHistory.slice(0, 35)) {
                let normalized = Math.floor((price - min) / range * 31);  // normalize to 0-31
                for (let i = 0; i < 5; i++, bitPos++) {
                    if (normalized & 1) {
                        const byteIndex = bitPos >> 3;
                        const bitIndex = bitPos & 7;
                        payload[byteIndex + 10] |= 1 << bitIndex;  // start at byte 10
                    }
                    normalized >>= 1;
                }
            }
            payloads.push(payload);

            if (stock.hourlyHistory.length > 35) {
                // encode the rest of the history (values 35-79 = up to 45 values)
                const rest = Buffer.alloc(32);
                rest.writeUInt8(DATA_TYPE.STOCK_2, 1);
                rest.writeUInt8(STOCKS.indexOf(stock.symbol), 2);
                // bytes 3-31: 29 bytes = 232 bits, can encode 46 5-bit values
                bitPos = 0;
                for (const price of stock.hourlyHistory.slice(35, 80)) {
                    let normalized = Math.floor((price - min) / range * 31);  // normalize to 0-31
                    for (let i = 0; i < 5; i++, bitPos++) {
                        if (normalized & 1) {
                            const byteIndex = bitPos >> 3;
                            const bitIndex = bitPos & 7;
                            rest[byteIndex + 3] |= 1 << bitIndex;
                        }
                        normalized >>= 1;
                    }
                }
                payloads.push(rest);
            }
        }

        return payloads;
    }
}
