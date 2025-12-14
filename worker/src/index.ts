import { setLogCallback } from './logger';
import { Server, Socket } from 'socket.io'; // Server side
import { createHardwareManager } from './hardware/HardwareFactory';
import { HardwareManager } from './hardware/HardwareManager';
import { createProxyManager } from './proxy/ProxyFactory';
import { ProxyManager } from './proxy/ProxyManager';
import { SystemMonitor } from './system/SystemMonitor';
import { ConfigManager } from './system/ConfigManager';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';

class WorkerAgent {
    private io: Server | null = null;
    private managerSocket: Socket | null = null;
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
            if (this.managerSocket && this.managerSocket.connected) {
                this.managerSocket.emit(WsEvents.Log, { level, msg, timestamp });
            } else {
                this.logBuffer.push({ level, msg, timestamp });
                if (this.logBuffer.length > 1000) this.logBuffer.shift();
            }
        });
    }

    private flushLogs() {
        if (this.logBuffer.length > 0 && this.managerSocket && this.managerSocket.connected) {
            console.log(`[Worker] Flushing ${this.logBuffer.length} buffered logs...`);
            this.logBuffer.forEach(log => {
                this.managerSocket!.emit(WsEvents.Log, log);
            });
            this.logBuffer = [];
        }
    }

    async start() {
        // Load configuration
        const config = await this.configManager.load();
        this.workerId = config.workerId;

        // Port configuration
        const port = process.env.WORKER_PORT ? parseInt(process.env.WORKER_PORT) : 3001;

        console.log(`[Worker ${this.workerId}] Starting in LISTENING mode on port ${port}...`);

        // Initial hardware scan
        const modems = await this.hardware.scanDevices();
        console.log(`[Worker] Found ${modems.length} modems available.`);

        // Start Socket.IO Server
        this.io = new Server(port, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        // Authentication Middleware
        this.io.use((socket, next) => {
            const token = socket.handshake.auth.token;
            // We use the apiKey as the shared secret the Manager must provide
            if (token === config.apiKey) {
                return next();
            }
            console.warn(`[Worker] Validating connection failed. Wrong token.`);
            return next(new Error("Authentication error"));
        });

        this.io.on('connection', (socket) => {
            console.log(`[Worker] Manager connected (ID: ${socket.id})`);
            this.managerSocket = socket;

            this.flushLogs();
            this.register();

            socket.on('disconnect', () => {
                console.log('[Worker] Manager disconnected');
                this.managerSocket = null;
            });

            socket.on(WsEvents.Command, async (payload: CommandPayload) => {
                await this.handleCommand(payload);
            });
        });

        // Start status loop
        setInterval(() => this.sendStatus(), 5000);
    }

    private async register() {
        if (!this.managerSocket) return;

        const health = await this.system.getHealth();
        // Respond to manager with our identity
        this.managerSocket.emit(WsEvents.Register, {
            id: this.workerId,
            ip: '0.0.0.0', // Not relevant, Manager knows our IP
            port: process.env.WORKER_PORT ? parseInt(process.env.WORKER_PORT) : 3001,
            status: 'ONLINE',
            modems: this.hardware.getModems(),
            health,
            lastSeen: new Date()
        } as ProxyWorker);
    }

    private async sendStatus() {
        if (this.managerSocket && this.managerSocket.connected) {
            const health = await this.system.getHealth();
            this.managerSocket.emit(WsEvents.StatusUpdate, {
                id: this.workerId,
                modems: this.hardware.getModems(),
                health
            });
        }
    }

    private async handleCommand(payload: CommandPayload) {
        console.log(`[Worker] Received command: ${payload.command} for modem: ${payload.modemId}`);

        const modem = this.hardware.getModems().find(m => m.id === payload.modemId);
        if (!modem) {
            console.warn(`[Worker] Modem interface ${payload.modemId} not found.`);
            return;
        }

        switch (payload.command) {
            case 'START_PROXY':
                if (payload.data && payload.data.proxyPort) {
                    console.log(`[Worker] Starting proxy on ${modem.interfaceName} -> Port ${payload.data.proxyPort}`);

                    // 1. PIN Unlock if supplied (and seems locked or we just try)
                    if (payload.data.simPin) {
                        if ('unlockSim' in this.hardware) {
                            console.log(`[Worker] Trying SIM unlock with PIN for ${modem.id}`);
                            await (this.hardware as any).unlockSim(modem.interfaceName, payload.data.simPin);
                        }
                    }

                    // 2. Ensure Data Connection
                    if ('connectModem' in this.hardware) {
                        console.log(`[Worker] Ensuring data connection for ${modem.id}`);
                        // Construct config object from payload
                        const connectConfig = {
                            apn: payload.data.mobileConfig?.apn || payload.data.apn || 'free', // Fallback to free if missing, but prefer payload
                            user: payload.data.mobileConfig?.user || payload.data.mobileUser,
                            pass: payload.data.mobileConfig?.pass || payload.data.mobilePass,
                            pin: payload.data.simPin
                        };

                        const connected = await (this.hardware as any).connectModem(modem, connectConfig);
                        if (!connected) {
                            console.error(`[Worker] Failed to establish data connection for ${modem.id}. Proxy might fail.`);
                        }
                    }

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
