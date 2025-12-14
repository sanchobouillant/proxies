import { setLogCallback } from './logger';
import { io, Socket } from 'socket.io-client';
import { createHardwareManager } from './hardware/HardwareFactory';
import { HardwareManager } from './hardware/HardwareManager';
import { createProxyManager } from './proxy/ProxyFactory';
import { ProxyManager } from './proxy/ProxyManager';
import { SystemMonitor } from './system/SystemMonitor';
import { ConfigManager } from './system/ConfigManager';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';

class WorkerAgent {
    private socket: Socket | null = null;
    private hardware: HardwareManager;
    private proxy: ProxyManager;
    private system: SystemMonitor;
    private configManager: ConfigManager;
    private workerId: string = '';
    private logBuffer: { level: string, msg: string, timestamp: number }[] = [];

    constructor() {
        this.configManager = new ConfigManager();
        this.hardware = createHardwareManager();
        this.proxy = createProxyManager();
        this.system = new SystemMonitor();

        // Setup Logger Callback
        setLogCallback((level, msg, timestamp) => {
            if (this.socket && this.socket.connected) {
                this.socket.emit(WsEvents.Log, { level, msg, timestamp });
            } else {
                this.logBuffer.push({ level, msg, timestamp });
                if (this.logBuffer.length > 1000) this.logBuffer.shift(); // plain buffer limit
            }
        });

        // Define flushLogs arrow function
        this.flushLogs = () => {
            if (this.logBuffer.length > 0 && this.socket && this.socket.connected) {
                console.log(`[Worker] Flushing ${this.logBuffer.length} buffered logs...`);
                this.logBuffer.forEach(log => {
                    this.socket!.emit(WsEvents.Log, log);
                });
                this.logBuffer = [];
            }
        };
    }

    private flushLogs: () => void;

    async start() {
        // Load configuration (Persistent Identity)
        const config = await this.configManager.load();
        this.workerId = config.workerId;

        console.log(`[Worker ${this.workerId}] Starting in PASSIVE mode...`);
        console.log(`[Worker] Manager URL: ${config.managerUrl}`);

        // Initial hardware scan to populate local state, but DO NOT start proxies
        const modems = await this.hardware.scanDevices();
        console.log(`[Worker] Found ${modems.length} modems available.`);

        // Connect to Manager
        this.socket = io(config.managerUrl, {
            autoConnect: false,
            reconnection: true,
            auth: {
                token: config.apiKey
            }
        });

        this.socket.connect();

        this.socket.on('connect', () => {
            console.log(`[Worker] Connected to Manager.`);
            this.flushLogs();
            this.register();
        });

        this.socket.on('connect_error', (err) => {
            console.error(`[Worker] Connection error: ${err.message}`);
        });

        this.socket.on('disconnect', () => {
            console.log('[Worker] Disconnected from Manager');
        });

        this.socket.on(WsEvents.Command, async (payload: CommandPayload) => {
            await this.handleCommand(payload);
        });

        // Start status loop
        setInterval(() => this.sendStatus(), 5000);
    }

    private async register() {
        if (!this.socket) return;

        const health = await this.system.getHealth();
        this.socket.emit(WsEvents.Register, {
            id: this.workerId,
            ip: '127.0.0.1', // Should auto-detect real VPN IP in production
            port: process.env.WORKER_PORT ? parseInt(process.env.WORKER_PORT) : undefined,
            status: 'ONLINE',
            modems: this.hardware.getModems(),
            health,
            lastSeen: new Date()
        } as ProxyWorker);
    }

    private async sendStatus() {
        if (this.socket && this.socket.connected) {
            const health = await this.system.getHealth();
            this.socket.emit(WsEvents.StatusUpdate, {
                id: this.workerId,
                modems: this.hardware.getModems(),
                health
            });
        }
    }

    private async handleCommand(payload: CommandPayload) {
        console.log(`[Worker] Received command: ${payload.command} for modem: ${payload.modemId}`);

        // Special case for commands that might not need an existing proxy running,
        // but START_PROXY typically needs to find the modem interface first.
        const modem = this.hardware.getModems().find(m => m.id === payload.modemId);

        // If modem not found, we can't do much for device-specific commands
        if (!modem) {
            console.warn(`[Worker] Modem interface ${payload.modemId} not found.`);
            return;
        }

        switch (payload.command) {
            case 'START_PROXY':
                if (payload.data && payload.data.proxyPort) {
                    console.log(`[Worker] Starting proxy on ${modem.interfaceName} -> Port ${payload.data.proxyPort}`);
                    modem.proxyPort = payload.data.proxyPort;
                    modem.user = payload.data.user;
                    modem.pass = payload.data.pass;
                    modem.protocol = payload.data.protocol;
                    await this.proxy.startProxy(modem);
                }
                break;

            case 'STOP_PROXY':
                console.log(`[Worker] Stopping proxy on ${modem.interfaceName}`);
                await this.proxy.stopProxy(modem);
                break;

            case 'REBOOT':
                await this.hardware.rebootModem(modem.interfaceName);
                break;
            case 'ROTATE_IP':
                await this.hardware.rotateIp(modem.interfaceName);
                break;
            case 'UNLOCK_SIM':
                if ('unlockSim' in this.hardware) {
                    await (this.hardware as any).unlockSim(modem.interfaceName, payload.data?.pin);
                }
                break;
            case 'UPDATE_AUTH':
                if (payload.data && payload.data.user && payload.data.pass) {
                    modem.user = payload.data.user;
                    modem.pass = payload.data.pass;
                    await this.proxy.restartProxy(modem);
                }
                break;
        }

        this.sendStatus();
    }
}

// Run
const agent = new WorkerAgent();
agent.start().catch(console.error);
