
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createPool } from 'mariadb';

const prismaClientSingleton = () => {
    // Use connection pool for adapter
    const connectionString = (process.env.DATABASE_URL || '').replace('mysql://', 'mariadb://');
    const pool = createPool(connectionString);
    const adapter = new PrismaMariaDb(pool as any);

    return new PrismaClient({
        adapter,
        log: ['info', 'warn', 'error'],
    })
}

declare global {
    var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma
