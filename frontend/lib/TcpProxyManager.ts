import net from 'net';
import { Server as SocketIOServer } from 'socket.io';

export class TcpProxyManager {
    private servers: Map<number, net.Server> = new Map();
    private io?: SocketIOServer;

    constructor(io?: SocketIOServer) {
        this.io = io;
    }

    setIo(io: SocketIOServer) {
        this.io = io;
    }

    private emitLog(proxyPort: number, message: string, meta?: any) {
        if (this.io) {
            this.io.to('dashboard').emit('proxy_log', {
                proxyPort,
                timestamp: new Date().toISOString(),
                message,
                ...meta
            });
        }
    }

    async ensureProxy(entryPort: number, targetIp: string, targetPort: number) {
        if (this.servers.has(entryPort)) {
            // Already running. Ideally check if target changed, but simple keep-alive is fine for now.
            return;
        }

        console.log(`[TcpProxy] Starting forwarder :${entryPort} -> ${targetIp}:${targetPort}`);

        const server = net.createServer((clientSocket) => {
            const remoteAddress = clientSocket.remoteAddress;
            this.emitLog(entryPort, `New connection from ${remoteAddress}`);

            // Connect to upstream Worker
            const upstream = net.createConnection({ host: targetIp, port: targetPort });

            let upstreamData = 0;
            let downstreamData = 0;
            let isFirstPacket = true;

            clientSocket.on('data', (data) => {
                downstreamData += data.length;
                upstream.write(data);

                if (isFirstPacket) {
                    isFirstPacket = false;
                    const hostname = this.peekHostname(data);
                    if (hostname) {
                        this.emitLog(entryPort, `Accessing: ${hostname}`, { type: 'activity' });
                    }
                }
            });

            upstream.on('data', (data) => {
                upstreamData += data.length;
                clientSocket.write(data);
            });

            clientSocket.on('close', () => {
                this.emitLog(entryPort, `Connection closed`, {
                    stats: { up: upstreamData, down: downstreamData }
                });
            });

            clientSocket.on('error', (err) => {
                upstream.destroy();
            });

            upstream.on('error', (err) => {
                clientSocket.destroy();
            });
        });

        server.listen(entryPort, () => {
            console.log(`[TcpProxy] Listening on port ${entryPort}`);
        });

        server.on('error', (err) => {
            console.error(`[TcpProxy] Server error on port ${entryPort}:`, err.message);
        });

        this.servers.set(entryPort, server);
    }

    private peekHostname(data: Buffer): string | null {
        // HTTP Check
        const str = data.toString('utf8', 0, Math.min(data.length, 1024)); // Check start of packet
        if (/^(CONNECT|GET|POST|PUT|DELETE|HEAD|OPTIONS)/.test(str)) {
            // 1. CONNECT host:port
            const connectMatch = str.match(/^CONNECT ([^ :]+)(?::\d+)?/);
            if (connectMatch) return connectMatch[1];

            // 2. Host header
            const hostMatch = str.match(/Host: ([^\r\n]+)/i);
            if (hostMatch) return hostMatch[1].trim();
        }

        // TLS SNI Check
        if (data.length > 5 && data[0] === 0x16) { // Handshake
            try {
                let pos = 5; // Skip record header (5 bytes)
                // Handshake Header
                pos += 4; // Skip Handshake header (MsgType 1 byte, Length 3 bytes)

                // Client Hello
                pos += 2; // Protocol Version
                pos += 32; // Random

                if (pos >= data.length) return null;

                // Session ID
                const sessionIdLen = data[pos];
                pos += 1 + sessionIdLen;

                // Cipher Suites
                if (pos + 1 >= data.length) return null;
                const cipherSuitesLen = (data[pos] << 8) + data[pos + 1];
                pos += 2 + cipherSuitesLen;

                // Compression Methods
                if (pos >= data.length) return null;
                const compMethodsLen = data[pos];
                pos += 1 + compMethodsLen;

                // Extensions
                if (pos + 1 >= data.length) return null;
                const extensionsLen = (data[pos] << 8) + data[pos + 1];
                pos += 2;

                let extPos = pos;
                const end = extPos + extensionsLen;

                while (extPos + 4 <= end && extPos + 4 <= data.length) {
                    const extType = (data[extPos] << 8) + data[extPos + 1];
                    const extLen = (data[extPos + 2] << 8) + data[extPos + 3];
                    extPos += 4;

                    if (extType === 0) { // server_name extension
                        if (extPos + 2 <= data.length) {
                            // list length (2 bytes)
                            // const listLen = (data[extPos] << 8) + data[extPos+1];
                            extPos += 2;

                            if (extPos + 3 <= data.length) {
                                let nameType = data[extPos];
                                if (nameType === 0) { // host_name
                                    const nameLen = (data[extPos + 1] << 8) + data[extPos + 2];
                                    extPos += 3;
                                    if (extPos + nameLen <= data.length) {
                                        return data.slice(extPos, extPos + nameLen).toString('utf8');
                                    }
                                }
                            }
                        }
                        return null;
                    }
                    extPos += extLen;
                }
            } catch (e) {
                // Ignore parsing errors
                return null;
            }
        }
        return null;
    }

    stopProxy(port: number) {
        const server = this.servers.get(port);
        if (server) {
            server.close();
            this.servers.delete(port);
            console.log(`[TcpProxy] Stopped forwarder on port ${port}`);
        }
    }

    stopAll() {
        for (const [port, server] of this.servers) {
            server.close();
        }
        this.servers.clear();
    }
}
