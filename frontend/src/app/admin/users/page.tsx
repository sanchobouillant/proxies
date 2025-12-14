"use client";

import { useEffect, useState } from "react";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface User {
    id: string;
    username: string;
    role: string;
    createdAt: string;
}

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);

    const fetchUsers = async () => {
        const res = await fetch("/api/users");
        if (res.ok) {
            setUsers(await res.json());
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure?")) return;
        await fetch(`/api/users/${id}`, { method: "DELETE" });
        fetchUsers();
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 p-6 md:p-12">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center gap-4">
                    <Link href="/">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="w-5 h-5" />
                        </Button>
                    </Link>
                    <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
                    <div className="ml-auto">
                        <AddUserDialog onUserAdded={fetchUsers} />
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Registered Users</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {users.map((user) => (
                                <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
                                    <div>
                                        <p className="font-semibold">{user.username}</p>
                                        <p className="text-sm text-gray-500">{user.role} • Joined {new Date(user.createdAt).toLocaleDateString()}</p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                        onClick={() => handleDelete(user.id)}
                                        disabled={user.username === 'admin'} // Protect root admin
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
