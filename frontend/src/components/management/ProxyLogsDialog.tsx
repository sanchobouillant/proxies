"use client";

import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Download, Upload, Terminal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { io, Socket } from "socket.io-client";

interface LogEntry {
    timestamp: string;
    message: string;
    stats?: { up: number; down: number };
    type?: string;
    proxyPort: number;
}

interface ProxyLogsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    proxy: any; // UIWorker['proxies'][0]
}

export function ProxyLogsDialog({ open, onOpenChange, proxy }: ProxyLogsDialogProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [stats, setStats] = useState({ up: 0, down: 0 });
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (open && proxy) {
            // Connect specifically for logs or use existing global socket?
            // Let's use a specialized connection for simplicity/isolation or reuse logic.
            // We need to pass `role: dashboard`
            const newSocket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000', {
                query: { role: 'dashboard' },
                transports: ['websocket']
            });

            newSocket.on('proxy_log', (data: LogEntry) => {
                if (data.proxyPort === proxy.port) {
                    setLogs(prev => [...prev, data].slice(-100)); // Keep last 100
                    if (data.stats) {
                        setStats(prev => ({ up: prev.up + data.stats!.up, down: prev.down + data.stats!.down }));
                    }
                }
            });

            setSocket(newSocket);

            return () => {
                newSocket.disconnect();
            };
        }
    }, [open, proxy]);

    // Auto scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    if (!proxy) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl h-[80vh] flex flex-col bg-zinc-950 text-green-400 border-zinc-800 font-mono">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-white">
                        <Terminal className="w-5 h-5" />
                        Live Logs: {proxy.name}
                        <Badge variant="outline" className="ml-auto border-green-500/50 text-green-400">
                            :{proxy.port}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-6 text-zinc-400 pt-2">
                        <span className="flex items-center gap-2">
                            <Upload className="w-4 h-4" />
                            <span>{formatBytes(stats.up)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            <span>{formatBytes(stats.down)}</span>
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-hidden relative rounded-md border border-zinc-800 bg-black/50 p-4">
                    <div className="absolute inset-0 overflow-auto space-y-1 p-2" ref={scrollRef}>
                        {logs.length === 0 && (
                            <div className="text-zinc-600 italic">Waiting for traffic...</div>
                        )}
                        {logs.map((log, i) => (
                            <div key={i} className="text-xs flex gap-2">
                                <span className="text-zinc-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                <span className={log.type === 'activity' ? 'text-blue-400' : 'text-green-400'}>
                                    {log.message}
                                </span>
                                {log.stats && (
                                    <span className="text-zinc-500 ml-2">
                                        (U:{formatBytes(log.stats.up)} D:{formatBytes(log.stats.down)})
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function formatBytes(bytes: number, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
