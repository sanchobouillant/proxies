import { HardwareManager } from './HardwareManager';
import { QmiHardwareManager } from './QmiHardwareManager';
import { MockHardwareManager } from './MockHardwareManager';

export function createHardwareManager(): HardwareManager {
    const useMocks = process.env.USE_MOCKS === 'true';

    if (useMocks) {
        console.log('[HardwareFactory] Using Mock Hardware Manager');
        return new MockHardwareManager();
    } else {
        console.log('[HardwareFactory] Using REAL QMI Hardware Manager');
        return new QmiHardwareManager();
    }
}
