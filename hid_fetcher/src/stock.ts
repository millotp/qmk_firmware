import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from './fetcher.ts';
import { logger } from './logger.ts';

const STOCKS = ['DDOG', 'AAPL'] as const;
type Stock = typeof STOCKS[number];

type AlpacaBar = {
    t: string;
    vw: number;
    o: number,
    c: number; // close price
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
                        { t: '2026-01-02T14:00:00Z', o: 95, vw: 100, c: 100 },
                        { t: '2026-01-02T15:00:00Z', o: 100, vw: 110, c: 110 },
                        { t: '2026-01-02T16:00:00Z', o: 110, vw: 130, c: 130 },
                        { t: '2026-01-02T17:00:00Z', o: 130, vw: 110, c: 110 },
                        { t: '2026-01-02T18:00:00Z', o: 110, vw: 90, c: 90 },
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

    async fetchLatestTrade(symbol: Stock): Promise<AlpacaLatestTradeResponse> {
        if (MOCK_API_CALLS) {
            return {
                trade: { p: symbol === 'DDOG' ? 132.50 : 187.50, t: new Date().toISOString() },
                symbol
            };
        }

        const res = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest?feed=iex`, {
            headers: {
                'APCA-API-KEY-ID': this.#apiKey,
                'APCA-API-SECRET-KEY': this.#apiSecret,
            },
        });
        if (!res.ok) throw new Error(`request to Alpaca latest trade failed: ${res.status} ${await res.text()}`);
        return await res.json();
    }

    async refresh(): Promise<void> {
        try {
            const barData = await this.fetchBars();

            for (const [symbol, stock] of (Object.entries(barData) as Array<[Stock, AlpacaBarResponse]>)) {
                if (!stock.bars || stock.bars.length === 0) {
                    // No bar data - fetch latest trade for last known price
                    const latestTrade = await this.fetchLatestTrade(symbol);
                    this.stocks[symbol] = {
                        symbol: symbol,
                        open: false,
                        currentPrice: latestTrade.trade.p,
                        dayChangePercent: 0,
                        hourlyHistory: [],
                    };

                    continue;
                }

                // discard data outside of open hours (14h30-21h UTC)
                stock.bars = stock.bars.filter(b => {
                    const t = new Date(b.t);
                    const h = t.getHours();
                    const m = t.getMinutes();
                    return (h > 14 || (h === 14 && m >= 30)) && h <= 21;
                });

                // sometime there are hole in the data, we can fill it with a linear interpolation.
                const inter = [stock.bars[0]];
                for (let i = 1; i < stock.bars.length; i++) {
                    const previousTime = new Date(stock.bars[i - 1].t).getTime();
                    let time = new Date(stock.bars[i].t).getTime();
                    const diff = time - previousTime;
                    let filled = 1;
                    while (time - previousTime > 6 * 60 * 1000) {
                        // we have a gap to fill
                        const t = 5 * 60 * 1000 * filled / diff;
                        inter.push({
                            t: new Date(previousTime + 5 * 60 * 1000 * filled).toISOString(),
                            vw: t * stock.bars[i].vw + (1 - t) * stock.bars[i - 1].vw,
                            o: stock.bars[i - 1].o,
                            c: stock.bars[i - 1].c,
                        })
                        time -= 5 * 60 * 1000;
                        filled++;
                    }
                    inter.push(stock.bars[i]);
                }
                stock.bars = inter;

                const openPrice = stock.bars[0].o;
                const currentPrice = stock.bars.at(-1)!.vw;
                const dayChange = ((currentPrice - openPrice) / openPrice) * 100;

                // console.log(stock.bars.map(b => ({ t: b.t, p: b.vw })));
                console.log(`opening: ${openPrice}    current: ${currentPrice}   change: ${dayChange}  points: ${stock.bars.length}`);

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
            payload.writeUInt8(stock.hourlyHistory.length, 8);
            // we have 22 bytes remaining, we encode each hour as 5 bits, so we can encode the first 35 history points
            const min = Math.min(...stock.hourlyHistory);
            const max = Math.max(...stock.hourlyHistory);
            let bitPos = 0;
            for (const price of stock.hourlyHistory.slice(0, 35)) {
                let normalized = Math.floor((price - min) / (max - min) * 32); // normalize between 0-31
                for (let i = 0; i < 5; i++, bitPos++) {
                    if (normalized & 1) {
                        const byteIndex = bitPos >> 3;
                        const bitIndex = bitPos & 7;
                        payload[byteIndex + 9] |= 1 << bitIndex;
                    }
                    normalized >>= 1;
                }
            }
            payloads.push(payload);

            if (stock.hourlyHistory.length >= 35) {
                // encode the rest of the history
                const rest = Buffer.alloc(32);
                rest.writeUInt8(DATA_TYPE.STOCK_2, 1);
                rest.writeUInt8(STOCKS.indexOf(stock.symbol), 2);
                bitPos = 0;
                for (const price of stock.hourlyHistory.slice(35, 79)) {
                    let normalized = Math.floor((price - min) / (max - min) * 32); // normalize between 0-31
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
