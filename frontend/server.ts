import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { WsEvents, ProxyWorker } from '@proxy-farm/shared';
// @ts-ignore
// @ts-ignore
const { PrismaClient } = require('@prisma/client');
import { TcpProxyManager } from './lib/TcpProxyManager';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';

// Ensure env vars are loaded for standalone script
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const prisma = new PrismaClient({
    log: ['info', 'warn', 'error']
} as any);
const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const tcpManager = new TcpProxyManager();

// In-memory map of active sockets for workers
const workerSockets: Map<string, string> = new Map(); // workerId -> socketId

// Session handling
function getCookie(req: IncomingMessage, name: string) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';').map(c => c.trim());
    const cookie = cookies.find(c => c.startsWith(`${name}=`));
    return cookie ? cookie.split('=')[1] : null;
}

// 0. Helper for logging
async function logEvent(type: 'WORKER' | 'PROXY', entityId: string, event: 'ONLINE' | 'OFFLINE' | 'ERROR', details?: string) {
    try {
        await prisma.eventLog.create({
            data: { type, entityId, event, details }
        });
    } catch (e) {
        console.error("Failed to log event:", e);
    }
}

app.prepare().then(async () => {


    // 0.5 Restore Proxies
    const allProxies = await prisma.proxy.findMany({ include: { worker: true } });
    for (const proxy of allProxies) {
        if (proxy.worker && proxy.worker.ip) {
            tcpManager.ensureProxy(proxy.port, proxy.worker.ip, proxy.port);
        }
    }

    const server = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url!, true);
            const { pathname, query } = parsedUrl;

            // AUTH GUARD (Replaces middleware.ts)
            const token = getCookie(req, 'auth_token');
            const publicPaths = ['/login', '/api/auth/login', '/favicon.ico'];
            const isPublic = publicPaths.includes(pathname || '') ||
                pathname?.startsWith('/_next') ||
                pathname?.startsWith('/static') ||
                pathname?.startsWith('/api/auth'); // Allow all auth endpoints

            if (!token && !isPublic) {
                res.writeHead(307, { Location: '/login' });
                res.end();
                return;
            }
            if (req.method === 'POST' && pathname === '/api/auth/login') {
                const body = await getBody(req);
                const { username, password } = body;
                const user = await prisma.user.findUnique({ where: { username } });

                if (user && bcrypt.compareSync(password, user.password)) {
                    const sessionId = randomUUID();
                    res.writeHead(200, {
                        'Set-Cookie': `auth_token=${user.id}; HttpOnly; Path=/; Max-Age=86400`,
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({ success: true, role: user.role }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid credentials' }));
                }
                return;
            }

            if (req.method === 'POST' && pathname === '/api/auth/logout') {
                res.writeHead(200, {
                    'Set-Cookie': `auth_token=; HttpOnly; Path=/; Max-Age=0`,
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ success: true }));
                return;
            }

            // USER MANAGEMENT API
            if (pathname === '/api/users' || pathname?.startsWith('/api/users/')) {
                const token = getCookie(req, 'auth_token');
                if (!token) { // Use simpler query for MVP or middleware checks
                    res.writeHead(401); res.end('Unauthorized'); return;
                }

                // GET /api/users
                if (req.method === 'GET' && pathname === '/api/users') {
                    const users = await prisma.user.findMany({
                        select: { id: true, username: true, role: true, createdAt: true }
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(users));
                    return;
                }

                // POST /api/users (Create)
                if (req.method === 'POST' && pathname === '/api/users') {
                    const body = await getBody(req);
                    const { username, password, role } = body;
                    if (!username || !password) {
                        res.writeHead(400); res.end(JSON.stringify({ error: 'Missing fields' })); return;
                    }
                    try {
                        const newUser = await prisma.user.create({
                            data: {
                                username,
                                password: bcrypt.hashSync(password, 10),
                                role: role || 'USER'
                            }
                        });
                        res.writeHead(201, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ id: newUser.id, username: newUser.username }));
                    } catch (e) {
                        res.writeHead(400); res.end(JSON.stringify({ error: 'User already exists' }));
                    }
                    return;
                }

                // DELETE /api/users/:id
                if (req.method === 'DELETE' && pathname?.startsWith('/api/users/')) {
                    const id = pathname.split('/').pop();
                    try {
                        await prisma.user.delete({ where: { id } });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } catch (e) {
                        res.writeHead(404); res.end(JSON.stringify({ error: 'User not found' }));
                    }
                    return;
                }
            }

            if (req.method === 'GET' && pathname === '/api/auth/me') {
                const token = getCookie(req, 'auth_token');
                if (token) {
                    try {
                        const user = await prisma.user.findUnique({ where: { id: token } });
                        if (user) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                user: {
                                    username: user.username,
                                    email: user.email,
                                    role: user.role
                                }
                            }));
                            return;
                        }
                    } catch (err) {
                        console.error('Prisma Error in auth/me:', err);
                        res.writeHead(500); res.end(); return;
                    }
                }
                res.writeHead(401);
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            // LOGOUT
            if (req.method === 'POST' && pathname === '/api/auth/logout') {
                res.setHeader('Set-Cookie', 'auth_token=; Path=/; HttpOnly; Max-Age=0');
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            // UPDATE PROFILE
            if (req.method === 'PUT' && pathname === '/api/auth/me') {
                const token = getCookie(req, 'auth_token');
                if (!token) {
                    res.writeHead(401); res.end('Unauthorized'); return;
                }

                const body = await getBody(req);
                const { username, email, password } = body;

                // Validate basic input
                if (!username) {
                    res.writeHead(400); res.end(JSON.stringify({ error: 'Username is required' })); return;
                }

                try {
                    // Check ownership/uniqueness if changing username/email
                    const existingUser = await prisma.user.findFirst({
                        where: {
                            OR: [
                                { username, id: { not: token } },
                                { email, id: { not: token } }
                            ]
                        }
                    });

                    if (existingUser) {
                        res.writeHead(400); res.end(JSON.stringify({ error: 'Username or Email already taken' }));
                        return;
                    }

                    const updateData: any = { username, email };
                    if (password && password.length > 0) {
                        updateData.password = bcrypt.hashSync(password, 10);
                    }

                    await prisma.user.update({
                        where: { id: token },
                        data: updateData
                    });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    console.error("Error updating profile:", e);
                    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal Server Error' }));
                }
                return;
            }


            // MIDDLEWARE FOR CONTROL API & DASHBOARD
            // Allow /_next, /static, /login public
            // Allow /_next, /static, /login, and public assets
            const isAsset = pathname?.match(/\.(png|jpg|jpeg|gif|svg|ico)$/);
            if (!pathname?.startsWith('/_next') && !pathname?.startsWith('/static') && pathname !== '/login' && !isAsset && pathname !== '/logout') {
                const token = getCookie(req, 'auth_token');
                if (!token) {
                    // If API, 401
                    if (pathname?.startsWith('/api')) {
                        res.writeHead(401);
                        res.end('{"error": "Unauthorized"}');
                        return;
                    }
                    // Else redirect to login
                    res.writeHead(302, { Location: '/login' });
                    res.end();
                    return;
                }
            }


            // Custom API Endpoints for Management
            if (req.method === 'GET' && pathname === '/api/settings') {
                try {
                    const settings = await prisma.setting.findMany();
                    const settingsMap = settings.reduce((acc: Record<string, string>, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(settingsMap));
                } catch (error) {
                    console.error('Error fetching settings:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
                return;
            }

            if (req.method === 'POST' && pathname === '/api/settings') {
                try {
                    const body = await getBody(req);
                    const { key, value } = body;
                    if (!key || value === undefined) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Key and value are required' }));
                        return;
                    }

                    const setting = await prisma.setting.upsert({
                        where: { key },
                        update: { value },
                        create: { key, value }
                    });

                    // Broadcast settings update to dashboard
                    io.to('dashboard').emit('settings_updated', { [key]: value });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(setting));
                } catch (error) {
                    console.error('Error updating setting:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
                return;
            }

            if (req.method === 'POST' && pathname === '/api/control/worker') {
                const body = await getBody(req);
                const { name, ip, port } = body; // Ignore incoming apiKey

                if (!name || !ip || !port) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: name, ip, or port' }));
                    return;
                }

                // Simple Server-side IP validation
                const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^localhost$/;
                if (!ipRegex.test(ip)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid IP address format' }));
                    return;
                }

                const apiKey = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''); // 64 chars hex-like
                try {
                    const worker = await prisma.worker.create({
                        data: { name, ip, port: parseInt(port), apiKey }
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(worker));
                } catch (e: any) {
                    console.error("Worker creation error:", e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    // Provide a generic error unless it's a known constraint violation
                    res.end(JSON.stringify({ error: 'Failed to create worker. Name or IP might already be in use.' }));
                }
                return;
            }

            if (req.method === 'POST' && pathname === '/api/control/proxy') {
                const body = await getBody(req);
                // We accept 'modemInterface' for legacy compatibility or 'modemId'
                const { name, port, authUser, authPass, modemInterface, modemId, workerId, protocol } = body;

                const finalModemId = modemId || modemInterface;

                try {
                    const pPort = parseInt(port);
                    // 1. Create in DB
                    const proxy = await prisma.proxy.create({
                        data: {
                            name,
                            port: pPort,
                            authUser,
                            authPass,
                            modemId: finalModemId,
                            workerId,
                            protocol: protocol || 'SOCKS5'
                        }
                    });

                    // 2. Start TCP Forwarder
                    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
                    if (worker && worker.ip) {
                        // Assuming TargetPort = EntryPort
                        tcpManager.ensureProxy(pPort, worker.ip, pPort);
                    }

                    // 3. Notify Worker
                    io.to(workerId).emit(WsEvents.Command, {
                        command: 'START_PROXY',
                        modemId: finalModemId,
                        data: {
                            id: proxy.id,
                            port: pPort,
                            user: authUser,
                            pass: authPass,
                            protocol: protocol || 'SOCKS5'
                        }
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(proxy));
                } catch (e: any) {
                    console.error(e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
                return;
            }

            // REGENERATE WORKER KEY
            if (req.method === 'POST' && pathname?.match(/^\/api\/control\/workers\/[^\/]+\/regenerate-key$/)) {
                const parts = pathname.split('/');
                const id = parts[4]; // /api/control/workers/:id/regenerate-key
                const apiKey = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

                try {
                    await prisma.worker.update({
                        where: { id },
                        data: { apiKey }
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, apiKey }));
                } catch (e) {
                    console.error('Error regenerating key:', e);
                    res.writeHead(500); res.end(JSON.stringify({ error: 'Failed' }));
                }
                return;
            }

            if (req.method === 'GET' && pathname === '/api/control/workers') {
                const workers = await prisma.worker.findMany({ include: { proxies: true } });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(workers));
                return;
            }

            if (req.method === 'GET' && pathname === '/api/events') {
                const limit = query.limit ? parseInt(query.limit as string) : 50;
                const page = query.page ? parseInt(query.page as string) : 1;
                const skip = (page - 1) * limit;
                const entityId = query.entityId as string;

                const whereClause = entityId ? { entityId } : {};

                const [logs, total] = await Promise.all([
                    prisma.eventLog.findMany({
                        where: whereClause,
                        take: limit,
                        skip: skip,
                        orderBy: { createdAt: 'desc' }
                    }),
                    prisma.eventLog.count({ where: whereClause })
                ]);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ logs, total, page, totalPages: Math.ceil(total / limit) }));
                return;
            }

            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    });

    const io = new SocketIOServer(server, {
        cors: { origin: "*", methods: ["GET", "POST"] }
    });

    // Inject IO into TcpProxyManager so it can emit logs
    tcpManager.setIo(io);

    // Validating middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        const queryRole = socket.handshake.query.role;
        const isDashboard = queryRole === 'dashboard';

        console.log(`[Server] New connection attempt. Role: ${queryRole}, Token: ${token ? 'PRESENT' : 'MISSING'}`);

        if (isDashboard) {
            console.log('[Server] Dashboard connecting...');
            socket.join('dashboard');
            return next();
        }

        if (!token) {
            console.warn('[Server] Auth failed: No token provided');
            return next(new Error("Authentication error: No token provided"));
        }

        const worker = await prisma.worker.findUnique({ where: { apiKey: token } });
        if (!worker) {
            console.warn(`[Server] Auth failed: Invalid token '${token}'`);
            return next(new Error("Authentication error: Invalid token"));
        }

        console.log(`[Server] Worker authenticated: ${worker.name} (${worker.id})`);
        // Attach worker info to socket if needed
        (socket as any).workerId = worker.id;
        next();
    });

    io.on('connection', async (socket) => {
        const workerId = (socket as any).workerId;
        const role = socket.handshake.query.role; // Access role from handshake

        if (role === 'dashboard') {
            socket.join('dashboard');
            console.log(`[Server] Socket ${socket.id} joined 'dashboard' room.`);
        }

        console.log(`[Server] Worker connected: ${workerId}`);
        if (workerId) {
            workerSockets.set(workerId, socket.id);
        }

        if (workerId) {
            await prisma.worker.update({
                where: { id: workerId },
                data: {
                    status: 'ONLINE',
                    lastSeen: new Date()
                }
            });
            logEvent('WORKER', workerId, 'ONLINE');

            const workerProxies = await prisma.proxy.findMany({ where: { workerId } });
            for (const proxy of workerProxies) {
                socket.emit(WsEvents.Command, {
                    command: 'START_PROXY',
                    modemId: proxy.modemId,
                    data: {
                        proxyPort: proxy.port,
                        user: proxy.authUser,
                        pass: proxy.authPass
                    }
                });
                // Also ensure TCP Listener (in case server rebooted but worker stayed up? or just for safety)
                // We need worker IP. It's in DB.
                const w = await prisma.worker.findUnique({ where: { id: workerId } });
                if (w && w.ip) {
                    tcpManager.ensureProxy(proxy.port, w.ip, proxy.port);
                }
            }
        }

        // Register Handler
        socket.on(WsEvents.Register, async (data: ProxyWorker) => {
            // Update live state if needed, but primarily we rely on DB for config
            // Re-hydrate proxies

            // Update Worker IP/Port if provided
            if (data.port || data.ip) {
                await prisma.worker.update({
                    where: { id: workerId },
                    data: {
                        ip: data.ip,
                        port: data.port,
                        modems: data.modems as any
                    }
                });
            } else {
                // Even if IP/Port didn't change, we should update modems if they are present
                await prisma.worker.update({
                    where: { id: workerId },
                    data: {
                        modems: data.modems as any
                    }
                });
            }

            const proxies = await prisma.proxy.findMany({ where: { workerId } });
            console.log(`[Server] Re-hydrating ${proxies.length} proxies for ${workerId}`);

            for (const proxy of proxies) {
                // We need to map `modemId` (from DB) to target modem.
                // The worker sends its modems in Register payload.
                const targetModem = data.modems.find(m => m.id === proxy.modemId || m.interfaceName === proxy.modemId);

                if (targetModem) {
                    socket.emit(WsEvents.Command, {
                        command: 'START_PROXY',
                        modemId: targetModem.id,
                        data: {
                            proxyPort: proxy.port,
                            user: proxy.authUser,
                            pass: proxy.authPass
                        }
                    });
                }
            }

            // Broadcast state to UI
            // We force the ID to be the authenticated one prevents duplicate ghosts
            const safeData = { ...data, id: workerId };
            io.emit('state_update', [safeData]);
        });

        socket.on(WsEvents.StatusUpdate, async (data) => {
            // Update DB with latest stats/modems
            if (workerId && data.modems) {
                await prisma.worker.update({
                    where: { id: workerId },
                    data: { modems: data.modems as any }
                }).catch((e: any) => console.error("Failed to update worker status", e));
            }

            // Broadcast live stats to UI
            const safeData = { ...data, id: workerId, status: 'ONLINE' };
            io.emit('state_update', [safeData]);
        });

        socket.on(WsEvents.Log, async (payload: { level: string, msg: string, timestamp?: number }) => {
            console.log(`[Server DEBUG] Received Log event from ${workerId}:`, payload);
            if (workerId) {
                const savedLog = await prisma.eventLog.create({
                    data: {
                        type: 'WORKER',
                        entityId: workerId,
                        event: payload.level, // INFO, WARN, ERROR
                        details: payload.msg,
                        createdAt: payload.timestamp ? new Date(payload.timestamp) : new Date()
                    }
                }).catch((e: any) => console.error("Failed to save worker log", e));

                // Broadcast to dashboard
                if (savedLog) {
                    io.to('dashboard').emit('new_log', savedLog);
                }
            }
        });

        socket.on('disconnect', async () => {
            const workerId = (socket as any).workerId; // Ensure workerId is available here
            if (workerId) {
                const currentSocketId = workerSockets.get(workerId);
                // Only mark offline if the disconnecting socket is the CURRENT active socket.
                // If the worker reconnected, currentSocketId will be different (the new one).
                if (currentSocketId === socket.id) {
                    console.log(`[Server] Worker disconnected: ${workerId}`);
                    await prisma.worker.update({
                        where: { id: workerId },
                        data: { status: 'OFFLINE' }
                    });

                    // Create and broadcast OFFLINE log
                    const offlineLog = await prisma.eventLog.create({
                        data: {
                            type: 'WORKER',
                            entityId: workerId,
                            event: 'OFFLINE',
                            details: 'Worker disconnected'
                        }
                    }).catch((e: any) => console.error("Failed to save offline log", e));

                    if (offlineLog) {
                        io.to('dashboard').emit('new_log', offlineLog);
                    }

                    workerSockets.delete(workerId);

                    // Broadcast offline state to UI
                    io.emit('state_update', [{ id: workerId, status: 'OFFLINE' }]);
                } else {
                    console.log(`[Server] Old socket disconnected for ${workerId} (ignored).`);
                }
            }
        });
    });

    // Startup cleanup: Reset all workers to OFFLINE
    async function resetWorkerStatuses() {
        try {
            const result = await prisma.worker.updateMany({
                data: { status: 'OFFLINE' }
            });
            console.log(`[Server] Reset ${result.count} workers to OFFLINE status on startup.`);
        } catch (e) {
            console.error("Failed to reset worker statuses:", e);
        }
    }

    const PORT = process.env.PORT || 3000;

    resetWorkerStatuses().then(() => {
        server.listen(PORT, () => { // Assuming 'server' is the http server instance
            console.log(`> Ready on http://localhost:${PORT}`);
        });
    });
}); // Closing app.prepare()

function getBody(req: any): Promise<any> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: any) => body += chunk);
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
    });
}
