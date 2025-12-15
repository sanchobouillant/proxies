import { setLogCallback } from './logger';
import { Server, Socket } from 'socket.io'; // Server side
import { createHardwareManager } from './hardware/HardwareFactory';
import { HardwareManager } from './hardware/HardwareManager';
import { createProxyManager } from './proxy/ProxyFactory';
import { ProxyManager } from './proxy/ProxyManager';
import { SystemMonitor } from './system/SystemMonitor';
import { ConfigManager } from './system/ConfigManager';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';
import crypto from 'crypto';

class WorkerAgent {
    private io: Server | null = null;
    private managerSocket: Socket | null = null;
    private hardware: HardwareManager;
    private proxy: ProxyManager;
    private system: SystemMonitor;
    private configManager: ConfigManager;
    private workerId: string = '';
    private sharedKey: string = '';
    private sessionKey: Buffer | null = null;
    private handshakeComplete = false;
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
        if (!this.handshakeComplete || !this.sessionKey) return;
        if (this.logBuffer.length > 0 && this.managerSocket && this.managerSocket.connected) {
            console.log(`[Worker] Flushing ${this.logBuffer.length} buffered logs...`);
            this.logBuffer.forEach(log => {
                this.sendSecure(WsEvents.Log, log);
            });
            this.logBuffer = [];
        }
    }

    async start() {
        // Load configuration
        const config = await this.configManager.load();
        this.sharedKey = config.sharedKey;

        if (!this.sharedKey || this.sharedKey.trim().length === 0) {
            console.error('[Worker] sharedKey missing in config.json. Set it and restart.');
            process.exit(1);
        }

        // Port configuration
        const port = process.env.WORKER_PORT ? parseInt(process.env.WORKER_PORT) : 3001;

        console.log(`[Worker] Starting in LISTENING mode on port ${port}...`);

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
            if (token === this.sharedKey) {
                return next();
            }
            console.warn(`[Worker] Validating connection failed. Wrong token.`);
            return next(new Error("Authentication error"));
        });

        this.io.on('connection', (socket) => {
            console.log(`[Worker] Manager connected (ID: ${socket.id})`);
            this.managerSocket = socket;
            this.handshakeComplete = false;
            this.performHandshake(this.sharedKey);

            socket.on('disconnect', () => {
                console.log('[Worker] Manager disconnected');
                this.managerSocket = null;
                this.sessionKey = null;
                this.handshakeComplete = false;
            });

            socket.on('secure:event', async (packet: any) => {
                await this.handleSecurePacket(packet);
            });
        });

        // Start status loop
        setInterval(() => this.sendStatus(), 5000);
    }

    private async performHandshake(sharedKey: string) {
        if (!this.managerSocket) return;

        const nonceWorker = crypto.randomBytes(16).toString('hex');
        // Step 1: send our nonce
        this.managerSocket.emit('handshake:init', { nonceWorker });

        // Step 2: wait for ack
        this.managerSocket.once('handshake:ack', async (data: { nonceManager: string; hmac: string; workerId: string }) => {
            const { nonceManager, hmac, workerId } = data || {};
            if (!nonceManager || !hmac || !workerId) {
                console.error('[Worker] Handshake failed: incomplete ack');
                this.managerSocket?.disconnect();
                return;
            }

            const expected = crypto.createHmac('sha256', sharedKey).update(`${nonceWorker}:${nonceManager}`).digest('hex');
            if (expected !== hmac) {
                console.error('[Worker] Handshake failed: HMAC mismatch');
                this.managerSocket?.disconnect();
                return;
            }

            // Derive session key using HKDF (sha256)
            const hkdf = crypto.createHmac('sha256', sharedKey);
            hkdf.update(`${nonceWorker}:${nonceManager}`);
            const session = hkdf.digest();
            this.sessionKey = session;
            this.workerId = workerId;
            this.handshakeComplete = true;
            console.log('[Worker] Handshake complete. Secure channel established.');

            // Send buffered data now that we can encrypt
            this.flushLogs();
            this.register();
        });
    }

    private encrypt(payload: any): { iv: string, ciphertext: string, tag: string } {
        if (!this.sessionKey) throw new Error('Session key not established');
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.sessionKey.subarray(0, 32), iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: tag.toString('base64') };
    }

    private decrypt(packet: { iv: string, ciphertext: string, tag: string }) {
        if (!this.sessionKey) throw new Error('Session key not established');
        const iv = Buffer.from(packet.iv, 'base64');
        const ciphertext = Buffer.from(packet.ciphertext, 'base64');
        const tag = Buffer.from(packet.tag, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.sessionKey.subarray(0, 32), iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        return JSON.parse(decrypted);
    }

    private sendSecure(event: WsEvents, payload: any) {
        if (!this.managerSocket || !this.handshakeComplete) return;
        const encrypted = this.encrypt({ event, payload });
        this.managerSocket.emit('secure:event', encrypted);
    }

    private async handleSecurePacket(packet: { iv: string, ciphertext: string, tag: string }) {
        if (!this.handshakeComplete) return;
        try {
            const { event, payload } = this.decrypt(packet);
            if (event === WsEvents.Command) {
                await this.handleCommand(payload as CommandPayload);
            } else if (event === 'ROTATE_KEY') {
                const newKey = (payload as any)?.newKey;
                if (typeof newKey === 'string' && newKey.length > 0) {
                    await this.configManager.setSharedKey(newKey);
                    this.sharedKey = newKey;
                    console.log('[Worker] Shared key rotated via manager.');
                    // Acknowledge then drop connection so manager reconnects with new key
                    this.sendSecure('ROTATE_KEY_ACK' as any, { ok: true });
                    setTimeout(() => this.managerSocket?.disconnect(true), 50);
                }
            }
        } catch (e) {
            console.error('[Worker] Failed to decrypt secure packet:', e);
        }
    }

    private async register() {
        if (!this.managerSocket || !this.handshakeComplete) return;

        const health = await this.system.getHealth();
        this.sendSecure(WsEvents.Register, {
            id: this.workerId,
            ip: '0.0.0.0',
            port: process.env.WORKER_PORT ? parseInt(process.env.WORKER_PORT) : 3001,
            status: 'ONLINE',
            modems: this.hardware.getModems(),
            health,
            lastSeen: new Date()
        } as ProxyWorker);
    }

    private async sendStatus() {
        if (this.managerSocket && this.managerSocket.connected && this.handshakeComplete) {
            const health = await this.system.getHealth();

            const modems = this.hardware.getModems();
            this.sendSecure(WsEvents.StatusUpdate, {
                id: this.workerId,
                modems: modems,
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
                            apn: payload.data.apn || 'free', // Fallback to free if missing, but prefer payload
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
                    (modem as any).proxyStatus = 'ACTIVE';
                    await this.proxy.startProxy(modem);
                }
                break;

            case 'STOP_PROXY':
                console.log(`[Worker] Stopping proxy on ${modem.interfaceName}`);
                await this.proxy.stopProxy(modem);
                // Clear proxy details from modem state
                delete (modem as any).proxyPort;
                delete (modem as any).user;
                delete (modem as any).pass;
                delete (modem as any).protocol;
                (modem as any).proxyStatus = 'STOPPED';
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
