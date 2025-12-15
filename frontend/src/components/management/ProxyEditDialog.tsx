import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit3, Trash2 } from "lucide-react";
import { ProxyWorker } from "@proxy-farm/shared";

interface ProxyEditDialogProps {
    proxy: any;
    worker: ProxyWorker & { proxies?: any[] };
    onUpdated: (proxy: any) => void;
    onDeleted: (id: string) => void;
}

export function ProxyEditDialog({ proxy, worker, onUpdated, onDeleted }: ProxyEditDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        name: proxy.name,
        port: String(proxy.port),
        authUser: proxy.authUser || "",
        authPass: proxy.authPass || "",
        modemId: proxy.modemId,
        protocol: proxy.protocol || "SOCKS5",
        apn: proxy.apn || ""
    });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm({
            name: proxy.name,
            port: String(proxy.port),
            authUser: proxy.authUser || "",
            authPass: proxy.authPass || "",
            modemId: proxy.modemId,
            protocol: proxy.protocol || "SOCKS5",
            apn: proxy.apn || ""
        });
    }, [proxy]);

    const handleSave = async () => {
        setError(null);
        const portNum = parseInt(form.port, 10);
        if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
            setError("Port invalide");
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`/api/control/proxies/${proxy.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.name,
                    port: portNum,
                    authUser: form.authUser || null,
                    authPass: form.authPass || null,
                    modemId: form.modemId,
                    workerId: worker.id,
                    protocol: form.protocol,
                    apn: form.apn || null
                })
            });
            const data = await res.json();
            if (res.ok) {
                onUpdated(data);
                setOpen(false);
            } else {
                setError(data.error || "Échec de la mise à jour");
            }
        } catch (e) {
            setError("Erreur réseau");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!confirm("Supprimer ce proxy ?")) return;
        try {
            const res = await fetch(`/api/control/proxies/${proxy.id}`, { method: "DELETE" });
            if (res.ok) {
                onDeleted(proxy.id);
                setOpen(false);
            } else {
                const data = await res.json();
                alert(data.error || "Suppression échouée");
            }
        } catch (e) {
            alert("Erreur réseau");
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                    <Edit3 className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Éditer le proxy</DialogTitle>
                    <DialogDescription>Mets à jour le nom, le port, l’auth et l’interface modem.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 py-2">
                    <div className="grid gap-2">
                        <Label>Nom</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                        <Label>Port</Label>
                        <Input type="number" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                        <Label>Interface modem</Label>
                        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                            {worker.modems?.map((m: any) => {
                                const selected = form.modemId === m.id;
                                return (
                                    <button
                                        key={m.id}
                                        type="button"
                                        className={`border rounded-md p-2 text-sm text-left ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
                                        onClick={() => setForm({ ...form, modemId: m.id })}
                                    >
                                        <div className="font-medium">{m.interfaceName || m.id}</div>
                                        <div className="text-xs text-gray-500">{m.id}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label>Protocol</Label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${form.protocol === 'SOCKS5' ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-white dark:bg-zinc-950 border-gray-200 dark:border-zinc-800 hover:bg-gray-50'}`}
                                onClick={() => setForm({ ...form, protocol: 'SOCKS5' })}
                            >
                                SOCKS5
                            </button>
                            <button
                                type="button"
                                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${form.protocol === 'HTTP' ? 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400' : 'bg-white dark:bg-zinc-950 border-gray-200 dark:border-zinc-800 hover:bg-gray-50'}`}
                                onClick={() => setForm({ ...form, protocol: 'HTTP' })}
                            >
                                HTTP
                            </button>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="apn">APN (Access Point Name)</Label>
                        <Input
                            id="apn"
                            value={form.apn || ''}
                            onChange={(e) => setForm({ ...form, apn: e.target.value })}
                            placeholder="e.g. orange"
                        />
                        <div className="flex flex-wrap gap-1.5 mt-1">
                            {['orange', 'free', 'sl2sfr', 'mmsbouygtel.com', 'internet'].map(apn => (
                                <span
                                    key={apn}
                                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900 cursor-pointer hover:border-blue-300 hover:text-blue-600 transition-colors"
                                    onClick={() => setForm({ ...form, apn: apn })}
                                >
                                    {apn}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>User</Label>
                            <Input value={form.authUser} onChange={e => setForm({ ...form, authUser: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label>Password</Label>
                            <Input value={form.authPass} onChange={e => setForm({ ...form, authPass: e.target.value })} />
                        </div>
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                </div>

                <DialogFooter className="flex justify-between">
                    <Button variant="destructive" onClick={handleDelete} className="mr-auto">
                        <Trash2 className="h-4 w-4 mr-2" /> Supprimer
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
                        <Button onClick={handleSave} disabled={loading}>{loading ? "Enregistrement..." : "Enregistrer"}</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
