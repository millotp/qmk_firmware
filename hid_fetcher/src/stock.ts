import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from './fetcher.ts';
import { logger } from './logger.ts';

const STOCKS = ['DDOG', 'AAPL'] as const;
type Stock = typeof STOCKS[number];

type AlpacaBarResponse = {
    bars: Array<{
        t: string;
        vw: number;
        c: number; // close price
    }> | null,
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

    // Check if US stock market is currently open (simplified check)
    private isMarketOpen(): boolean {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const utcDay = now.getUTCDay();

        // Market is closed on weekends
        if (utcDay === 0 || utcDay === 6) return false;

        // NYSE hours: 9:30 AM - 4:00 PM ET = 14:30 - 21:00 UTC (winter) or 13:30 - 20:00 UTC (summer)
        // Using approximate window: 13:30 - 21:00 UTC
        const utcMinutes = now.getUTCMinutes();
        const totalMinutes = utcHour * 60 + utcMinutes;

        return totalMinutes >= 13 * 60 + 30 && totalMinutes < 21 * 60;
    }

    // Get start date for bar data (today if market open, last trading day if closed)
    private getStartDate(): string {
        const now = new Date();

        if (this.isMarketOpen()) {
            return now.toISOString().split('T')[0];
        }

        // Go back to find last trading day
        let daysBack = 1;
        const day = now.getUTCDay();

        if (day === 0) daysBack = 2; // Sunday -> Friday
        else if (day === 6) daysBack = 1; // Saturday -> Friday

        const lastTradeDay = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
        return lastTradeDay.toISOString().split('T')[0];
    }

    async fetchBars(): Promise<Record<Stock, AlpacaBarResponse>> {
        if (MOCK_API_CALLS) {
            const mockOpen = this.isMarketOpen();
            return {
                'DDOG': {
                    bars: mockOpen ? [
                        { t: '2026-01-02T14:00:00Z', vw: 136.681662, c: 136.50 },
                        { t: '2026-01-02T15:00:00Z', vw: 133.681842, c: 133.50 },
                        { t: '2026-01-02T16:00:00Z', vw: 133.15958, c: 133.00 },
                        { t: '2026-01-02T17:00:00Z', vw: 133.424684, c: 133.30 },
                        { t: '2026-01-02T18:00:00Z', vw: 132.563116, c: 132.50 },
                    ] : null,
                    next_page_token: null,
                    symbol: 'DDOG'
                },
                'AAPL': {
                    bars: mockOpen ? [
                        { t: '2026-01-02T14:00:00Z', vw: 186.681662, c: 186.50 },
                        { t: '2026-01-02T15:00:00Z', vw: 185.681842, c: 185.50 },
                        { t: '2026-01-02T16:00:00Z', vw: 185.15958, c: 185.00 },
                        { t: '2026-01-02T17:00:00Z', vw: 186.424684, c: 186.30 },
                        { t: '2026-01-02T18:00:00Z', vw: 187.563116, c: 187.50 },
                    ] : null,
                    next_page_token: null,
                    symbol: 'AAPL'
                }
            }
        }

        const params = new URLSearchParams({
            timeframe: "1Hour",
            start: this.getStartDate(),
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
            const marketOpen = this.isMarketOpen();
            const barData = await this.fetchBars();

            for (const [symbol, stock] of (Object.entries(barData) as Array<[Stock, AlpacaBarResponse]>)) {
                if (!stock.bars || stock.bars.length === 0) {
                    // No bar data - fetch latest trade for last known price
                    try {
                        const latestTrade = await this.fetchLatestTrade(symbol);
                        this.stocks[symbol] = {
                            symbol: symbol,
                            open: false,
                            currentPrice: latestTrade.trade.p,
                            dayChangePercent: 0,
                            hourlyHistory: [],
                        };
                    } catch {
                        // Keep previous data if we can't fetch latest
                        if (!this.stocks[symbol]) {
                            this.stocks[symbol] = {
                                symbol: symbol,
                                open: false,
                                currentPrice: 0,
                                dayChangePercent: 0,
                                hourlyHistory: [],
                            };
                        }
                    }
                    continue;
                }

                const openPrice = stock.bars[0].vw;
                const currentPrice = stock.bars.at(-1)!.vw;
                const dayChange = ((currentPrice - openPrice) / openPrice) * 10000; // basis points * 100

                this.stocks[symbol] = {
                    symbol: symbol,
                    open: marketOpen,
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
