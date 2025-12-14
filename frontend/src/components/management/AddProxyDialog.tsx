import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Server, AlertCircle } from "lucide-react";
import { ProxyWorker, Modem } from "@proxy-farm/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface AddProxyDialogProps {
    workers: ProxyWorker[];
    onProxyAdded?: () => void;
}

export function AddProxyDialog({ workers, onProxyAdded }: AddProxyDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedWorkerId, setSelectedWorkerId] = useState<string>("");
    const [formData, setFormData] = useState({
        name: "",
        modemInterface: "",
        port: "30001",
        authUser: "",
        authPass: "",
        protocol: "SOCKS5" // Added protocol state
    });

    const selectedWorker = workers.find(w => w.id === selectedWorkerId);

    // Reset error when dialog closes or opens
    useEffect(() => {
        if (!open) {
            setError(null);
            // Optionally reset form if desired, or keep it
        }
    }, [open]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!selectedWorkerId) {
            setError("Please select a worker first.");
            return;
        }

        if (!formData.name.trim()) {
            setError("Proxy Name is required.");
            return;
        }

        if (!formData.modemInterface) {
            setError("Please select a Modem Interface (click on one of the boxes below).");
            return;
        }

        const portNum = parseInt(formData.port);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            setError("Invalid Port number.");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/control/proxy", {
                method: "POST",
                body: JSON.stringify({
                    ...formData,
                    workerId: selectedWorkerId
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setOpen(false);
                onProxyAdded?.();
                setFormData({ name: "", modemInterface: "", port: "30001", authUser: "", authPass: "", protocol: "SOCKS5" });
            } else {
                setError(data.error || "Failed to create proxy");
            }
        } catch (err) {
            console.error(err);
            setError("Network error occurred.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="border-dashed">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Proxy
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Proxy</DialogTitle>
                </DialogHeader>

                {error && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Select Worker</Label>
                        <div className="grid grid-cols-2 gap-2">
                            {workers.map(worker => (
                                <div
                                    key={worker.id}
                                    className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedWorkerId === worker.id ? 'bg-blue-50 border-blue-500 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
                                    onClick={() => setSelectedWorkerId(worker.id)}
                                >
                                    <div className="font-medium text-sm">{worker.name || worker.id}</div>
                                    <div className="text-xs text-gray-500">{worker.ip}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {selectedWorker && (
                        <>
                            <div className="grid gap-2">
                                <Label>Select Interface</Label>
                                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                                    {selectedWorker.modems.map((modem: any) => {
                                        // Check if this modem interface is already used by a proxy in the DB
                                        // We check against ID first as it is the stable identifier
                                        const isUsed = (selectedWorker as any).proxies?.some((p: any) => p.modemInterface === modem.id || p.modemInterface === modem.interfaceName);
                                        return (
                                            <div
                                                key={modem.id}
                                                className={`border rounded-md p-2 text-sm cursor-pointer transition-colors ${isUsed
                                                    ? 'bg-gray-100 dark:bg-zinc-800 text-gray-400 cursor-not-allowed border-gray-200 dark:border-zinc-700'
                                                    : formData.modemInterface === modem.id
                                                        ? 'bg-green-50 border-green-500'
                                                        : 'hover:bg-gray-50 dark:hover:bg-zinc-800'
                                                    }`}
                                                onClick={() => !isUsed && setFormData({ ...formData, modemInterface: modem.id })}
                                            >
                                                <div className="flex justify-between items-center">
                                                    <span>{modem.interfaceName}</span>
                                                    {isUsed && <span className="text-[10px] bg-gray-200 dark:bg-zinc-700 px-1 rounded">USED</span>}
                                                </div>
                                                <span className="text-xs text-gray-400">({modem.id})</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="proxyName">Proxy Name</Label>
                                    <Input
                                        id="proxyName"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g. Instagram Proxy 1"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="proxyPort">External Port</Label>
                                    <Input
                                        id="proxyPort"
                                        value={formData.port}
                                        onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                                        placeholder="30001"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="authUser">Username</Label>
                                    <Input
                                        id="authUser"
                                        value={formData.authUser}
                                        onChange={(e) => setFormData({ ...formData, authUser: e.target.value })}
                                        placeholder="optional"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="authPass">Password</Label>
                                    <Input
                                        id="authPass"
                                        value={formData.authPass}
                                        onChange={(e) => setFormData({ ...formData, authPass: e.target.value })}
                                        placeholder="optional"
                                    />
                                </div>
                            </div>

                            <Button type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Launch Proxy"}
                            </Button>
                        </>
                    )}
                </form>
            </DialogContent>
        </Dialog>
    );
}
