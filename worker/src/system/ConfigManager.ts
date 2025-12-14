import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface WorkerConfig {
    // Single shared secret used to authenticate & derive session keys with the manager
    sharedKey: string;
}

export class ConfigManager {
    private configPath: string;
    private config: WorkerConfig | null = null;

    constructor() {
        this.configPath = path.resolve(process.cwd(), 'config.json');
    }

    async load(): Promise<WorkerConfig> {
        if (this.config) return this.config;

        try {
            const data = await fs.readFile(this.configPath, 'utf-8');
            const parsed = JSON.parse(data);

            // Backward compatibility: migrate legacy shape { workerId, apiKey, managerUrl }
            if (parsed.apiKey && !parsed.sharedKey) {
                this.config = { sharedKey: parsed.apiKey };
                await this.save();
                console.log('[Config] Migrated legacy config to key-only format.');
            } else {
                this.config = parsed as WorkerConfig;
            }

            if (this.config.sharedKey) {
                console.log('[Config] Loaded shared key from config.json');
            } else {
                console.warn('[Config] Config loaded but no sharedKey found. Worker will wait for pairing.');
            }
        } catch (error) {
            console.log('[Config] No existing config found. Creating empty config (awaiting pairing)...');
            this.config = await this.generateEmpty();
            await this.save();
        }

        return this.config!;
    }

    private async generateEmpty(): Promise<WorkerConfig> {
        return {
            sharedKey: ''
        };
    }

    private async save() {
        if (!this.config) return;
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
        console.log(`[Config] Saved shared key to ${this.configPath}`);
    }

    get(): WorkerConfig {
        if (!this.config) throw new Error('Config not loaded');
        return this.config;
    }

    async setSharedKey(sharedKey: string) {
        this.config = { sharedKey };
        await this.save();
    }
}
