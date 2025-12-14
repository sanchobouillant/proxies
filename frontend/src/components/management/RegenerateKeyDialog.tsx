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
import { RefreshCw, Key, Copy, Check } from "lucide-react";

interface RegenerateKeyDialogProps {
    workerId: string;
    workerName: string;
}

export function RegenerateKeyDialog({ workerId, workerName }: RegenerateKeyDialogProps) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [newKey, setNewKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const handleRegenerate = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/control/workers/${workerId}/regenerate-key`, {
                method: "POST",
            });
            if (res.ok) {
                const data = await res.json();
                setNewKey(data.apiKey);
            } else {
                alert("Failed to regenerate key");
            }
        } catch (e) {
            console.error(e);
            alert("Error regenerating key");
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (newKey) {
            navigator.clipboard.writeText(newKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleClose = () => {
        setOpen(false);
        setNewKey(null);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Reset key
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Reset shared key</DialogTitle>
                    <DialogDescription>
                        Génère une nouvelle clé pour <strong>{workerName}</strong>. L&apos;ancienne clé s&apos;arrête immédiatement. Copie cette clé dans le <code>config.json</code> du worker (champ <code>sharedKey</code>).
                    </DialogDescription>
                </DialogHeader>

                {!newKey ? (
                    <DialogFooter className="sm:justify-end">
                        <Button variant="secondary" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleRegenerate} disabled={loading}>
                            {loading && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                            Regenerate Key
                        </Button>
                    </DialogFooter>
                ) : (
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>New API Key</Label>
                            <div className="flex items-center space-x-2">
                                <Input value={newKey} readOnly className="font-mono text-sm bg-zinc-50 dark:bg-zinc-900" />
                                <Button size="icon" onClick={copyToClipboard} variant="outline" className={copied ? "text-emerald-500 border-emerald-500" : ""}>
                                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground mt-2">
                                Copy this key and replace <code>sharedKey</code> in your worker&apos;s <code>config.json</code> file (only that field is needed).
                            </p>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleClose}>Done</Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
