import { useState } from "react";
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
import { Edit3 } from "lucide-react";

interface Props {
    workerId: string;
    currentName: string;
    currentIp: string;
    currentPort: number;
    onUpdated: (w: { id: string; name: string; ip: string; port: number }) => void;
}

export function WorkerEditDialog({ workerId, currentName, currentIp, currentPort, onUpdated }: Props) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({ name: currentName, ip: currentIp, port: String(currentPort) });
    const [error, setError] = useState<string | null>(null);

    const validateHost = (host: string) => {
        if (!host) return false;
        if (/^https?:\/\//i.test(host)) return false;
        if (/[\s/]/.test(host)) return false;
        if (host === "localhost") return true;
        const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
        const hostname = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
        if (ipv4.test(host)) {
            return host.split('.').every(part => {
                const num = parseInt(part, 10);
                return num >= 0 && num <= 255;
            });
        }
        return hostname.test(host);
    };

    const handleSubmit = async () => {
        setError(null);
        if (!form.name.trim()) {
            setError("Nom requis.");
            return;
        }
        if (!validateHost(form.ip)) {
            setError("Hôte invalide (IP ou domaine, sans http://).");
            return;
        }
        const portNum = parseInt(form.port, 10);
        if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
            setError("Port invalide.");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch(`/api/control/workers/${workerId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: form.name.trim(), ip: form.ip.trim(), port: portNum })
            });
            const data = await res.json();
            if (res.ok) {
                onUpdated(data);
                setOpen(false);
            } else {
                setError(data.error || "Erreur lors de la mise à jour.");
            }
        } catch (e) {
            setError("Erreur réseau.");
        } finally {
            setLoading(false);
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
                    <DialogTitle>Éditer le worker</DialogTitle>
                    <DialogDescription>Met à jour le nom, l’IP ou le port.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Nom</Label>
                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                        <Label>Hôte (IP/Domaine)</Label>
                        <Input value={form.ip} onChange={e => setForm({ ...form, ip: e.target.value })} />
                    </div>
                    <div className="grid gap-2">
                        <Label>Port</Label>
                        <Input type="number" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} />
                    </div>
                    {error && <p className="text-sm text-red-500">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
                    <Button onClick={handleSubmit} disabled={loading}>{loading ? "Enregistrement..." : "Enregistrer"}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
