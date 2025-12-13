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
    signalQuality?: number; // 0-100
    ipAddress?: string;
    status: ModemStatus;
    user?: string;
    pass?: string;
    proxyPort?: number; // Port on the Worker (internal)
}

export interface ProxyWorker {
    id: string;
    ip: string; // VPN IP
    status: 'ONLINE' | 'OFFLINE';
    modems: Modem[];
    lastSeen: Date;
}

// WebSocket Events
export enum WsEvents {
    Register = 'REGISTER',
    StatusUpdate = 'STATUS_UPDATE',
    Command = 'COMMAND',
}

export interface CommandPayload {
    command: 'REBOOT' | 'ROTATE_IP' | 'UPDATE_AUTH';
    modemId: string;
    data?: any;
}
