import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SystemHealth } from '@proxy-farm/shared';

const execAsync = promisify(exec);

export class SystemMonitor {
    private lastUndervoltageCheck: number = 0;
    private undervoltageCached: boolean = false;

    async getHealth(): Promise<SystemHealth> {
        const health: SystemHealth = {
            memoryUsage: this.getMemoryUsage(),
            cpuLoad: this.getCpuLoad(),
            uptime: os.uptime(),
            undervoltageDetected: await this.checkUndervoltage(),
            recentLogs: [], // Could be populated via dmesg or syslog tail
            cpuTemp: await this.getCpuTemp(),
        };

        return health;
    }

    private getMemoryUsage(): number {
        const total = os.totalmem();
        const free = os.freemem();
        return Math.round(((total - free) / total) * 100);
    }

    private getCpuLoad(): number {
        const cpus = os.cpus().length || 1;
        const load = os.loadavg()[0]; // 1 minute load average
        return Math.round((load / cpus) * 100);
    }

    private async getCpuTemp(): Promise<number | undefined> {
        try {
            // Common path for thermal zone on Linux
            const { stdout } = await execAsync('cat /sys/class/thermal/thermal_zone0/temp');
            const temp = parseInt(stdout.trim());
            // Value is usually in millidegrees
            return temp > 1000 ? temp / 1000 : temp;
        } catch (e) {
            // Fallback for macOS or other systems
            return undefined;
        }
    }

    private async checkUndervoltage(): Promise<boolean> {
        // Debounce checks to avoid spamming dmesg
        const now = Date.now();
        if (now - this.lastUndervoltageCheck < 60000) {
            return this.undervoltageCached;
        }

        this.lastUndervoltageCheck = now;
        try {
            // Raspberry Pi specific mostly, but standard kernel logs might have it
            const { stdout } = await execAsync('dmesg | grep -i "Under-voltage detected" | tail -n 1');
            this.undervoltageCached = !!stdout.trim();
        } catch (e) {
            this.undervoltageCached = false;
        }
        return this.undervoltageCached;
    }
}
