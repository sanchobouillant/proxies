import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Copy, Check, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function AddWorkerDialog({ onWorkerAdded }: { onWorkerAdded: () => void }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        ip: "",
        port: "3000"
    });

    // State for the generated key
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const validateHost = (host: string) => {
        if (!host) return false;
        if (/^https?:\/\//i.test(host)) return false; // no protocol
        if (/[\s/]/.test(host)) return false; // no spaces/slashes
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!formData.name.trim()) {
            setError("Worker name is required.");
            return;
        }
        if (!validateHost(formData.ip)) {
            setError("Host invalide : utilisez une IP ou un nom de domaine sans http://");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/control/worker", {
                method: "POST",
                body: JSON.stringify(formData),
            });
            const data = await res.json();

            if (res.ok && data.apiKey) {
                // Success: Show the key
                setGeneratedKey(data.apiKey);
                onWorkerAdded();
            } else {
                setError(data.error || "Failed to add worker. Please try again.");
            }
        } catch (err) {
            console.error(err);
            setError("Network error occurred. Please check your connection.");
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (generatedKey) {
            navigator.clipboard.writeText(generatedKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleClose = () => {
        setOpen(false);
        setGeneratedKey(null);
        setFormData({ name: "", ip: "", port: "3000" });
        setCopied(false);
        setError(null);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => { if (!val) handleClose(); else setOpen(val); }}>
            <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/20">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Worker
                </Button>
            </DialogTrigger>

            {generatedKey ? (
                <DialogContent className="sm:max-w-[500px] border-zinc-800 bg-zinc-950">
                    <DialogHeader>
                        <DialogTitle className="text-green-500 flex items-center gap-2">
                            <Check className="w-5 h-5" /> Worker Registered
                        </DialogTitle>
                        <DialogDescription className="text-zinc-400">
                            The dashboard has pushed this Security Key to the worker automatically. Keep this key in case you need to set it manually in <code>config.json</code> under <code>sharedKey</code>.
                            <br />
                            <span className="text-red-400 font-bold block mt-2">
                                Warning: You will not be able to see this key again.
                            </span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="relative mt-4 group">
                        <div className="p-4 bg-zinc-900 rounded-md border border-zinc-700 font-mono text-xs text-zinc-300 break-all pr-10">
                            {generatedKey}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 hover:bg-zinc-800 text-zinc-400 hover:text-white"
                            onClick={copyToClipboard}
                        >
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                    </div>

                    <DialogFooter>
                        <Button onClick={handleClose} className="w-full mt-4">
                            I have copied the key
                        </Button>
                    </DialogFooter>
                </DialogContent>
            ) : (
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Register New Worker</DialogTitle>
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
                            <Label htmlFor="name">Worker Name</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="My Home Worker"
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="ip">IP Address</Label>
                                <Input
                                    id="ip"
                                    value={formData.ip}
                                    onChange={(e) => setFormData({ ...formData, ip: e.target.value })}
                                placeholder="192.168.1.10 ou worker.example.com"
                                    required
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="port">Port</Label>
                                <Input
                                    id="port"
                                    value={formData.port}
                                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                                    required
                                    type="number"
                                />
                            </div>
                        </div>
                        {/* No API Key input anymore - generated by server */}
                        <Button type="submit" disabled={loading}>
                            {loading ? "Generating Key..." : "Register Worker"}
                        </Button>
                    </form>
                </DialogContent>
            )}
        </Dialog>
    );
}
