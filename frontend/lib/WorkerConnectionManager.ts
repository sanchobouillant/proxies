import { Socket } from 'socket.io';
import prisma from '@/lib/prisma';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';
import { io, Socket as ClientSocket } from 'socket.io-client';
import crypto from 'crypto';

export class WorkerConnectionManager {
    private connections: Map<string, ClientSocket> = new Map(); // workerId -> ClientSocket
    private ioServer: any; // Reference to Dashboard IO to broadcast updates
    private workerSecrets: Map<string, string> = new Map(); // workerId -> sharedKey

    // Nonces used for the ephemeral handshake: workerId -> nonce
    private pendingNonces: Map<string, { nonceWorker: string, nonceManager: string }> = new Map();

    constructor(ioServer: any) {
        this.ioServer = ioServer;
    }

    // Called on startup and periodically to ensure we are connected to all known workers
    async refreshConnections() {
        const workers = await prisma.worker.findMany();

        for (const worker of workers) {
            if (!worker.ip || !worker.port) continue;

            if (this.connections.has(worker.id)) {
                // Already connected or connecting
                continue;
            }

            this.connectToWorker(worker);
        }
    }

    private connectToWorker(worker: any) {
        const url = `http://${worker.ip}:${worker.port}`;
        console.log(`[Manager] Connecting to Worker ${worker.name} at ${url}...`);

        // Track secret for encryption/decryption
        this.workerSecrets.set(worker.id, worker.apiKey);
        const socket = io(url, {
            auth: {
                token: worker.apiKey // Authenticate using the worker's shared key
            },
            reconnection: true,
            reconnectionDelay: 5000
        });

        socket.on('connect', () => {
            console.log(`[Manager] Connected to Worker ${worker.name} (${worker.id})`);
            // Ensure secret is ready for handshake
            this.workerSecrets.set(worker.id, worker.apiKey);

            this.updateWorkerStatus(worker.id, 'ONLINE');
            this.syncProxies(worker.id).catch(err => console.error(`[Manager] Failed to sync proxies for ${worker.id}:`, err));

            // On connect, the worker might send us a Register event, 
            // OR we can just wait for status updates.
            // Worker is server, so it accepts us.
        });

        socket.on('disconnect', () => {
            console.log(`[Manager] Disconnected from Worker ${worker.name}`);
            this.updateWorkerStatus(worker.id, 'OFFLINE');
            this.pendingNonces.delete(worker.id);
            this.workerSecrets.delete(worker.id);
        });

        // --- Secure handshake ---
        socket.on('handshake:init', (data: { nonceWorker: string }) => {
            const nonceWorker = data?.nonceWorker;
            if (!nonceWorker) return;

            const nonceManager = crypto.randomBytes(16).toString('hex');
            this.pendingNonces.set(worker.id, { nonceWorker, nonceManager });

            const hmac = this.computeHmac(worker.apiKey, nonceWorker, nonceManager);
            socket.emit('handshake:ack', { nonceManager, hmac, workerId: worker.id });
        });

        socket.on('secure:event', (packet: any) => {
            const decrypted = this.decrypt(worker.id, worker.apiKey, packet);
            if (!decrypted) return;
            const { event, payload } = decrypted;
            switch (event) {
                case WsEvents.Register:
                    this.handleRegister(worker.id, payload as ProxyWorker);
                    break;
                case WsEvents.StatusUpdate:
                    this.handleStatusUpdate(worker.id, payload);
                    break;
                case WsEvents.Log:
                    this.handleLog(worker.id, payload);
                    break;
            }
        });

        this.connections.set(worker.id, socket);
    }

    private computeHmac(sharedKey: string, nonceWorker: string, nonceManager: string) {
        return crypto.createHmac('sha256', sharedKey).update(`${nonceWorker}:${nonceManager}`).digest('hex');
    }

    private deriveSessionKey(sharedKey: string, nonceWorker: string, nonceManager: string): Buffer {
        const h = crypto.createHmac('sha256', sharedKey);
        h.update(`${nonceWorker}:${nonceManager}`);
        return h.digest();
    }

    private decrypt(workerId: string, sharedKey: string, packet: { iv: string, ciphertext: string, tag: string }) {
        const nonces = this.pendingNonces.get(workerId);
        if (!nonces) return null;
        const { nonceWorker, nonceManager } = nonces;
        const sessionKey = this.deriveSessionKey(sharedKey, nonceWorker, nonceManager).subarray(0, 32);

        try {
            const iv = Buffer.from(packet.iv, 'base64');
            const ciphertext = Buffer.from(packet.ciphertext, 'base64');
            const tag = Buffer.from(packet.tag, 'base64');
            const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
            return JSON.parse(decrypted);
        } catch (e) {
            console.error(`[Manager] Failed to decrypt packet for worker ${workerId}:`, e);
            return null;
        }
    }

    private async syncProxies(workerId: string) {
        console.log(`[Manager] Syncing proxies for worker ${workerId}...`);
        const proxies = await prisma.proxy.findMany({
            where: {
                workerId: workerId,
                status: 'ACTIVE'
            }
        });

        if (proxies.length === 0) {
            console.log(`[Manager] No active proxies to sync for worker ${workerId}.`);
            return;
        }

        console.log(`[Manager] Found ${proxies.length} active proxies to start.`);
        for (const proxy of proxies) {
            this.sendCommand(workerId, 'START_PROXY', proxy.modemId, {
                proxyPort: proxy.port,
                user: proxy.authUser,
                pass: proxy.authPass,
                protocol: proxy.protocol,
                apn: proxy.apn,
                simPin: proxy.simPin
            });
        }
    }

    private async updateWorkerStatus(id: string, status: string) {
        await prisma.worker.update({
            where: { id },
            data: { status, lastSeen: new Date() }
        }).catch(err => console.error(`Failed to update status for ${id}`, err));

        // Broadcast
        this.ioServer.emit('state_update', [{ id, status }]);

        // Log event
        await prisma.eventLog.create({
            data: {
                type: 'WORKER',
                entityId: id,
                event: status,
                details: `Worker connection state changed to ${status}`
            }
        }).catch(e => console.error(e));
    }

    private async handleRegister(id: string, data: ProxyWorker) {
        // Update modems/health
        await prisma.worker.update({
            where: { id },
            data: {
                modems: data.modems as any,
                lastSeen: new Date()
            }
        }).catch(err => console.error(`Failed to handle Register for ${id}`, err));

        // Broadcast
        this.ioServer.emit('state_update', [{ ...data, id, status: 'ONLINE' }]);
    }

    private async handleStatusUpdate(id: string, data: any) {
        await prisma.worker.update({
            where: { id },
            data: {
                modems: data.modems as any,
                lastSeen: new Date()
            }
        }).catch(err => console.error(`Failed to handle status update for ${id}`, err));
        this.ioServer.emit('state_update', [{ ...data, id, status: 'ONLINE' }]);
    }

    private async handleLog(id: string, log: any) {
        const saved = await prisma.eventLog.create({
            data: {
                type: 'WORKER',
                entityId: id,
                event: log.level,
                details: log.msg,
                createdAt: log.timestamp ? new Date(log.timestamp) : new Date()
            }
        }).catch(err => console.error(`Failed to log event for ${id}`, err));
        this.ioServer.to('dashboard').emit('new_log', saved);
    }

    public sendCommand(workerId: string, command: string, modemId: string, data?: any) {
        const socket = this.connections.get(workerId);
        if (socket && socket.connected) {
            const nonces = this.pendingNonces.get(workerId);
            if (!nonces) {
                console.warn(`[Manager] Cannot send command ${command}: handshake not completed for worker ${workerId}.`);
                return false;
            }

            const payload = { event: WsEvents.Command, payload: { command, modemId, data } };
            const encrypted = this.encrypt(workerId, payload);
            socket.emit('secure:event', encrypted);
            return true;
        } else {
            console.warn(`[Manager] Cannot send command ${command}: Worker ${workerId} not connected.`);
            return false;
        }
    }

    private encrypt(workerId: string, payload: any) {
        const nonces = this.pendingNonces.get(workerId);
        const sharedKey = this.workerSecrets.get(workerId);
        if (!nonces || !sharedKey) throw new Error('Handshake/session key missing');

        const sessionKey = this.deriveSessionKey(sharedKey, nonces.nonceWorker, nonces.nonceManager).subarray(0, 32);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return { iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: tag.toString('base64') };
    }

    public disconnect(workerId: string) {
        const socket = this.connections.get(workerId);
        if (socket) {
            socket.disconnect();
            this.connections.delete(workerId);
        }
        this.pendingNonces.delete(workerId);
        this.workerSecrets.delete(workerId);
    }
}
