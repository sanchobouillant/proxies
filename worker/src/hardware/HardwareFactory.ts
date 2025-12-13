import { HardwareManager } from './HardwareManager';
import { LinuxHardwareManager } from './LinuxHardwareManager';
import { MockHardwareManager } from './MockHardwareManager';

export function createHardwareManager(): HardwareManager {
    const useMocks = process.env.USE_MOCKS === 'true';

    if (useMocks) {
        console.log('[HardwareFactory] Using Mock Hardware Manager');
        return new MockHardwareManager();
    } else {
        console.log('[HardwareFactory] Using REAL Linux Hardware Manager');
        return new LinuxHardwareManager();
    }
}
