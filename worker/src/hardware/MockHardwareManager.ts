import { HardwareManager } from './HardwareManager';
import { Modem, ModemStatus } from '@proxy-farm/shared';

export class MockHardwareManager implements HardwareManager {
    private modems: Modem[] = [];

    constructor() {
        this.initializeMockModems();
    }

    private initializeMockModems() {
        this.modems = [
            {
                id: 'modem-mock-1',
                interfaceName: 'wwan0',
                ipAddress: '10.0.0.1',
                status: ModemStatus.Online,
                iccid: '8933010000000000001',
                imei: '350000000000001',
                operator: 'MockOperator'
            },
            {
                id: 'modem-mock-2',
                interfaceName: 'wwan1',
                ipAddress: '10.0.0.2',
                status: ModemStatus.Online,
                iccid: '8933010000000000002',
                imei: '350000000000002',
                operator: 'MockOperator 2'
            }
        ];
    }

    async scanDevices(): Promise<Modem[]> {
        // In a real scenario, this would scan USB/sysfs
        // For mock, we just return our state
        return this.modems;
    }

    async rebootModem(interfaceName: string): Promise<boolean> {
        console.log(`[MockHardware] Rebooting modem on ${interfaceName}...`);
        const modem = this.modems.find(m => m.interfaceName === interfaceName);
        if (!modem) return false;

        modem.status = ModemStatus.Rebooting;
        setTimeout(() => {
            modem.status = ModemStatus.Online;
            console.log(`[MockHardware] Modem ${interfaceName} back ONLINE.`);
        }, 5000);

        return true;
    }

    async rotateIp(interfaceName: string): Promise<boolean> {
        console.log(`[MockHardware] Rotating IP for ${interfaceName} (Airplane Mode)...`);
        const modem = this.modems.find(m => m.interfaceName === interfaceName);
        if (!modem) return false;

        modem.status = ModemStatus.Connecting;
        setTimeout(() => {
            modem.status = ModemStatus.Online;
            // Mock IP change
            const lastOctet = Math.floor(Math.random() * 255);
            modem.ipAddress = `10.0.0.${lastOctet}`;
            console.log(`[MockHardware] Modem ${interfaceName} new IP: ${modem.ipAddress}`);
        }, 3000);

        return true;
    }

    getModems(): Modem[] {
        return this.modems;
    }
}
