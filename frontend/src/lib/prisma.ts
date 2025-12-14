import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
    throw new Error('DATABASE_URL is missing. Set it in .env (dev) or the environment (prod).')
}

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined
}

// PrismaMariaDb expects the scheme mariadb://. Convert mysql:// automatically for local convenience.
const normalizedUrl = connectionString.startsWith('mysql://')
    ? connectionString.replace(/^mysql:\/\//, 'mariadb://')
    : connectionString

const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        adapter: new PrismaMariaDb(normalizedUrl),
        log: ['info', 'warn', 'error'],
    })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export default prisma
