export const DATA_TYPE = {
    STOCK_1: 1,
    STOCK_2: 2,
    METRO: 3,
    METRO_MESSAGE_1: 4,
    METRO_MESSAGE_2: 5,
    WEATHER: 6,
};

export const MOCK_API_CALLS = false;

export interface Fetcher {
    refresh(): Promise<void>;
    serialize(): Buffer[];
}
