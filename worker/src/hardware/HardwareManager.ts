import { Modem } from '@proxy-farm/shared';

export interface HardwareManager {
    scanDevices(): Promise<Modem[]>;
    rebootModem(interfaceName: string): Promise<boolean>;
    rotateIp(interfaceName: string): Promise<boolean>;
    getModems(): Modem[];
}
