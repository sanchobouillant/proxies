import net from 'net';

export class TcpProxyManager {
    private servers: Map<number, net.Server> = new Map();

    async ensureProxy(entryPort: number, targetIp: string, targetPort: number) {
        if (this.servers.has(entryPort)) {
            // Check if target changed? For POC, assume port is unique per proxy.
            return;
        }

        console.log(`[TcpProxy] Starting forwarder :${entryPort} -> ${targetIp}:${targetPort}`);

        const server = net.createServer((clientSocket) => {
            // Connect to upstream Worker
            // Note: In real VPN scenario, targetIp is reachable.
            // In Mock localhost scenario, targetIp might be 127.0.0.1.
            const upstream = net.createConnection({ host: targetIp, port: targetPort });

            clientSocket.pipe(upstream);
            upstream.pipe(clientSocket);

            clientSocket.on('error', (err) => {
                // console.error(`[TcpProxy] Client Error on ${entryPort}:`, err.message);
                upstream.destroy();
            });

            upstream.on('error', (err) => {
                // console.error(`[TcpProxy] Upstream Error to ${targetIp}:${targetPort}:`, err.message);
                clientSocket.destroy();
            });
        });

        server.listen(entryPort, () => {
            console.log(`[TcpProxy] Listening on port ${entryPort}`);
        });

        this.servers.set(entryPort, server);
    }

    stopAll() {
        for (const [port, server] of this.servers) {
            server.close();
        }
        this.servers.clear();
    }
}
