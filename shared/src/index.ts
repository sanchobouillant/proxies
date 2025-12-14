export enum ModemStatus {
    Online = 'ONLINE',
    Offline = 'OFFLINE',
    Rebooting = 'REBOOTING',
    Connecting = 'CONNECTING',
}

export interface Modem {
    id: string; // e.g., "modem_1"
    interfaceName: string; // e.g., "wwan0"
    iccid?: string;
    imsi?: string;
    imei?: string; // Add imei
    operator?: string; // Add operator
    // Let's rely on what we can get.
    signalQuality?: number; // 0-100
    ipAddress?: string;
    status: ModemStatus;
    simStatus?: 'READY' | 'LOCKED' | 'ERROR';
    user?: string;
    pass?: string;
    proxyPort?: number; // Port on the Worker (internal)
    protocol?: 'HTTP' | 'SOCKS5';
}

export interface SystemHealth {
    cpuTemp?: number;
    cpuLoad?: number; // percentage
    memoryUsage?: number; // percentage
    undervoltageDetected: boolean;
    uptime: number; // seconds
    recentLogs: string[]; // Critical logs (last 5-10)
}

export interface ProxyWorker {
    id: string;
    name: string; // Add name
    ip: string; // VPN IP
    port?: number;
    status: 'ONLINE' | 'OFFLINE';
    modems: Modem[];
    health?: SystemHealth;
    lastSeen: Date;
}

// WebSocket Events
export enum WsEvents {
    Register = 'REGISTER',
    StatusUpdate = 'STATUS_UPDATE',
    Command = 'COMMAND',
    Log = 'LOG',
}

export interface CommandPayload {
    command: 'REBOOT' | 'ROTATE_IP' | 'UPDATE_AUTH' | 'UNLOCK_SIM' | 'START_PROXY' | 'STOP_PROXY';
    modemId: string;
    data?: any;
}

export interface LogPayload {
    level: string;
    msg: string;
    timestamp?: number;
}

