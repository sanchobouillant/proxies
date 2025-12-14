import { createServer, IncomingMessage, ServerResponse } from 'http';
console.log("SERVER STARTING...");
import { WorkerConnectionManager } from './lib/WorkerConnectionManager';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { WsEvents, CommandPayload, ProxyWorker } from '@proxy-farm/shared';
import prisma from './src/lib/prisma';
import { TcpProxyManager } from './lib/TcpProxyManager';
import { randomUUID } from 'crypto';
const bcrypt = require('bcrypt');

// Ensure env vars are loaded for standalone script
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

console.log("Prisma using singleton from lib/prisma");
const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
const tcpManager = new TcpProxyManager();

// In-memory map of active sockets for workers


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


    // 0.5 Restore Proxies & Ensure Default User
    const userCount = await prisma.user.count();
    if (userCount === 0) {
        console.log("Creating default admin user...");
        const hashedPassword = bcrypt.hashSync('admin', 10);
        await prisma.user.create({
            data: {
                username: 'admin',
                password: hashedPassword,
                role: 'ADMIN'
            }
        });
        console.log("Default user 'admin' created.");
    }

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
                const { name, ip, port, apiKey: providedKey } = body; // optional apiKey from user

                if (!name || !ip || !port) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: name, ip, or port' }));
                    return;
                }

                // Host validation: allow IPv4, localhost, or hostname; forbid schemes/paths
                if (/^https?:\/\//i.test(ip) || /[\s/]/.test(ip)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'IP/Host should not include protocol or path' }));
                    return;
                }
                const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
                const hostname = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
                if (!(ip === 'localhost' || ipv4.test(ip) || hostname.test(ip))) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid host format (use IPv4 or hostname, no protocol)' }));
                    return;
                }

                const portNum = parseInt(port);
                if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid port' }));
                    return;
                }

                const apiKey = providedKey && typeof providedKey === 'string' && providedKey.trim().length >= 16
                    ? providedKey.trim()
                    : randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''); // 64 chars hex-like
                try {
                    const worker = await prisma.worker.create({
                        data: { name, ip, port: portNum, apiKey }
                    });

                    // User will copy the key manually to worker config.json
                    workerManager.refreshConnections(); // attempts connection once worker is configured
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
                    // 3. Notify Worker
                    workerManager.sendCommand(workerId, 'START_PROXY', finalModemId, {
                        id: proxy.id,
                        proxyPort: pPort,
                        user: authUser,
                        pass: authPass,
                        protocol: protocol || 'SOCKS5'
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

                    // Disconnect current connection so user can update worker manually
                    workerManager.disconnect(id);
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

            if (req.method === 'PUT' && pathname?.match(/^\/api\/control\/workers\/[^\/]+$/)) {
                const parts = pathname.split('/');
                const id = parts[4];
                const body = await getBody(req);
                const { name, ip, port } = body;

                if (!name || !ip || !port) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing required fields: name, ip, or port' }));
                    return;
                }

                // Reuse host validation
                if (/^https?:\/\//i.test(ip) || /[\s/]/.test(ip)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'IP/Host should not include protocol or path' }));
                    return;
                }
                const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
                const hostname = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
                if (!(ip === 'localhost' || ipv4.test(ip) || hostname.test(ip))) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid host format (use IPv4 or hostname, no protocol)' }));
                    return;
                }
                const portNum = parseInt(port);
                if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid port' }));
                    return;
                }

                try {
                    const updated = await prisma.worker.update({
                        where: { id },
                        data: { name, ip, port: portNum }
                    });
                    // If connection exists, drop it so it reconnects with new coords
                    workerManager.disconnect(id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(updated));
                } catch (e: any) {
                    console.error('Error updating worker:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to update worker' }));
                }
                return;
            }

            if (req.method === 'DELETE' && pathname?.match(/^\/api\/control\/workers\/[^\/]+$/)) {
                const parts = pathname.split('/');
                const id = parts[4];

                try {
                    // Remove proxies first to satisfy FK constraints
                    await prisma.proxy.deleteMany({ where: { workerId: id } });
                    await prisma.worker.delete({ where: { id } });
                    // Disconnect if connected
                    workerManager.disconnect(id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } catch (e: any) {
                    console.error('Error deleting worker:', e);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Failed to delete worker' }));
                }
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

    // Worker Connection Manager (Reverse Connection)
    // We import it dynamically if needed or just use the imported class
    const workerManager = new WorkerConnectionManager(io);

    // Periodically refresh list of workers to connect to
    setInterval(() => workerManager.refreshConnections(), 10000);
    workerManager.refreshConnections();

    // Inject IO into TcpProxyManager so it can emit logs
    tcpManager.setIo(io);

    // Validating middleware - ONLY for Dashboard now
    io.use(async (socket, next) => {
        const queryRole = socket.handshake.query.role;
        const isDashboard = queryRole === 'dashboard';

        console.log(`[Server] New connection attempt. Role: ${queryRole}`);

        if (isDashboard) {
            console.log('[Server] Dashboard connecting...');
            socket.join('dashboard');
            return next();
        }

        // We no longer accept Worker connections here.
        // If it's not dashboard, we reject or ignore.
        return next(new Error("Unauthorized: Only dashboard allowed on this port"));
    });

    io.on('connection', async (socket) => {
        const role = socket.handshake.query.role;

        if (role === 'dashboard') {
            socket.join('dashboard');
            console.log(`[Server] Socket ${socket.id} joined 'dashboard' room.`);
        }
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
