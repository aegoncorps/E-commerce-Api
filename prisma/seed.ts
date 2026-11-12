import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const products = [
  ['1', 'Kit completo Full on', 28990],
  ['2', 'Garrafa térmica System Wake', 11990],
  ['3', 'Kit Duo on', 17990],
  ['4', 'Camisa oversized Always on', 14990],
  ['5', 'Caderno Core Pulse', 7990],
  ['6', 'Camisa Tech Essential', 13990],
  ['7', 'Garrafa Minimal Core Pulse', 9990],
  ['8', 'Camisa Editorial Core Pulse', 14490],
  ['9', 'Caderno Shadow State', 8490],
  ['10', 'Polo Aegon System Wake', 16990],
] as const

await Promise.all(products.map(([id, name, priceCents]) => prisma.product.upsert({
  where: { id },
  update: { name, priceCents, active: true },
  create: { id, name, priceCents, active: true },
})))
await prisma.$disconnect()
console.log(`Catálogo inicial sincronizado (${products.length} produtos).`)
