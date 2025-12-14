import * as fs from 'fs';
import * as path from 'path';

export class PinManager {
    private storagePath: string;
    private pins: Map<string, string> = new Map(); // ICCID -> PIN

    constructor() {
        this.storagePath = path.resolve(process.cwd(), 'sim-pins.json');
        this.load();
    }

    private load() {
        if (fs.existsSync(this.storagePath)) {
            try {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                const json = JSON.parse(data);
                this.pins = new Map(Object.entries(json));
                console.log(`[PinManager] Loaded ${this.pins.size} stored PINs.`);
            } catch (e) {
                console.error('[PinManager] Failed to load pins:', e);
            }
        }
    }

    private save() {
        try {
            const json = Object.fromEntries(this.pins);
            fs.writeFileSync(this.storagePath, JSON.stringify(json, null, 2));
        } catch (e) {
            console.error('[PinManager] Failed to save pins:', e);
        }
    }

    getPin(iccid: string): string | undefined {
        return this.pins.get(iccid);
    }

    savePin(iccid: string, pin: string) {
        this.pins.set(iccid, pin);
        this.save();
    }
}
