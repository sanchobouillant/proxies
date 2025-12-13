import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { TcpProxyManager } from './lib/TcpProxyManager';
import { WsEvents, ProxyWorker, Modem } from '@proxy-farm/shared';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

// Init Next.js
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Init Managers
const tcpProxy = new TcpProxyManager();
// In-memory state for POC
const workers: Map<string, ProxyWorker> = new Map();

app.prepare().then(() => {
    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url!, true);
            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    });

    const io = new SocketIOServer(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('[Server] Client connected:', socket.id);

        // Initial State Sync (for UI clients)
        socket.on('request_state', () => {
            socket.emit('state_update', Array.from(workers.values()));
        });

        // Worker Registration
        socket.on(WsEvents.Register, (worker: ProxyWorker) => {
            console.log(`[Server] Worker registered: ${worker.id} (${worker.modems.length} modems)`);
            workers.set(worker.id, worker);

            // Assign TCP Ports for Modems
            // For POC: we map a static range starting at 10000 + some index
            // In real app, we need DB to persist this mapping.
            worker.modems.forEach((modem, index) => {
                // Simple hashing or index logic for POC
                // User asked to choose port, but for auto-setup we assign defaults?
                // Spec says: "Interface de gestion servira de load balancer... il saura vers quel proxies rediriger selon le port d'acces"
                // BIBLE 4.2: Ports Manager 30000-39999
                const workerIndex = parseInt(worker.id.split('_')[1] || '0') % 50;
                const entryPort = 30000 + (workerIndex * 100) + index;

                // Mock: Worker Proxy Port is sent by Worker.
                // In MockHardware, ports are 20000, 20002...
                tcpProxy.ensureProxy(entryPort, worker.ip, modem.proxyPort || 20000);

                // Update modem object with assigned entry port (for UI)
                (modem as any).assignedEntryPort = entryPort;
            });

            // Broadcast to UI
            io.emit('state_update', Array.from(workers.values()));
        });

        socket.on(WsEvents.StatusUpdate, (payload: { id: string; modems: Modem[] }) => {
            const worker = workers.get(payload.id);
            if (worker) {
                worker.modems = payload.modems;
                worker.lastSeen = new Date();
                // Re-broadcast
                io.emit('state_update', Array.from(workers.values()));
            }
        });

        // Handle Commands from UI -> to Worker
        socket.on('ui_command', (payload: { workerId: string; command: string; modemId: string; data?: any }) => {
            // Forward to specific worker (room or socket)
            // Since we don't track socket-to-workerId strictly here in POC (simplified), we broadcast or need to find socket.
            // Better: join room 'worker_ID'.
            // For POC: Broadcast to all (worker filters) or iterate sockets.
            io.emit(WsEvents.Command, {
                command: payload.command,
                modemId: payload.modemId,
                data: payload.data
            });
        });
    });

    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
    });
});
