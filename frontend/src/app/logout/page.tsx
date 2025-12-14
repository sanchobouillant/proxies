"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function LogoutPage() {
    const router = useRouter();

    useEffect(() => {
        const logout = async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (e) {
                console.error("Logout failed", e);
            } finally {
                window.location.href = '/login';
            }
        };

        logout();
    }, [router]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-zinc-950 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            <p className="text-zinc-500 font-medium">Logging out...</p>
        </div>
    );
}
