import { Modem } from '@proxy-farm/shared';

export interface ProxyManager {
    startProxy(modem: Modem): Promise<boolean>;
    stopProxy(modem: Modem): Promise<boolean>;
    restartProxy(modem: Modem): Promise<boolean>;
}
