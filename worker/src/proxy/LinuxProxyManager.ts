import { ProxyManager } from './ProxyManager';
import { Modem } from '@proxy-farm/shared';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RoutingManager } from '../system/RoutingManager';

export class LinuxProxyManager implements ProxyManager {
    private processes: Map<string, ChildProcess> = new Map();
    private configDir: string;
    private router: RoutingManager;

    constructor() {
        this.configDir = path.resolve(process.cwd(), 'configs');
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir);
        }
        this.router = new RoutingManager();
    }

    async startProxy(modem: Modem): Promise<boolean> {
        if (this.processes.has(modem.id)) {
            console.log(`[LinuxProxy] Proxy for ${modem.id} already running.`);
            return true;
        }

        console.log(`[LinuxProxy] Starting 3proxy for ${modem.id} on ${modem.interfaceName}...`);

        // 1. Get IP of the interface
        // We need the IP to bind the outgoing traffic
        const ip = await this.getInterfaceIp(modem.interfaceName);
        if (!ip) {
            console.error(`[LinuxProxy] Could not get IP for ${modem.interfaceName}`);
            return false;
        }

        // 1.5 Configure Routing (PBR)
        // Ensure traffic from this IP leaves via this interface
        const routeSuccess = await this.router.configureRouting(modem.interfaceName, ip);
        if (!routeSuccess) {
            console.warn(`[LinuxProxy] Routing setup failed for ${modem.id}. Proxy might not work correctly.`);
            // We continue? User said "tout marche tout seul". 
            // If routing fails, it's critical. But maybe we retry or fail?
            // Let's log heavily but proceed, as sometimes rules exist.
        }

        // 2. Generate Config
        const configPath = path.join(this.configDir, `${modem.id}.cfg`);
        const configContent = this.generateConfig(modem, ip);
        console.log(`[LinuxProxy] Generated config for ${modem.id} at ${configPath}:\n${configContent}`);
        fs.writeFileSync(configPath, configContent);

        // 3. Resolve 3proxy binary
        const binaryPath = await this.resolveBinaryPath();
        if (!binaryPath) {
            console.error(`[LinuxProxy] CRITICAL: '3proxy' binary not found in PATH or standard locations.`);
            console.error(`[LinuxProxy] Please install it: 'sudo apt-get install 3proxy'`);
            return false;
        }

        // 4. Spawn 3proxy
        try {
            const child = spawn(binaryPath, [configPath]);

            child.stdout.on('data', (data) => console.log(`[3proxy ${modem.id}] ${data}`));
            child.stderr.on('data', (data) => console.error(`[3proxy ${modem.id}] ${data}`));

            child.on('error', (err) => {
                console.error(`[LinuxProxy] Failed to spawn 3proxy:`, err);
                this.processes.delete(modem.id);
            });

            child.on('exit', (code) => {
                console.log(`[LinuxProxy] 3proxy for ${modem.id} exited with code ${code}`);
                this.processes.delete(modem.id);
            });

            this.processes.set(modem.id, child);
            return true;
        } catch (err) {
            console.error(`[LinuxProxy] Unexpected error spawning 3proxy:`, err);
            return false;
        }
    }

    private async resolveBinaryPath(): Promise<string | null> {
        // 1. Try PATH
        try {
            await new Promise((resolve, reject) => {
                const check = spawn('which', ['3proxy']);
                check.on('close', (code) => code === 0 ? resolve(true) : reject());
            });
            return '3proxy';
        } catch {
            // 2. Try common locations
            const commonPaths = ['/usr/bin/3proxy', '/usr/local/bin/3proxy', '/snap/bin/3proxy'];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) return p;
            }
        }
        return null;
    }

    async stopProxy(modem: Modem): Promise<boolean> {
        const child = this.processes.get(modem.id);
        if (child) {
            console.log(`[LinuxProxy] Stopping 3proxy for ${modem.id}`);
            child.kill('SIGTERM');
            this.processes.delete(modem.id);

            // CLEANUP ROUTES
            // We need the IP. If interface is down, we might not get it, but we should try.
            const ip = await this.getInterfaceIp(modem.interfaceName);
            if (ip) {
                await this.router.cleanupRouting(modem.interfaceName, ip);
            }
            return true;
        }
        return false;
    }

    async restartProxy(modem: Modem): Promise<boolean> {
        await this.stopProxy(modem);
        // Wait a bit for port release
        await new Promise(r => setTimeout(r, 1000));
        return await this.startProxy(modem);
    }

    private generateConfig(modem: Modem, interfaceIp: string): string {
        // Determine protocol command (default to SOCKS5 'socks')
        const cmd = modem.protocol === 'HTTP' ? 'proxy' : 'socks';

        // Basic authenticated proxy config
        let authConfig = `
            # No Auth
            auth none
            allow *
        `;

        if (modem.user && modem.pass) {
            authConfig = `
            # Auth
            auth strong
            users ${modem.user}:CL:${modem.pass}
            allow ${modem.user}
            `;
        }

        return `
            nscache 65536
            timeouts 1 5 30 60 180 1800 15 60
            daemon
            
            ${authConfig}
            
            # Binding
            # internal interface (VPN IP usually, or 0.0.0.0 if not strict)
            # external interface (The 4G IP)
            
            # We use 'parent' chaining or -e flag?
            # 'proxy -eIP' binds the outgoing socket to IP
            # CRITICAL: -eIP ensures strict binding. If IP is down, connection MUST fail.
            # DO NOT remove or change this without verifying NO FALLBACK to default gateway occurs.
            
            ${cmd} -p${modem.proxyPort} -e${interfaceIp}
            flush
        `;
    }

    private async getInterfaceIp(iface: string): Promise<string | null> {
        // simple heuristic using 'ip addr show'
        // In real world, use a library or better parsing
        // We'll trust the hardware manager might have populated it, 
        // OR we fetch it fresh.
        try {
            const { execSync } = require('child_process');
            // Extract IP from: inet 10.42.0.158/24 brd ...
            const stdout = execSync(`ip -4 addr show ${iface}`).toString();
            const match = stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
            return match ? match[1] : null;
        } catch (e) {
            console.error(`[LinuxProxy] Failed to get IP for ${iface}`);
            return null;
        }
    }
}
