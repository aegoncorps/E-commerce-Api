import { PrismaClient } from '@prisma/client'

const globalDb = globalThis as typeof globalThis & { prisma?: PrismaClient }
export const db = globalDb.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalDb.prisma = db
