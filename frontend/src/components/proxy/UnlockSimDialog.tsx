"use client"

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
import { Lock } from "lucide-react";
import { useState } from "react";

interface UnlockSimDialogProps {
    modemId: string;
    onUnlock: (pin: string) => void;
}

export function UnlockSimDialog({ modemId, onUnlock }: UnlockSimDialogProps) {
    const [pin, setPin] = useState("");
    const [open, setOpen] = useState(false);

    const handleUnlock = () => {
        onUnlock(pin);
        setOpen(false);
        setPin("");
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2">
                    <Lock size={14} /> Unlock SIM
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Unlock SIM Card</DialogTitle>
                    <DialogDescription>
                        The SIM card for modem {modemId} is locked. Please enter the PIN code.
                        It will be saved safely for auto-unlocking.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="pin" className="text-right">
                            PIN Code
                        </Label>
                        <Input
                            id="pin"
                            type="password"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="col-span-3"
                            placeholder="1234"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleUnlock}>Unlock</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
