
import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface SettingsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    required?: boolean;
}

export function SettingsDialog({ open, onOpenChange, required = false }: SettingsDialogProps) {
    const [loading, setLoading] = useState(false);
    const [balancerIp, setBalancerIp] = useState("");

    useEffect(() => {
        if (open) {
            fetchSettings();
        }
    }, [open]);

    const fetchSettings = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/settings');
            if (res.ok) {
                const data = await res.json();
                setBalancerIp(data.balancer_ip || "");
            }
        } catch (error) {
            console.error("Failed to fetch settings", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!balancerIp) return; // Basic validation
        setLoading(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'balancer_ip', value: balancerIp })
            });

            if (res.ok) {
                onOpenChange(false);
            }
        } catch (error) {
            console.error("Failed to save settings", error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={required ? () => { } : onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{required ? "Welcome! Initial Setup" : "Global Settings"}</DialogTitle>
                    <DialogDescription>
                        {required
                            ? "Please configure the Balancer IP address to continue."
                            : "Configure global parameters for the proxy farm."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="balancer-ip" className="text-right">
                            Balancer IP
                        </Label>
                        <Input
                            id="balancer-ip"
                            value={balancerIp}
                            onChange={(e) => setBalancerIp(e.target.value)}
                            placeholder="1.2.3.4 or example.com"
                            className="col-span-3"
                        />
                    </div>
                </div>
                <DialogFooter>
                    {!required && (
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                    )}
                    <Button type="button" onClick={handleSave} disabled={loading || (required && !balancerIp)}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {required ? "Complete Setup" : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
