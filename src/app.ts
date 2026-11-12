import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'

const app = new Hono().basePath('/api')
app.use('*', secureHeaders())
app.use('*', cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }))
app.get('/health', c => c.json({ status: 'ok' }))
app.get('/products', async c => {
  const products = await db.product.findMany({ where: { active: true }, select: { id: true, name: true, priceCents: true } })
  return c.json({ products })
})

const orderSchema = z.object({
  customer: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().max(150), phone: z.string().min(10).max(20) }).strict(),
  address: z.object({ cep: z.string().min(8).max(9), street: z.string().min(1).max(120), number: z.string().min(1).max(15), complement: z.string().max(60).optional(), district: z.string().min(1).max(80), city: z.string().min(1).max(80), state: z.string().length(2) }).strict(),
  items: z.array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(10), size: z.string().max(30).optional() }).strict()).min(1).max(20)
}).strict()

app.post('/orders', async c => {
  const body = await c.req.json().catch(() => null)
  const parsed = orderSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Dados do pedido inválidos.' }, 400)
  const { customer, address, items } = parsed.data
  const products = await db.product.findMany({ where: { id: { in: items.map(item => item.productId) }, active: true } })
  const byId = new Map(products.map(product => [product.id, product]))
  if (items.some(item => !byId.has(item.productId))) return c.json({ error: 'Produto indisponível.' }, 400)
  const orderItems = items.map(item => {
    const product = byId.get(item.productId)!
    return { productId: product.id, name: product.name, size: item.size, quantity: item.quantity, unitPriceCents: product.priceCents }
  })
  const totalCents = orderItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const order = await db.order.create({ data: { customerName: customer.name, email: customer.email, phone: customer.phone, address, totalCents, items: { create: orderItems } }, select: { id: true, status: true, totalCents: true } })
  return c.json({ order }, 201)
})

app.post('/webhooks/mercadopago', async c => {
  const secret = process.env.MP_WEBHOOK_SECRET
  const dataId = c.req.query('data.id') || c.req.query('data_id')
  const signature = c.req.header('x-signature')
  const requestId = c.req.header('x-request-id')
  if (!secret || !dataId || !signature || !requestId) return c.json({ error: 'Webhook não configurado.' }, 401)

  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=').map(value => value.trim())))
  if (!parts.ts || !parts.v1) return c.json({ error: 'Assinatura inválida.' }, 401)
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest()
  let received: Buffer
  try { received = Buffer.from(parts.v1, 'hex') } catch { return c.json({ error: 'Assinatura inválida.' }, 401) }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return c.json({ error: 'Assinatura inválida.' }, 401)

  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) return c.json({ error: 'Gateway não configurado.' }, 503)
  const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) return c.json({ error: 'Não foi possível consultar a ordem no gateway.' }, 502)
  const gatewayOrder = await response.json() as { id?: string; external_reference?: string; status?: string; status_detail?: string }
  if (!gatewayOrder.id || !gatewayOrder.external_reference) return c.json({ error: 'Ordem do gateway inválida.' }, 400)
  const order = await db.order.findUnique({ where: { id: gatewayOrder.external_reference }, select: { id: true } })
  if (!order) return c.json({ error: 'Pedido local não encontrado.' }, 404)

  const paid = gatewayOrder.status === 'processed' && gatewayOrder.status_detail === 'accredited'
  const cancelled = gatewayOrder.status === 'canceled' || gatewayOrder.status === 'cancelled'
  await db.order.update({ where: { id: order.id }, data: {
    providerOrderId: gatewayOrder.id,
    paymentStatus: `${gatewayOrder.status ?? 'unknown'}:${gatewayOrder.status_detail ?? 'unknown'}`,
    ...(paid ? { status: 'PAID' } : cancelled ? { status: 'CANCELLED' } : {}),
  } })
  return c.json({ received: true })
})

app.onError((error, c) => {
  console.error('API error:', error.name)
  return c.json({ error: 'Não foi possível processar a solicitação.' }, 500)
})
export default app
