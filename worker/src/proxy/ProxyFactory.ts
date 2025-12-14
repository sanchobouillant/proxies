import { ProxyManager } from './ProxyManager';
import { LinuxProxyManager } from './LinuxProxyManager';
import { MockProxyManager } from './MockProxyManager';

export function createProxyManager(): ProxyManager {
    const useMocks = process.env.USE_MOCKS === 'true';

    if (useMocks) {
        console.log('[ProxyFactory] Using Mock Proxy Manager');
        return new MockProxyManager();
    } else {
        console.log('[ProxyFactory] Using REAL Linux Proxy Manager (3proxy)');
        return new LinuxProxyManager();
    }
}
