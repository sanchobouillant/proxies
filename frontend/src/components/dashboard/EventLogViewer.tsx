
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, Play, Pause, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { io } from 'socket.io-client';

const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || undefined, {
    autoConnect: true,
    query: { role: 'dashboard' }
});

interface EventLog {
    id: string;
    type: 'WORKER' | 'PROXY';
    entityId: string;
    event: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'INFO' | 'WARN';
    details?: string;
    createdAt: string;
}

interface EventLogViewerProps {
    entityId?: string;
    title?: string;
    className?: string;
}

export function EventLogViewer({ entityId, title = "Activity Log", className }: EventLogViewerProps) {
    const [logs, setLogs] = useState<EventLog[]>([]);
    const [isLive, setIsLive] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const limit = 50;

    // We can't use socket connection logic inside the component easily if it's already connected globally?
    // Assuming global usage or re-use.
    // For now we trust the component to manage its own listener.

    const fetchLogs = useCallback(async (pageNum: number) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                page: pageNum.toString(),
                limit: limit.toString()
            });
            if (entityId) params.append('entityId', entityId);

            const res = await fetch(`/api/events?${params.toString()}`);
            const data = await res.json();

            // Handle both legacy (array) and new (object) responses just in case, though we know we changed API.
            if (Array.isArray(data)) {
                setLogs(data);
            } else {
                setLogs(data.logs);
                setTotalPages(data.totalPages);
                // If we are fetching page 1, we are essentially "resetting" the view
            }
        } catch (e) {
            console.error("Failed to fetch logs", e);
        } finally {
            setIsLoading(false);
        }
    }, [entityId]);

    // Initial Fetch
    useEffect(() => {
        // When mounting or changing entity, fetch page 1
        setPage(1);
        fetchLogs(1);
    }, [fetchLogs]);

    // Live Socket Listener
    useEffect(() => {
        if (!isLive) return;

        const handleNewLog = (newLog: EventLog) => {
            // Filter by entityId if set
            if (entityId && newLog.entityId !== entityId) return;

            setLogs(prev => {
                const updated = [newLog, ...prev].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                if (updated.length > limit) return updated.slice(0, limit);
                return updated;
            });
        };

        socket.on('new_log', handleNewLog);

        return () => {
            socket.off('new_log', handleNewLog);
        };
    }, [isLive, entityId]);

    const toggleLive = () => {
        if (!isLive) {
            // Resuming live mode: fetch latest
            setPage(1);
            fetchLogs(1);
            setIsLive(true);
        } else {
            setIsLive(false);
        }
    };

    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        setPage(newPage);
        fetchLogs(newPage);
        setIsLive(false); // Changing page automatically pauses live mode
    };

    const getVariant = (event: string) => {
        switch (event) {
            case 'ONLINE': return 'default';
            case 'OFFLINE': return 'secondary';
            case 'ERROR': return 'destructive';
            case 'WARN': return 'outline'; // yellowish in future?
            default: return 'outline';
        }
    };

    return (
        <Card className={className}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                    <History className="w-5 h-5" />
                    {title}
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Button
                        variant={isLive ? "default" : "outline"}
                        size="sm"
                        onClick={toggleLive}
                        className={isLive ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                    >
                        {isLive ? <Pause className="w-3 h-3 mr-2" /> : <Play className="w-3 h-3 mr-2" />}
                        {isLive ? "Live" : "Resume"}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => fetchLogs(page)}
                        disabled={isLive}
                        title="Refresh current page"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[160px]">Time</TableHead>
                                {!entityId && <TableHead>Entity</TableHead>}
                                <TableHead>Event</TableHead>
                                <TableHead>Details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">
                                        No logs found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                logs.map((log) => (
                                    <TableRow key={log.id}>
                                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                            {(() => {
                                                const d = new Date(log.createdAt);
                                                return `${d.toLocaleTimeString()}.${d.getMilliseconds().toString().padStart(3, '0')}`;
                                            })()}
                                        </TableCell>
                                        {!entityId && (
                                            <TableCell className="font-mono text-xs">
                                                {log.entityId}
                                            </TableCell>
                                        )}
                                        <TableCell>
                                            <Badge variant={getVariant(log.event) as any}>
                                                {log.event}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-sm font-mono text-zinc-700 dark:text-zinc-300">
                                            {log.details || '-'}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination Controls */}
                {!isLive && totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                        <div className="text-sm text-zinc-500">
                            Page {page} of {totalPages}
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page <= 1}
                            >
                                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page >= totalPages}
                            >
                                Next <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
