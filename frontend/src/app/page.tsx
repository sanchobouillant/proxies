'use client';

import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';
import { ProxyWorker, Modem } from '@proxy-farm/shared';
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Activity, Server, Shield, RefreshCw, Power } from 'lucide-react';

let socket: Socket;

export default function Home() {
  const [workers, setWorkers] = useState<ProxyWorker[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    socket = io({ path: '/socket.io' });

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('request_state');
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('state_update', (data: ProxyWorker[]) => {
      setWorkers(data);
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, []);

  const sendCommand = (workerId: string, modemId: string | null, command: string, data?: any) => {
    // If modemId is null, it applies to the worker generally (though backend might need specific handling, 
    // for now we assume the worker handles 'REBOOT' generally or we adapt)
    // Actually, for Worker controls, we might need a specific event or pass null modemId.
    socket.emit('ui_command', { workerId, modemId, command, data });
  };

  const allProxies = workers.flatMap(worker =>
    worker.modems.map(modem => ({
      ...modem,
      workerId: worker.id,
      workerStatus: worker.status
    }))
  );

  return (
    <main className="min-h-screen bg-background p-8 font-sans">
      <div className="max-w-[1600px] mx-auto space-y-8">

        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Proxy Farm Manager</h1>
            <p className="text-muted-foreground">Orchestration & Control System</p>
          </div>
          <Badge variant={isConnected ? "default" : "destructive"} className="px-4 py-1.5">
            {isConnected ? "SYSTEM ONLINE" : "DISCONNECTED"}
          </Badge>
        </div>

        {/* WORKERS TABLE */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" />
              <CardTitle>Physical Workers</CardTitle>
            </div>
            <CardDescription>Manage the physical Raspberry Pi nodes.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker ID</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mock Devices</TableHead>
                  <TableHead className="text-right">Global Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map(worker => (
                  <TableRow key={worker.id}>
                    <TableCell className="font-bold">{worker.id}</TableCell>
                    <TableCell className="font-mono text-xs">{worker.ip}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20">
                        {worker.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{worker.modems.length} modems</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => sendCommand(worker.id, null, 'REBOOT')}>Reboot Node</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* PROXIES TABLE */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-400" />
              <CardTitle>Active Proxies</CardTitle>
            </div>
            <CardDescription>Individual 4G Uplinks and connection status.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proxy Name (Interface)</TableHead>
                  <TableHead>Host Worker</TableHead>
                  <TableHead>Service Status</TableHead>
                  <TableHead>Internet Link</TableHead>
                  <TableHead>Public IP</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allProxies.map(proxy => (
                  <TableRow key={`${proxy.workerId}-${proxy.id}`}>
                    <TableCell className="font-medium">
                      {proxy.interfaceName}
                      <div className="text-[10px] text-muted-foreground">{proxy.iccid?.slice(0, 10)}...</div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{proxy.workerId}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${proxy.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        <span className="text-sm font-medium">{proxy.status === 'ONLINE' ? 'UP' : 'DOWN'}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={proxy.ipAddress ? 'default' : 'destructive'} className="text-[10px]">
                        {proxy.ipAddress ? 'CONNECTED' : 'NO INTERNET'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {proxy.ipAddress || '---'}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="icon" variant="ghost" title="Refresh IP" onClick={() => sendCommand(proxy.workerId, proxy.id, 'ROTATE_IP')}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" title="Reboot Modem" className="text-red-400 hover:text-red-500 hover:bg-red-500/10" onClick={() => sendCommand(proxy.workerId, proxy.id, 'REBOOT')}>
                        <Power className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </main>
  );
}
