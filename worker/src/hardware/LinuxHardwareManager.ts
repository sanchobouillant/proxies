import { HardwareManager } from './HardwareManager';
import { Modem, ModemStatus } from '@proxy-farm/shared';
import { SerialPort } from 'serialport';

export class LinuxHardwareManager implements HardwareManager {
    private modems: Map<string, Modem> = new Map();

    constructor() {
        console.log('[LinuxHardware] Initialized real hardware manager');
    }

    async scanDevices(): Promise<Modem[]> {
        const ports = await SerialPort.list();
        const foundModems: Modem[] = [];

        for (const port of ports) {
            // Filter only likely modem ports (e.g., ttyUSB*)
            // This is a naive heuristic and might need refinement
            if (port.path.includes('ttyUSB') || port.path.includes('ttyACM')) {
                // In a real usage, we would open the port and query ATI or AT+CIMI
                // to get the real ICCID. For now, we list them.

                // We assume 1 modem = 1 set of ports, but usually a modem exposes multiple ports (2 or 3).
                // We'd need logic to group them.
                // For this MVP, we consider every port a potential modem interface

                foundModems.push({
                    id: `modem_${port.path.split('/').pop()}`,
                    interfaceName: port.path, // e.g /dev/ttyUSB0
                    status: ModemStatus.Online, // Assumed online if detected
                    // dynamic fields would be populated by querying the modem
                });
            }
        }
        return foundModems;
    }

    async rebootModem(interfaceName: string): Promise<boolean> {
        return this.sendAtCommand(interfaceName, 'AT+CFUN=1,1');
    }

    async rotateIp(interfaceName: string): Promise<boolean> {
        console.log(`[LinuxHardware] Rotating IP for ${interfaceName}...`);

        try {
            // 1. Airplane Mode ON
            await this.sendAtCommand(interfaceName, 'AT+CFUN=4');
            // Wait a bit
            await new Promise(r => setTimeout(r, 1000));
            // 2. Airplane Mode OFF (Reconnect)
            await this.sendAtCommand(interfaceName, 'AT+CFUN=1');
            return true;
        } catch (error) {
            console.error(`[LinuxHardware] Rotation failed for ${interfaceName}`, error);
            return false;
        }
    }

    getModems(): Modem[] {
        // This should return the cached state
        // For now, we might need to re-scan or keep a cache updated by a polling loop
        return Array.from(this.modems.values());
    }

    private async sendAtCommand(path: string, command: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const port = new SerialPort({ path, baudRate: 115200 }, (err: Error | null) => {
                if (err) {
                    console.error(`[LinuxHardware] Error opening ${path}:`, err);
                    resolve(false);
                    return;
                }
            });

            port.write(command + '\r\n', (err: Error | null | undefined) => {
                if (err) {
                    console.error(`[LinuxHardware] Error writing to ${path}:`, err);
                    port.close();
                    resolve(false);
                    return;
                }

                // In a real robust impl, we would wait for 'OK' response
                // For MVP, we fire and forget, just closing after a short delay
                // preventing immediate close which might cut off the transmission
                setTimeout(() => {
                    port.close();
                    resolve(true);
                }, 500);
            });
        });
    }
}
