export const DATA_TYPE = {
    STOCK: 1,
    METRO: 2,
    METRO_MESSAGE_1: 3,
    METRO_MESSAGE_2: 4,
    WEATHER: 5,
};

export const MOCK_API_CALLS = true;

export interface Fetcher {
    refresh(): Promise<void>;
    serialize(): Buffer[];
}