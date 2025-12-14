import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface WorkerConfig {
    workerId: string;
    apiKey: string;
    managerUrl: string;
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
            this.config = JSON.parse(data);
            console.log(`[Config] Loaded existing config for ${this.config?.workerId}`);
        } catch (error) {
            console.log('[Config] No existing config found. Generating new identity...');
            this.config = await this.generate();
            await this.save();
        }

        return this.config!;
    }

    private async generate(): Promise<WorkerConfig> {
        return {
            workerId: `worker_${crypto.randomBytes(4).toString('hex')}`,
            apiKey: crypto.randomBytes(32).toString('hex'),
            managerUrl: process.env.MANAGER_URL || 'http://localhost:3000'
        };
    }

    private async save() {
        if (!this.config) return;
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
        console.log(`[Config] Saved identity to ${this.configPath}`);
        console.log(`[Config] >>> API KEY: ${this.config.apiKey} <<<`);
        console.log(`[Config] (You will need this key to add the worker in the UI)`);
    }

    get(): WorkerConfig {
        if (!this.config) throw new Error('Config not loaded');
        return this.config;
    }
}
