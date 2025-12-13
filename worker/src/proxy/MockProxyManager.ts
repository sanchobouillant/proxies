import { ProxyManager } from './ProxyManager';
import { Modem } from '@proxy-farm/shared';

export class MockProxyManager implements ProxyManager {
    async startProxy(modem: Modem): Promise<boolean> {
        console.log(`[MockProxy] Starting 3proxy for ${modem.interfaceName} on port ${modem.proxyPort}`);
        return true;
    }

    async stopProxy(modem: Modem): Promise<boolean> {
        console.log(`[MockProxy] Stopping 3proxy for ${modem.interfaceName}`);
        return true;
    }

    async restartProxy(modem: Modem): Promise<boolean> {
        console.log(`[MockProxy] Restarting 3proxy for ${modem.interfaceName}`);
        return true;
    }
}
