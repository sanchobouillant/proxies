
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Signal, WifiOff, Lock, AlertTriangle, ShieldCheck } from "lucide-react";

interface WorkerInfoDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    worker: any; // Using simplified type for now or import proper one
}

export function WorkerInfoDialog({ open, onOpenChange, worker }: WorkerInfoDialogProps) {
    if (!worker) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <DialogTitle className="text-xl">Worker Details: {worker.name || worker.id}</DialogTitle>
                        <Badge variant={worker.status === 'ONLINE' ? 'default' : 'destructive'}>
                            {worker.status}
                        </Badge>
                    </div>
                    <DialogDescription>
                        {worker.ip} • ID: {worker.id}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-auto pr-2">
                    <h3 className="font-semibold mb-3 mt-4 text-sm uppercase tracking-wider text-gray-500">Available Interfaces</h3>
                    <div className="space-y-4">
                        {worker.modems && worker.modems.length > 0 ? (
                            worker.modems.map((modem: any) => {
                                const matchedProxy = worker.proxies?.find((p: any) => p.modemInterface === modem.id);
                                const hasInternet = modem.status === 'ONLINE' && !!modem.ipAddress;

                                return (
                                    <div key={modem.id} className="p-4 rounded-lg border bg-card text-card-foreground shadow-sm">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline" className="font-mono">
                                                    {modem.id}
                                                </Badge>
                                                <span className="text-sm text-muted-foreground">({modem.interfaceName})</span>
                                            </div>
                                            {matchedProxy ? (
                                                <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                    <ShieldCheck className="w-3 h-3 mr-1" />
                                                    Linked to: {matchedProxy.name}
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-gray-400">
                                                    Unused
                                                </Badge>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div>
                                                <p className="text-muted-foreground text-xs">Operator</p>
                                                <p className="font-medium">{modem.operator || 'Unknown'}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground text-xs">IP Address</p>
                                                <p className="font-mono">{modem.ipAddress || '---'}</p>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground text-xs">Signal</p>
                                                <div className="flex items-center gap-1">
                                                    <Signal className="w-3 h-3" />
                                                    <span>{modem.signalQuality || 0}%</span>
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-muted-foreground text-xs">Status</p>
                                                <div className="flex items-center gap-1">
                                                    {modem.simStatus === 'LOCKED' && <Lock className="w-3 h-3 text-orange-500" />}
                                                    {modem.simStatus === 'ERROR' && <AlertTriangle className="w-3 h-3 text-red-500" />}
                                                    {!hasInternet ? <WifiOff className="w-3 h-3 text-red-500" /> : <span className="text-green-600">Connected</span>}
                                                </div>
                                            </div>
                                            {modem.iccid && (
                                                <div className="col-span-2">
                                                    <p className="text-muted-foreground text-xs">ICCID</p>
                                                    <p className="font-mono text-xs text-gray-600 dark:text-gray-400">{modem.iccid}</p>
                                                </div>
                                            )}
                                            {modem.imei && (
                                                <div className="col-span-2">
                                                    <p className="text-muted-foreground text-xs">IMEI</p>
                                                    <p className="font-mono text-xs text-gray-600 dark:text-gray-400">{modem.imei}</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 text-muted-foreground">
                                No modems detected on this worker.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
