import { HardwareManager } from './HardwareManager';
import { Modem, ModemStatus } from '@proxy-farm/shared';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PinManager } from '../system/PinManager';

const execAsync = promisify(exec);

export class QmiHardwareManager implements HardwareManager {
    private modems: Map<string, Modem> = new Map();
    private isScanning = false;
    private watchdogInterval: NodeJS.Timeout | null = null;
    private pinManager: PinManager;
    private DEBUG = process.env.DEBUG_QMI === '1';

    private debug(...args: any[]) {
        if (this.DEBUG) console.log(...args);
    }

    constructor() {
        this.debug('[QmiHardware] Initialized QMI hardware manager with Watchdog protection');
        this.pinManager = new PinManager();
        // Start background polling (will be started after initial scan)
        this.startWatchdog();
    }

    private startWatchdog() {
        this.watchdogInterval = setInterval(() => {
            this.scanDevices().catch(e => console.error('[QmiHardware] Watchdog cycle failed:', e));
        }, 15000); // Check every 15s
    }

    private async executeQmi(command: string, timeoutMs: number = 5000, verbose: boolean = true): Promise<string> {
        const shouldLog = verbose || this.DEBUG;
        if (shouldLog) this.debug(`[QmiHardware] EXEC: ${command}`);
        try {
            // Add timeout implementation to avoid hanging forever
            const promise = execAsync(command);
            const childCheck = new Promise<any>((_, reject) => {
                setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
            });

            // Race between execution and timeout
            const result = await Promise.race([promise, childCheck]) as { stdout: string, stderr: string };
            const { stdout, stderr } = result;

            if (stderr && shouldLog) this.debug(`[QmiHardware] STDERR: ${stderr.trim()}`);
            if (stdout && shouldLog) this.debug(`[QmiHardware] STDOUT: ${stdout.trim().substring(0, 200)}${stdout.length > 200 ? '...' : ''}`);
            return stdout;
        } catch (e: any) {
            console.error(`[QmiHardware] ERROR executing ${command}:`, e.message);
            throw e;
        }
    }

    async scanDevices(): Promise<Modem[]> {
        if (this.isScanning) {
            console.warn('[QmiHardware] Scan already in progress, skipping...');
            return Array.from(this.modems.values());
        }
        this.isScanning = true;

        try {
            // 1. List physical devices
            let devices: string[] = [];
            try {
                const stdout = await this.executeQmi('ls /dev/cdc-wdm*', 2000, false); // mute watchdog noise
                devices = stdout.trim().split('\n').filter(Boolean);
            } catch (e) {
                this.debug('[QmiHardware] No devices found (ls failed)');
            }

            // Mark all current modems as unreachable first (until proven otherwise)
            // We use a temporary set of found IDs to detect removals
            const foundIds = new Set<string>();

            for (const devicePath of devices) {
                try {
                    // Try to identify the modem
                    const info = await this.getModemInfo(devicePath, false); // mute watchdog noise
                    foundIds.add(info.id);

                    // Merge with existing state to preserve user/pass/port
                    const existing = this.modems.get(info.id);
                    if (existing) {
                        this.modems.set(info.id, {
                            ...existing,
                            ...info, // Update signal, status, etc.
                            status: ModemStatus.Online // It responded, so it's online
                        });
                        // Attempt connection if SIM is ready
                        /* 
                        if (info.simStatus === 'READY') {
                            this.ensureConnection(this.modems.get(info.id)!, devicePath).catch(err => console.error(`[Qmi] Connect error ${info.id}:`, err));
                        }
                        */
                    } else {
                    this.debug(`[QmiHardware] New modem detected: ${info.id}`);
                    this.modems.set(info.id, info);

                        /*
                        if (info.simStatus === 'READY') {
                            this.ensureConnection(info, devicePath).catch(err => console.error(`[Qmi] Connect error ${info.id}:`, err));
                        }
                        */
                    }
                } catch (e: any) {
                    console.error(`[QmiHardware] Zombie modem detected at ${devicePath}:`, e.message);

                    // If we knew this path, maybe mark the associated modem as ERROR?
                    // Difficult map back path -> ID if we can't query ID. 
                    // But we can try to infer ID from path digits if standardized.
                    const idStr = devicePath.match(/\d+$/)?.[0];
                    if (idStr) {
                        // Search if we have a modem with this "interface suffix" or similar
                        // Loose matching for now:
                        // Ideally we should persist mapping Path <-> ID
                    }
                }
            }

            // Handle Removed/Offline Modems
            for (const [id, modem] of this.modems) {
                if (!foundIds.has(id)) {
                    this.debug(`[QmiHardware] Modem ${id} is no longer detected! Marking OFFLINE.`);
                    modem.status = ModemStatus.Offline;
                    modem.signalQuality = 0;
                }
            }

        } finally {
            this.isScanning = false;
        }

        return Array.from(this.modems.values());
    }

    async unlockSim(interfaceName: string, pin: string): Promise<boolean> {
        const modem = Array.from(this.modems.values()).find(m => m.interfaceName === interfaceName);
        if (!modem) return false;

        const devicePath = (modem as any).devicePath;
        this.debug(`[QmiHardware] Attempting to unlock SIM for ${modem.id} with PIN...`);

        try {
            // Command: qmicli -d /dev/cdc-wdm0 --uim-verify-pin=PIN1,1234
            await this.executeQmi(`qmicli -d ${devicePath} --uim-verify-pin=PIN1,${pin}`, 5000);
            this.debug(`[QmiHardware] SIM unlocked successfully for ${modem.id}`);

            if (modem.iccid) {
                this.pinManager.savePin(modem.iccid, pin);
            }
            return true;
        } catch (e: any) {
            console.error(`[QmiHardware] Failed to unlock SIM:`, e.message);
            return false;
        }
    }

    private async getModemInfo(devicePath: string, verbose: boolean = true): Promise<Modem> {
        // Fetch ICCID
        let iccid = 'UNKNOWN';
        let signal = 0;
        let simStatus: 'READY' | 'LOCKED' | 'ERROR' = 'READY';

        // 1. Check SIM Status FIRST
        try {
            // qmicli -d /dev/cdc-wdm0 --uim-get-card-status
            const stdoutStatus = await this.executeQmi(`qmicli -d ${devicePath} --uim-get-card-status`, 3000, verbose);
            if (stdoutStatus.includes('PIN1 state: enabled-not-verified')) {
                simStatus = 'LOCKED';
            } else if (stdoutStatus.includes('PIN1 state: enabled-verified') || stdoutStatus.includes('PIN1 state: disabled')) {
                simStatus = 'READY';
            } else {
                // PUK or other error
                // console.warn(`[QmiHardware] Unknown SIM status output: ${stdoutStatus}`);
            }
        } catch (e) {
            console.warn(`[QmiHardware] Failed to get SIM status for ${devicePath}`);
            simStatus = 'ERROR';
        }

        // 2. Get IDs (ICCID might fail if locked, but we try)
        if (simStatus !== 'ERROR') {
            try {
                const stdoutIds = await this.executeQmi(`qmicli -d ${devicePath} --dms-get-ids`, 5000, verbose);
                const matchIccid = stdoutIds.match(/ICCID:\s+'(.+?)'/);
                if (matchIccid) iccid = matchIccid[1];
            } catch (e) {
                // If locked, we might fail reading ICCID on some modems
            }
        }

        // AUTO-UNLOCK Logic
        if (simStatus === 'LOCKED' && iccid !== 'UNKNOWN') {
            const savedPin = this.pinManager.getPin(iccid);
            if (savedPin) {
                this.debug(`[QmiHardware] Found saved PIN for ${iccid}, attempting auto-unlock...`);
                // We execute unlock asynchronously to not block the scan loop too long
                // or we do it here and wait.
                try {
                    await this.executeQmi(`qmicli -d ${devicePath} --uim-verify-pin=PIN1,${savedPin}`, 5000);
                    simStatus = 'READY'; // Assume success if no throw, checking next loop is safer but this updates UI faster
                } catch (e) {
                    console.error('[QmiHardware] Auto-unlock failed with saved PIN.');
                }
            }
        }

        // Fetch Signal only if READY
        if (simStatus === 'READY') {
            try {
                const stdoutSig = await this.executeQmi(`qmicli -d ${devicePath} --nas-get-signal-strength`, 3000, verbose);
                const matchSig = stdoutSig.match(/Network 'lte': '-(\d+) dBm'/);
                if (matchSig) {
                    const dbm = parseInt(matchSig[1]) * -1;
                    signal = Math.max(0, Math.min(100, (dbm + 120) * (100 / 70)));
                }
            } catch (e) { /**/ }
        }

        const idStr = devicePath.match(/\d+$/)?.[0] || '0';
        const interfaceName = `wwan${idStr}`;

        // ID construction
        const id = (iccid !== 'UNKNOWN') ? `modem_${iccid}` : `modem_wdm${idStr}`;

        return {
            id,
            interfaceName: interfaceName,
            devicePath: devicePath,
            iccid,
            signalQuality: Math.round(signal),
            status: simStatus === 'READY' ? ModemStatus.Online : ModemStatus.Connecting,
            simStatus: simStatus
        } as Modem & { devicePath: string };
    }

    async rebootModem(interfaceName: string): Promise<boolean> {
        // Find modem by interface
        // Note: interfaceName might no longer match if mapping changed, 
        // better to look up by ID if passed, but interface string is what we have in signature.

        // Find the modem object that has this interface
        const modem = Array.from(this.modems.values()).find(m => m.interfaceName === interfaceName);
        if (!modem) {
            console.error(`[QmiHardware] Cannot reboot: ${interfaceName} not found in state.`);
            return false;
        }

        const devicePath = (modem as any).devicePath || `/dev/cdc-wdm${interfaceName.replace('wwan', '')}`;

        this.debug(`[QmiHardware] Rebooting ${devicePath}...`);
        modem.status = ModemStatus.Rebooting; // Immediate UI feedback

        try {
            await this.executeQmi(`qmicli -d ${devicePath} --dms-set-operating-mode=offline`, 5000);
            await new Promise(r => setTimeout(r, 2000));
            await this.executeQmi(`qmicli -d ${devicePath} --dms-set-operating-mode=online`, 5000);
            return true;
        } catch (e) {
            console.error(`[QmiHardware] Reboot failed for ${devicePath}`, e);
            modem.status = ModemStatus.Offline; // Assume worst
            return false;
        }
    }

    async rotateIp(interfaceName: string): Promise<boolean> {
        const modem = Array.from(this.modems.values()).find(m => m.interfaceName === interfaceName);
        if (!modem) return false;
        const devicePath = (modem as any).devicePath;

        this.debug(`[QmiHardware] Rotating IP via QMI for ${devicePath}...`);
        modem.status = ModemStatus.Connecting;

        try {
            await this.executeQmi(`qmicli -d ${devicePath} --dms-set-operating-mode=low-power`, 5000);
            await new Promise(r => setTimeout(r, 1000));
            await this.executeQmi(`qmicli -d ${devicePath} --dms-set-operating-mode=online`, 5000);

            // Wait for reconnect logic is handled by Watchdog eventually
            // But we pause here to return success closer to reality
            await new Promise(r => setTimeout(r, 2000));
            return true;
        } catch (e) {
            console.error(`[QmiHardware] Rotate failed for ${devicePath}`, e);
            return false;
        }
    }

    getModems(): Modem[] {
        return Array.from(this.modems.values());
    }

    async connectModem(modem: Modem, config?: { apn?: string, user?: string, pass?: string, pin?: string }): Promise<boolean> {
        const devicePath = (modem as any).devicePath;
        const apn = config?.apn || 'free'; // Default fallback or error?

        // Check SIM status before connecting
        const info = await this.getModemInfo(devicePath);

        if (info.simStatus === 'LOCKED') {
            console.log(`[QmiHardware] connecting modem ${modem.id}, but SIM is locked.`); // We expect UNLOCK command first or Auto-unlock
            return false;
        }

        // Only try connecting if status is "Online" (SIM ready) but maybe not "Connected" data-wise
        // We need to check WDS status
        try {
            const status = await this.executeQmi(`qmicli -d ${devicePath} --wds-get-packet-service-status`, 2000);
            if (status.includes('Connection status: \'connected\'')) {
                // Already connected. Ensure we have IP on the interface?
                // But fast check implies good.
            this.debug(`[QmiHardware] Modem ${modem.id} is already connected (WDS status confirms).`);
            return true;
        }

        this.debug(`[QmiHardware] Modem ${modem.id} is ONLINE but Disconnected. Attempting data connection (APN: ${apn})...`);

            // 1. Find Network Interface
            let interfaceName = await this.getWwanInterface(devicePath);
            if (!interfaceName) {
                console.error(`[QmiHardware] Could not determine network interface for ${devicePath}. Aborting connection.`);
                return false;
            }
            console.log(`[QmiHardware] Found network interface: ${interfaceName}`);

            // 2. Bring Interface UP
            await execAsync(`ip link set ${interfaceName} up`);

            // 3. Start Network (QMI)
            let cmd = `qmicli -d ${devicePath} --wds-start-network="apn='${apn}',ip-type=4" --client-no-release-cid`;
            if (config?.user) cmd += ` --auth-user '${config.user}'`;
            if (config?.pass) cmd += ` --auth-password '${config.pass}'`;

            await this.executeQmi(cmd, 15000);

            // 4. DHCP
            console.log(`[QmiHardware] Network started. Requesting IP via DHCP for ${interfaceName}...`);
            try {
                await execAsync(`udhcpc -q -n -i ${interfaceName}`);
            } catch (e) {
                try {
                    await execAsync(`dhclient ${interfaceName}`);
                } catch (e: any) {
                    const isNotFound = e.message.includes('not found') || e.code === 127;
                    if (isNotFound) {
                        console.warn(`[QmiHardware] DHCP clients (udhcpc, dhclient) not found. Assuming interface configured externally or not needed.`);
                    } else {
                        console.error(`[QmiHardware] DHCP request failed: ${e.message}`);
                    }
                }
            }

            console.log(`[QmiHardware] Data connection established for ${modem.id} on ${interfaceName}`);

            if (interfaceName && interfaceName !== modem.interfaceName) {
                console.log(`[QmiHardware] Updating interface name for ${modem.id}: ${modem.interfaceName} -> ${interfaceName}`);
                modem.interfaceName = interfaceName;
                (modem as any).interfaceName = interfaceName;
            }

            return true;

        } catch (e: any) {
            console.error(`[QmiHardware] Failed to connect ${modem.id}: ${e.message}`);
            return false;
        }
    }

    private async getWwanInterface(devicePath: string): Promise<string | null> {
        try {
            // Standard QMI query
            const stdout = await this.executeQmi(`qmicli -d ${devicePath} --get-wwan-iface`, 2000);
            return stdout.trim();
        } catch (e) {
            // Fallback? 
            // In some environments, we might need to look at sysfs.
            // But let's trust QMI first.
            return null;
        }
    }
}
