import { PrismaClient } from '@prisma/client'

const prismaClientSingleton = () => {
    // Pas besoin d'adapter ou de pool manuel.
    // Prisma gère ça nativement avec le moteur Rust.
    return new PrismaClient({
        log: ['info', 'warn', 'error'],
    })
}

declare global {
    var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma