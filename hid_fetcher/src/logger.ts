import { createLogger, format, transports } from 'winston';

const { timestamp, printf } = format;
const logFormat = printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

export const logger = createLogger({
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
