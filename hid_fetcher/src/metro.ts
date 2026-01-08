import { type Fetcher, DATA_TYPE, MOCK_API_CALLS } from "./fetcher.ts";
import { logger } from "./logger.ts";

const METRO_LINES = {
    '6': 'line:IDFM:C01376',
    '8': 'line:IDFM:C01378',
    '9': 'line:IDFM:C01379'
} as const;

// Abbreviate station names to fit 16-char vertical OLED display
function abbreviateStation(name: string): string {
    // Remove common prefixes and normalize
    const normalized = name
        .normalize("NFD").replace(/\p{Diacritic}/gu, "") // remove accents
        .replace(/^(Porte de |Mairie de |Place |Gare de )/i, '')
        .toUpperCase();
    return normalized.slice(0, 16);
}

export class MetroData implements Fetcher {
    private lines: Record<keyof typeof METRO_LINES, {
        line: string;
        incident: false;
    } | {
        line: string;
        incident: true;
        message: string;
        stations: string[];
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
                            ],
                            impacted_objects: [
                                {
                                    pt_object: {
                                        stop_point: { name: "Mairie de Montreuil" }
                                    }
                                },
                                {
                                    impacted_section: {
                                        from: { stop_area: { name: "Porte de Montreuil" } },
                                        to: { stop_area: { name: "Robespierre" } }
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

    findStations(data: any): string[] {
        const stations = new Set<string>();

        for (const disruption of data.disruptions) {
            for (const impacted of disruption.impacted_objects || []) {
                // Direct stop point
                if (impacted.pt_object?.stop_point?.name) {
                    stations.add(abbreviateStation(impacted.pt_object.stop_point.name));
                }
                // Impacted section (from/to)
                if (impacted.impacted_section?.from?.stop_area?.name) {
                    stations.add(abbreviateStation(impacted.impacted_section.from.stop_area.name));
                }
                if (impacted.impacted_section?.to?.stop_area?.name) {
                    stations.add(abbreviateStation(impacted.impacted_section.to.stop_area.name));
                }
            }
        }

        return Array.from(stations).slice(0, 5);
    }

    async refresh(): Promise<void> {
        try {
            const data = await this.makeCall();
            let line: keyof typeof METRO_LINES;
            for (line in METRO_LINES) {
                if (line in data && 'disruptions' in data[line] && data[line].disruptions.length > 0) {
                    this.lines[line] = {
                        line: line,
                        incident: true,
                        message: this.findMessage(data[line]),
                        stations: this.findStations(data[line]),
                    }
                } else {
                    this.lines[line] = {
                        line: line,
                        incident: false
                    };
                }
            }
        } catch (err) {
            logger.error(`Failed to refresh metro data: ${err}`);
        }
    }

    serialize(): Buffer[] {
        const payloads: Buffer[] = [];
        for (const incidents of Object.values(this.lines).filter(l => l.incident)) {
            const payload = Buffer.alloc(32);
            payload.writeUint8(DATA_TYPE.METRO, 1);
            payload.write(incidents.line, 2, 1, 'utf-8');
            payload.write(incidents.message, 3, 29, 'utf-8');
            payloads.push(payload);

            for (let offset = 29; offset < incidents.message.length; offset += 28) {
                const message = Buffer.alloc(32);
                message.writeUint8(DATA_TYPE.METRO_MESSAGE, 1);
                message.write(incidents.line, 2, 1, 'utf-8');
                message.writeUint8(offset, 3);
                message.write(incidents.message.slice(offset, offset + 28), 4, 28, 'utf-8');
                payloads.push(message);
            }

            // Send station list packets (one station per packet with 16 chars each)
            // Format: [type, line, station_index, total_count, station_name(16)]
            for (let i = 0; i < incidents.stations.length; i++) {
                const stationPayload = Buffer.alloc(32);
                stationPayload.writeUint8(DATA_TYPE.METRO_STATION, 1);
                stationPayload.write(incidents.line, 2, 1, 'utf-8');
                stationPayload.writeUint8(i, 3);  // station index
                stationPayload.writeUint8(incidents.stations.length, 4);  // total count
                stationPayload.write(incidents.stations[i], 5, 'utf-8');
                payloads.push(stationPayload);
            }
        }

        return payloads;
    }
}
