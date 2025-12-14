import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// Standard Prisma client for MySQL.
// Cached in dev to avoid creating too many connections with hot reloads.
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: ['info', 'warn', 'error'],
    })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
