
"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, Play } from "lucide-react";
import { Proxy } from "@prisma/client";

interface TestProxyDialogProps {
    proxy: Proxy;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function TestProxyDialog({ proxy, open, onOpenChange }: TestProxyDialogProps) {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ ip?: string; duration?: number; error?: string } | null>(null);

    const runTest = async () => {
        setLoading(true);
        setResult(null);
        try {
            const res = await fetch(`/api/proxies/${proxy.id}/test`, { method: "POST" });
            const data = await res.json();
            if (res.ok && data.success) {
                setResult({ ip: data.ip, duration: data.duration });
            } else {
                setResult({ error: data.error || "Test failed" });
            }
        } catch (e) {
            setResult({ error: "Network error" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Test Proxy: {proxy.name}</DialogTitle>
                </DialogHeader>

                <div className="py-6 flex flex-col items-center justify-center space-y-4">
                    {!result && !loading && (
                        <div className="text-muted-foreground text-center">
                            Click start to test connectivity via <br />
                            <span className="font-mono text-foreground">127.0.0.1:{proxy.port}</span>
                        </div>
                    )}

                    {loading && (
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <span className="text-sm text-muted-foreground">Connecting to external IP...</span>
                        </div>
                    )}

                    {result?.ip && (
                        <div className="flex flex-col items-center gap-2 text-green-500">
                            <CheckCircle className="h-10 w-10" />
                            <div className="text-center">
                                <div className="text-xl font-bold text-foreground">{result.ip}</div>
                                <div className="text-xs text-muted-foreground">{result.duration}ms</div>
                            </div>
                        </div>
                    )}

                    {result?.error && (
                        <div className="flex flex-col items-center gap-2 text-red-500">
                            <XCircle className="h-10 w-10" />
                            <div className="text-center font-medium">
                                {result.error}
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Close
                    </Button>
                    <Button onClick={runTest} disabled={loading}>
                        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        {result ? "Test Again" : "Start Test"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
