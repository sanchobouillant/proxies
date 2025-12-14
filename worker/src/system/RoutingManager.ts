import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class RoutingManager {

    // We reserve tables 100-200 for modems
    // wwan0 -> 100
    // wwan1 -> 101

    async configureRouting(interfaceName: string, ip: string): Promise<boolean> {
        console.log(`[Routing] Configuring PBR for ${interfaceName} (${ip})...`);

        const tableId = this.getTableId(interfaceName);
        if (!tableId) {
            console.error(`[Routing] Could not determine table ID for ${interfaceName}`);
            return false;
        }

        try {
            // 1. Cleanup old rules for this IP/Table to avoid duplicates
            await this.cleanupRouting(interfaceName, ip);

            // 2. Add Route to Table
            // First we need to find the gateway or just add a device route?
            // Usually valid: 'default dev wwan0' if point-to-point
            // Or we need to query 'ip route show dev wwan0' to find the gateway/subnet.

            // For 4G interfaces (Raw IP or QMI), often there is no gateway IP visible or it's P2P.
            // Try adding default route via device.
            await this.execute(`ip route add default dev ${interfaceName} table ${tableId}`);

            // 3. Add Rule
            // from <IP> lookup <TABLE>
            await this.execute(`ip rule add from ${ip} lookup ${tableId}`);

            // 4. Flush cache
            await this.execute('ip route flush cache');

            console.log(`[Routing] PBR configured: src ${ip} -> table ${tableId} -> dev ${interfaceName}`);
            return true;

        } catch (e: any) {
            console.error(`[Routing] Failed to configure routing for ${interfaceName}:`, e.message);
            return false;
        }
    }

    async cleanupRouting(interfaceName: string, ip: string) {
        const tableId = this.getTableId(interfaceName);
        try {
            // Ignore errors if they don't exist
            await this.execute(`ip rule del from ${ip} lookup ${tableId}`).catch(() => { });
            await this.execute(`ip route flush table ${tableId}`).catch(() => { });
        } catch (e) { /* ignore */ }
    }

    private getTableId(interfaceName: string): number | null {
        // wwanX -> 100 + X
        const match = interfaceName.match(/\d+$/);
        if (match) {
            return 100 + parseInt(match[0]);
        }
        return null;
    }

    private async execute(command: string): Promise<void> {
        console.log(`[Routing] EXEC: ${command}`);
        await execAsync(command);
    }
}
