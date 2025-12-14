import { io, Socket } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';
// @ts-ignore
const prisma = new PrismaClient();

export class WorkerConnectionManager {
    private connections: Map<string, Socket> = new Map(); // workerId -> Socket
    private ioServer: any; // Reference to Dashboard IO to broadcast updates

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

        const socket = io(url, {
            auth: {
                token: worker.apiKey // Authenticate using the worker's own key
            },
            reconnection: true,
            reconnectionDelay: 5000
        });

        socket.on('connect', () => {
            console.log(`[Manager] Connected to Worker ${worker.name} (${worker.id})`);
            this.updateWorkerStatus(worker.id, 'ONLINE');

            // On connect, the worker might send us a Register event, 
            // OR we can just wait for status updates.
            // Worker is server, so it accepts us.
        });

        socket.on('disconnect', () => {
            console.log(`[Manager] Disconnected from Worker ${worker.name}`);
            this.updateWorkerStatus(worker.id, 'OFFLINE');
        });

        socket.on(WsEvents.Register, (data: ProxyWorker) => {
            this.handleRegister(worker.id, data);
        });

        socket.on(WsEvents.StatusUpdate, (data: any) => {
            this.handleStatusUpdate(worker.id, data);
        });

        socket.on(WsEvents.Log, (log: any) => {
            this.handleLog(worker.id, log);
        });

        this.connections.set(worker.id, socket);
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
        });

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
        });
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
        });
        this.ioServer.to('dashboard').emit('new_log', saved);
    }

    public sendCommand(workerId: string, command: string, modemId: string, data?: any) {
        const socket = this.connections.get(workerId);
        if (socket && socket.connected) {
            socket.emit(WsEvents.Command, { command, modemId, data });
            return true;
        } else {
            console.warn(`[Manager] Cannot send command ${command}: Worker ${workerId} not connected.`);
            return false;
        }
    }
}
