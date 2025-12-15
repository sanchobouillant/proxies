
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Unlock } from "lucide-react";

interface SimUnlockDialogProps {
    workerId: string;
    modemId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => void;
}

export function SimUnlockDialog({ workerId, modemId, open, onOpenChange, onSuccess }: SimUnlockDialogProps) {
    const [pin, setPin] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleUnlock = async () => {
        if (!pin) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/control/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workerId,
                    modemId,
                    command: 'UNLOCK_SIM',
                    payload: { pin }
                })
            });

            if (!res.ok) throw new Error('Failed to send unlock command');

            // Assume success if command sent. 
            // Ideally we'd wait for status update, but user will see 'SIM Locked' disappear eventually.
            onOpenChange(false);
            if (onSuccess) onSuccess();
        } catch (e) {
            setError("Failed to unlock SIM. Check connection.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>Unlock SIM Card</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    <p className="text-sm text-muted-foreground">
                        This SIM card requires a PIN code to function. Please enter it below.
                    </p>
                    <div className="space-y-2">
                        <Label>PIN Code</Label>
                        <Input
                            type="password"
                            placeholder="0000"
                            value={pin}
                            onChange={e => setPin(e.target.value)}
                            maxLength={8}
                        />
                    </div>
                    {error && <div className="text-sm text-red-500">{error}</div>}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleUnlock} disabled={loading || !pin.length}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Unlock SIM
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
