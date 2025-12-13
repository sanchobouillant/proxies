import { io, Socket } from 'socket.io-client';
import { createHardwareManager } from './hardware/HardwareFactory';
import { HardwareManager } from './hardware/HardwareManager';
import { MockProxyManager } from './proxy/MockProxyManager';
import { ProxyManager } from './proxy/ProxyManager';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';

const MANAGER_URL = process.env.MANAGER_URL || 'http://localhost:3000';
const WORKER_ID = 'worker_' + Math.floor(Math.random() * 1000);

class WorkerAgent {
    private socket: Socket;
    private hardware: HardwareManager;
    private proxy: ProxyManager;

    constructor() {
        this.socket = io(MANAGER_URL, {
            autoConnect: false,
            reconnection: true,
        });
        this.hardware = createHardwareManager();
        this.proxy = new MockProxyManager();
    }

    async start() {
        console.log(`[Worker ${WORKER_ID}] Starting...`);

        // Initial hardware scan
        const modems = await this.hardware.scanDevices();
        console.log(`[Worker] Found ${modems.length} modems.`);

        // Start proxies for found modems
        for (const modem of modems) {
            await this.proxy.startProxy(modem);
        }

        this.socket.connect();

        this.socket.on('connect', () => {
            console.log(`[Worker] Connected to Manager at ${MANAGER_URL}`);
            this.register();
        });

        this.socket.on('disconnect', () => {
            console.log('[Worker] Disconnected from Manager');
        });

        this.socket.on(WsEvents.Command, async (payload: CommandPayload) => {
            console.log(`[Worker] Received command: ${payload.command} for ${payload.modemId}`);
            await this.handleCommand(payload);
        });

        // Start status loop
        setInterval(() => this.sendStatus(), 5000);
    }

    private register() {
        this.socket.emit(WsEvents.Register, {
            id: WORKER_ID,
            ip: '127.0.0.1', // Mock VPN IP
            status: 'ONLINE',
            modems: this.hardware.getModems(),
            lastSeen: new Date()
        } as ProxyWorker);
    }

    private sendStatus() {
        if (this.socket.connected) {
            this.socket.emit(WsEvents.StatusUpdate, {
                id: WORKER_ID,
                modems: this.hardware.getModems()
            });
        }
    }

    private async handleCommand(payload: CommandPayload) {
        const modems = this.hardware.getModems();
        const modem = modems.find(m => m.id === payload.modemId);

        if (!modem) {
            console.error(`[Worker] Modem ${payload.modemId} not found`);
            return;
        }

        switch (payload.command) {
            case 'REBOOT':
                await this.hardware.rebootModem(modem.interfaceName);
                await this.proxy.restartProxy(modem);
                break;
            case 'ROTATE_IP':
                await this.hardware.rotateIp(modem.interfaceName);
                break;
            case 'UPDATE_AUTH':
                if (payload.data && payload.data.user && payload.data.pass) {
                    modem.user = payload.data.user;
                    modem.pass = payload.data.pass;
                    await this.proxy.restartProxy(modem);
                }
                break;
        }
    }
}

// Run
const agent = new WorkerAgent();
agent.start().catch(console.error);
