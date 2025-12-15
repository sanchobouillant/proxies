import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { Modem } from "@proxy-farm/shared";

interface CopyProxyButtonProps {
    workerIp: string;
    modem: any; // Using any to avoid type complexity with prisma types
    proxy: any;
    balancerIp: string;
}

export function CopyProxyButton({ workerIp, modem, proxy, balancerIp }: CopyProxyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        // Logic matches page.tsx display
        const host = balancerIp || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
        const auth = proxy.authUser && proxy.authPass ? `${proxy.authUser}:${proxy.authPass}@` : '';
        const protocol = proxy.protocol ? proxy.protocol.toLowerCase() : 'socks5';
        const connectionString = `${protocol}://${auth}${host}:${proxy.port}`;

        try {
            await navigator.clipboard.writeText(connectionString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-2"
            onClick={handleCopy}
            title="Copy Proxy String"
        >
            {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
                <Copy className="h-3.5 w-3.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
            )}
        </Button>
    );
}
