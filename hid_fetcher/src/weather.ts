import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from "./fetcher.ts";

const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY!;
const CITY = 'Paris,fr';



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

export class WeatherData implements Fetcher {
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