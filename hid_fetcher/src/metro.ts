import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from "./fetcher.ts";

const METRO_LINES = {
    // '6': 'line:IDFM:C01376',
    // '8': 'line:IDFM:C01378',
    '9': 'line:IDFM:C01379'
} as const;


export class MetroData implements Fetcher {
    private lines: Record<keyof typeof METRO_LINES, {
        name: string;
        incident: false;
    } | {
        name: string;
        incident: true;
        message: string;
    }> = {} as any;

    #apiKey: string;

    constructor(apiKey: string) {
        this.#apiKey = apiKey;
    }

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
                    'apikey': this.#apiKey,
                },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch metro data: ${response.statusText}`);
            }

            resp[line] = await response.json();
        }

        return resp;
    }

    findMessage(data: any): string {
        // only select relevant info, and remove accents
        const message = data.disruptions[0].messages.find((m: any) => m.channel.name == "titre").text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
        if (message.includes(' : '))
            return message.split(' : ')[1]
        return message;
    }

    async refresh(): Promise<void> {
        const data = await this.makeCall();
        let line: keyof typeof METRO_LINES;
        for (line in METRO_LINES) {
            if (line in data && 'disruptions' in data[line] && data[line].disruptions.length > 0) {
                this.lines[line] = {
                    name: line,
                    incident: true,
                    message: this.findMessage(data[line]),
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
            payload.writeUint8(DATA_TYPE.METRO, 1);
            payload.write(incidents.name, 2, 1, 'utf-8');
            payload.write(incidents.message, 3, 29, 'utf-8');
            payloads.push(payload);

            if (incidents.message.length > 29) {
                const message = Buffer.alloc(32);
                message.writeUint8(DATA_TYPE.METRO_MESSAGE_1, 1);
                message.write(incidents.name, 2, 1, 'utf-8');
                message.write(incidents.message.slice(29), 3, 29, 'utf-8');
                payloads.push(message);
            }

            if (incidents.message.length > 29 * 2) {
                const message = Buffer.alloc(32);
                message.writeUint8(DATA_TYPE.METRO_MESSAGE_2, 1);
                message.write(incidents.name, 2, 1, 'utf-8');
                message.write(incidents.message.slice(29 * 2), 3, 29, 'utf-8');
                payloads.push(message);
            }
        }

        return payloads;
    }
}