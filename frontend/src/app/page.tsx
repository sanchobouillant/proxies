"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ProxyWorker } from "@proxy-farm/shared";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignalStrength } from "@/components/proxy/SignalStrength";
import { UnlockSimDialog } from "@/components/proxy/UnlockSimDialog";
import { CopyProxyButton } from "@/components/proxy/CopyProxyButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SimUnlockDialog } from '@/components/management/SimUnlockDialog';
import { TestProxyDialog } from '@/components/management/TestProxyDialog';
import {
  Server,
  Activity,
  Settings as SettingsIcon,
  Wifi,
  WifiOff,
  Database,
  RefreshCw,
  Power,
  Play,
  Square,
  History,
  Info,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Plus,
  Link2,
  User,
  Users,
  LogOut,
  ZapOff,
  Globe
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AddWorkerDialog } from "@/components/management/AddWorkerDialog";
import Link from "next/link";
import { AddProxyDialog } from "@/components/management/AddProxyDialog";
import { RegenerateKeyDialog } from "@/components/management/RegenerateKeyDialog";
import { ProxyLogsDialog } from "@/components/management/ProxyLogsDialog";
import { EventLogViewer } from "@/components/dashboard/EventLogViewer";
import { EventLogDialog } from "@/components/management/EventLogDialog";
import { ProxyEditDialog } from "@/components/management/ProxyEditDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRouter } from "next/navigation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkerInfoDialog } from "@/components/management/WorkerInfoDialog";
import { SettingsDialog } from "@/components/management/SettingsDialog";
import Image from "next/image";
import mascot from "@/../public/mascot.png";
import { WorkerEditDialog } from "@/components/management/WorkerEditDialog";

let socket: Socket;

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 10
    }
  }
} as any;

// Extended type to include DB fields
interface UIWorker extends ProxyWorker {
  // name is now inherited from ProxyWorker
  proxies?: any[]; // From DB (Prisma Proxy type)
}

export default function Dashboard() {
  const router = useRouter();
  const [workers, setWorkers] = useState<UIWorker[]>([]);
  const [connected, setConnected] = useState(false);
  const [selectedProxy, setSelectedProxy] = useState<any | null>(null);
  const [viewingLogs, setViewingLogs] = useState<{ id: string, name: string } | null>(null);
  const [viewingWorkerInfo, setViewingWorkerInfo] = useState<UIWorker | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testProxy, setTestProxy] = useState<any | null>(null);
  const [unlockSim, setUnlockSim] = useState<{ workerId: string, modemId: string } | null>(null);
  const [balancerIp, setBalancerIp] = useState<string>("");
  const [user, setUser] = useState<{ username: string; email: string; role: string } | null>(null);

  const handleLogout = async () => {

    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  };

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok && r.json()).then(d => d?.user && setUser(d.user)).catch(() => { });

    // Check global settings
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.balancer_ip) {
          setBalancerIp(data.balancer_ip);
        } else {
          // No configuration found, trigger setup wizard
          setSettingsOpen(true);
        }
      })
      .catch(err => console.error("Failed to fetch settings", err));
  }, []);

  useEffect(() => {
    // 1. Fetch initial list from DB
    const fetchWorkers = async () => {
      try {
        const res = await fetch('/api/control/workers');
        if (res.ok) {
          const dbWorkers = await res.json();
          setWorkers(prev => {
            const initialMap = new Map<string, UIWorker>();
            dbWorkers.forEach((w: any) => {
              initialMap.set(w.id, {
                id: w.id,
                ip: w.ip,
                status: w.status,
                modems: [],
                lastSeen: new Date(w.lastSeen),
                name: w.name,
                proxies: w.proxies
              });
            });
            return Array.from(initialMap.values());
          });
        }
      } catch (e) {
        console.error("Failed to fetch workers", e);
      }
    };

    fetchWorkers();

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || (typeof window !== 'undefined' ? window.location.origin : undefined);
    socket = io(socketUrl, {
      query: { role: 'dashboard' }
    });

    socket.on("connect", () => {
      setConnected(true);
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("state_update", (data: ProxyWorker[]) => {
      setWorkers(prev => {
        const map = new Map(prev.map(w => [w.id, w]));

        data.forEach(updated => {
          const existing = map.get(updated.id);
          if (existing) {
            // Merge, keeping the DB name and proxies
            map.set(updated.id, {
              ...updated,
              name: existing.name,
              proxies: existing.proxies // Preserve DB proxies
            });
          } else {
            // New worker from socket not in DB list?
            map.set(updated.id, updated);
          }
        });

        return Array.from(map.values());
      });
    });

    socket.on("settings_updated", (data: any) => {
      if (data.balancer_ip) setBalancerIp(data.balancer_ip);
    });

    return () => {
      socket.off("settings_updated");
      socket.disconnect();
    };
  }, []);

  const sendCommand = (workerId: string, modemId: string, command: string, data?: any) => {
    if (!socket) {
      console.error("Socket not connected");
      return;
    }
    socket.emit("ui_command", { workerId, modemId, command, data });
  };

  const refreshWorkers = async () => {
    // Re-fetch to update names/proxies if added
    try {
      const res = await fetch('/api/control/workers');
      if (res.ok) {
        const dbWorkers = await res.json();
        setWorkers(prev => {
          const map = new Map(prev.map(w => [w.id, w]));
          dbWorkers.forEach((w: any) => {
            const existing = map.get(w.id);
            if (existing) {
              map.set(w.id, { ...existing, name: w.name, proxies: w.proxies });
            } else {
              // If it's offline but in DB, add it
              map.set(w.id, {
                id: w.id,
                ip: w.ip,
                status: w.status,
                modems: [],
                lastSeen: new Date(w.lastSeen),
                name: w.name,
                proxies: w.proxies
              });
            }
          });
          return Array.from(map.values());
        });
      }
    } catch (e) { console.error(e); }
  };

  const deleteWorker = async (workerId: string) => {
    if (!confirm("Delete this worker? All its proxies will be removed.")) return;
    try {
      const res = await fetch(`/api/control/workers/${workerId}`, { method: 'DELETE' });
      if (res.ok) {
        setWorkers(prev => prev.filter(w => w.id !== workerId));
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete worker');
      }
    } catch (e) {
      alert('Network error deleting worker');
    }
  };

  return (
    <TooltipProvider>
      <motion.div
        className="min-h-screen bg-gray-50/50 dark:bg-zinc-950/50 p-6 md:p-12 space-y-12"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        <header className="border-b bg-white/50 dark:bg-zinc-950/50 backdrop-blur sticky top-0 z-50 mb-8">
          <div className="flex h-16 items-center px-6 justify-between">
            <div className="flex items-center gap-4">
              <div className="relative w-14 h-14 hover:scale-110 transition-transform cursor-pointer">
                <Image src={mascot} alt="Mascot" fill sizes="56px" className="object-contain drop-shadow-sm" priority />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
                  Proxy Farm
                </h1>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                  <span className="text-xs font-medium text-zinc-500">{connected ? 'System Online' : 'Offline'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Primary Actions */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Settings
                </Button>
                <AddWorkerDialog onWorkerAdded={refreshWorkers} />
                <AddProxyDialog workers={workers} onProxyAdded={refreshWorkers} />
              </div>

              {/* Vertical Separator */}
              <div className="h-8 w-[1px] bg-zinc-200 dark:bg-zinc-800" />

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                    <Avatar className="h-10 w-10 border-2 border-white dark:border-zinc-900 shadow-sm">
                      <AvatarImage src={`https://api.dicebear.com/7.x/notionists/svg?seed=${user?.username}`} alt={user?.username} />
                      <AvatarFallback className="bg-blue-600 text-white font-bold">
                        {user?.username?.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user?.username}</p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user?.email || 'No email set'}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <Link href="/profile">
                      <DropdownMenuItem className="cursor-pointer">
                        <User className="mr-2 h-4 w-4" />
                        <span>Profile</span>
                      </DropdownMenuItem>
                    </Link>
                    <Link href="/admin/users">
                      <DropdownMenuItem className="cursor-pointer">
                        <Users className="mr-2 h-4 w-4" />
                        <span>Manage Users</span>
                      </DropdownMenuItem>
                    </Link>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600 dark:text-red-400 cursor-pointer focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/20">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <motion.div className="max-w-[1800px] mx-auto space-y-8">

          <motion.div
            variants={itemVariants}
            className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6"
          >
            <AnimatePresence mode="popLayout">
              {workers.length === 0 ? (
                <motion.div
                  className="col-span-full py-32 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl bg-gray-50/50 dark:bg-zinc-900/50 backdrop-blur-sm"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <RefreshCw className="w-16 h-16 text-gray-300 dark:text-zinc-700 mb-6 animate-spin-slow" />
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">No workers found</h3>
                  <p className="text-gray-500 dark:text-zinc-400 max-w-md mx-auto">
                    Add a new worker to get started.
                  </p>
                </motion.div>
              ) : (
                workers.map((worker) => (
                  <motion.div
                    key={worker.id}
                    variants={itemVariants}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <Card className="overflow-hidden border-0 shadow-lg hover:shadow-xl transition-shadow duration-300 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md ring-1 ring-gray-200/50 dark:ring-zinc-800/50 h-full flex flex-col">
                      <div className="p-6 flex-1 flex flex-col gap-6">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              {worker.status === 'ONLINE' && (
                                <span className="flex h-2.5 w-2.5 relative">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                              )}
                              <h2 className="font-bold text-xl text-gray-900 dark:text-white tracking-tight">{worker.name || worker.id}</h2>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {(worker.health?.undervoltageDetected) && (
                              <span title="Power Supply Issue: Undervoltage Detected">
                                <ZapOff className="w-5 h-5 text-red-500 animate-pulse" />
                              </span>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400"
                                  onClick={() => setViewingWorkerInfo(worker)}
                                >
                                  <Info className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Worker Information</p>
                              </TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                                  onClick={() => setViewingLogs({ id: worker.id, name: worker.name || 'Worker ' + worker.id })}
                                >
                                  <History className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>View Worker History</p>
                              </TooltipContent>
                            </Tooltip>

                            <RegenerateKeyDialog workerId={worker.id} workerName={worker.name || 'Unknown Worker'} />
                            <WorkerEditDialog
                              workerId={worker.id}
                              currentName={worker.name || ''}
                              currentIp={worker.ip || ''}
                              currentPort={worker.port || 3001}
                              onUpdated={(w) => {
                                setWorkers(prev => prev.map(p => p.id === w.id ? { ...p, name: w.name, ip: w.ip, port: w.port } : p));
                              }}
                              onDelete={async () => await deleteWorker(worker.id)}
                            />
                            <Badge variant="outline" className={worker.status === 'ONLINE' ? "bg-emerald-50/50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800" : "bg-gray-100 text-gray-500"}>
                              {worker.status || 'OFFLINE'}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-4 flex-1">
                          {(() => {
                            // 1. Map all Proxies first (they are the primary entities)
                            const renderedProxyIds = new Set<string>();
                            const proxies = worker.proxies || [];

                            const proxyCards = proxies.map(proxy => {
                              renderedProxyIds.add(proxy.id);
                              // Try to find the linked modem
                              // We support both ID match (new) and Interface Name match (legacy/fallback)
                              const modem = worker.modems?.find(m => m.id === proxy.modemId || (m as any).interfaceName === proxy.modemId);

                              const isDetached = !modem;
                              const hasInternet = modem?.status === 'ONLINE' && !!(modem as any).ipAddress;
                              const isLocked = modem?.simStatus === 'LOCKED';
                              const isError = modem?.simStatus === 'ERROR';
                              const isProxyRunning = modem && (
                                (modem as any).proxyStatus === 'ACTIVE' ||
                                ((modem as any).proxyPort === proxy.port)
                              );

                              // Determine Status Color
                              let cardBg = "bg-gray-50/80 dark:bg-zinc-950/50";
                              let ringColor = "ring-gray-100 dark:ring-zinc-800";

                              if (isDetached || !hasInternet || isLocked || isError) {
                                // Pale Red for any "Down" state
                                cardBg = "bg-red-50/50 dark:bg-red-900/10";
                                ringColor = "ring-red-100 dark:ring-red-900/30";
                              } else if (isProxyRunning) {
                                cardBg = "bg-emerald-50/30 dark:bg-emerald-900/10";
                                ringColor = "ring-emerald-100 dark:ring-emerald-900/30";
                              }

                              return (
                                <div key={proxy.id} className={`${cardBg} rounded-xl p-4 ring-1 ${ringColor} transition-all hover:bg-gray-100/80 dark:hover:bg-zinc-900/80 space-y-4`}>

                                  {/* HEADER: Name + Status/Edit Toolbar */}
                                  <div className="flex items-start justify-between">
                                    <div className="flex flex-col gap-0.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                                          {proxy.name}
                                        </span>
                                      </div>
                                      <div className="text-[11px] text-gray-500 font-medium truncate max-w-[120px]" title={(modem as any)?.operator}>
                                        {(modem as any)?.operator || 'Unknown Network'}
                                      </div>
                                    </div>

                                    {/* Right Toolbar */}
                                    <div className="flex items-center gap-1.5 bg-white/40 dark:bg-black/20 p-1 rounded-lg border border-gray-100 dark:border-zinc-800">
                                      {/* Signal */}
                                      {modem && (
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 border-r border-gray-200 dark:border-zinc-700">
                                          <SignalStrength quality={modem.signalQuality || 0} />
                                        </div>
                                      )}

                                      {/* Status Badge */}
                                      {/* Status Badge with Popover */}
                                      <Popover>
                                        <PopoverTrigger>
                                          <div className="cursor-help flex items-center p-1 hover:bg-gray-100 dark:hover:bg-zinc-800 rounded">
                                            {isDetached ? (
                                              <div className="w-2 h-2 rounded-full bg-red-400"></div>
                                            ) : isProxyRunning ? (
                                              <div className="flex items-center gap-1.5 px-1.5">
                                                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)] animate-pulse"></div>
                                              </div>
                                            ) : hasInternet ? (
                                              <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                                            ) : (
                                              <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div>
                                            )}
                                          </div>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-60 text-xs p-3" align="end">
                                          <div className="font-semibold mb-1">Status Information</div>
                                          {isDetached ? (
                                            <p>Modem not detected. Check USB connection.</p>
                                          ) : isProxyRunning ? (
                                            <p className="text-emerald-500">Proxy is ACTIVE and running.</p>
                                          ) : hasInternet ? (
                                            <p>Stopped. Ready to start.</p>
                                          ) : (
                                            <p className="text-orange-500">Disconnected/No Internet. Check APN, Signal or SIM.</p>
                                          )}
                                        </PopoverContent>
                                      </Popover>

                                      {/* Edit Button */}
                                      <div className="pl-1 border-l border-gray-200 dark:border-zinc-700">
                                        <ProxyEditDialog
                                          proxy={proxy}
                                          worker={worker as any}
                                          onUpdated={(p) => {
                                            setWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, proxies: (w.proxies || []).map((pr: any) => pr.id === p.id ? { ...pr, ...p } : pr) } : w));
                                          }}
                                          onDeleted={(id) => {
                                            setWorkers(prev => prev.map(w => w.id === worker.id ? { ...w, proxies: (w.proxies || []).filter((pr: any) => pr.id !== id) } : w));
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>

                                  {/* INFO BLOCK: Address & IP */}
                                  <div className="bg-white/60 dark:bg-black/20 rounded-lg p-2.5 space-y-2 border border-black/5 dark:border-white/5">

                                    {/* Proxy Address */}
                                    <div className="flex items-start gap-2.5">
                                      <div className="p-1 rounded bg-blue-50/50 dark:bg-blue-900/10 text-blue-500 mt-0.5 shrink-0">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[10px] uppercase text-gray-400 font-semibold tracking-wider mb-0.5">Proxy Address</div>
                                        <div className="font-mono text-[11px] text-gray-700 dark:text-gray-300 break-all leading-tight">
                                          socks5://{(balancerIp || (typeof window !== 'undefined' ? window.location.hostname : 'localhost')).split(':')[0]}:{proxy.port}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="h-px bg-gray-100/50 dark:bg-zinc-800/50 w-full" />

                                    {/* IP Address */}
                                    <div className="flex items-start gap-2.5">
                                      <div className="p-1 rounded bg-purple-50/50 dark:bg-purple-900/10 text-purple-500 mt-0.5 shrink-0">
                                        <Globe className="w-3.5 h-3.5" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[10px] uppercase text-gray-400 font-semibold tracking-wider mb-0.5">Public IP</div>
                                        <div className="font-mono text-[11px] text-gray-700 dark:text-gray-300">
                                          {(modem as any)?.ipAddress || '---'}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Errors/Locks inline if present */}
                                    {(isLocked || isError) && (
                                      <div className="pt-1 flex gap-2">
                                        {isLocked && (
                                          <Badge
                                            variant="outline"
                                            className="text-orange-600 bg-orange-50 border-orange-200 h-5 px-1.5 gap-1 cursor-pointer hover:bg-orange-100"
                                            onClick={() => modem && setUnlockSim({ workerId: worker.id, modemId: modem.id })}
                                          >
                                            <Lock className="w-3 h-3" /> Unlock SIM
                                          </Badge>
                                        )}
                                        {isError && <Badge variant="destructive" className="h-5 px-1.5 gap-1"><AlertTriangle className="w-3 h-3" /> Error</Badge>}
                                      </div>
                                    )}

                                  </div>



                                  <div className="grid grid-cols-4 gap-2">
                                    <CopyProxyButton
                                      proxy={proxy}
                                      balancerIp={balancerIp}
                                      workerIp={worker.ip}
                                      modem={modem}
                                    />

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full h-8 text-xs font-medium border-gray-200 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 transition-colors text-blue-600 dark:text-blue-400 hover:text-blue-700"
                                          onClick={() => setTestProxy(proxy)}
                                        >
                                          <Activity className="w-3 h-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Test Proxy</p>
                                      </TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full h-8 text-xs font-medium border-gray-200 dark:border-zinc-700"
                                          onClick={() => modem && sendCommand(worker.id, modem.id, 'REBOOT')}
                                          disabled={!modem}
                                        >
                                          <RefreshCw className="w-3 h-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Restart Modem</p>
                                      </TooltipContent>
                                    </Tooltip>

                                    {/* Start/Stop Button */}
                                    {/* ... existing start/stop button ... */}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className={`w-full h-8 text-xs font-medium border-gray-200 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800 transition-colors ${!isProxyRunning ? 'text-green-600 dark:text-green-400 hover:text-green-700' : 'text-orange-600 dark:text-orange-400 hover:text-orange-700'}`}
                                          onClick={() => modem && sendCommand(worker.id, modem.id, !isProxyRunning ? 'START_PROXY' : 'STOP_PROXY', { id: proxy.id, proxyPort: proxy.port })}
                                          disabled={!modem}
                                        >
                                          {!isProxyRunning ? (
                                            <Play className="w-3 h-3" />
                                          ) : (
                                            <Square className="w-3 h-3" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>{!isProxyRunning ? 'Start Proxy' : 'Stop Proxy'}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                </div>
                              );
                            });
                            return proxyCards;
                          })()}
                        </div >
                      </div >
                    </Card >
                  </motion.div >
                ))
              )}
            </AnimatePresence >
          </motion.div >

          <ProxyLogsDialog
            open={!!selectedProxy}
            onOpenChange={(open) => !open && setSelectedProxy(null)}
            proxy={selectedProxy}
          />

          <EventLogDialog
            open={!!viewingLogs}
            onOpenChange={(open) => !open && setViewingLogs(null)}
            entityId={viewingLogs?.id || null}
            entityName={viewingLogs?.name}
          />


          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            required={!balancerIp}
          />
          <WorkerInfoDialog
            open={!!viewingWorkerInfo}
            onOpenChange={(open) => !open && setViewingWorkerInfo(null)}
            worker={viewingWorkerInfo}
          />

        </motion.div >
      </motion.div >
    </TooltipProvider >
  );
}
