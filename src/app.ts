import { createHmac, timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono().basePath('/api')
app.use('*', secureHeaders())
app.use('*', cors({ origin: ['https://ecommerce.aegoncorps.com.br', process.env.FRONTEND_ORIGIN || 'http://localhost:5173'], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Idempotency-Key'] }))
app.get('/health', c => c.json({ status: 'ok' }))
app.get('/products', async c => {
  const products = await db.product.findMany({ where: { active: true }, select: { id: true, name: true, priceCents: true } })
  return c.json({ products })
})
app.get('/payments/config', c => {
  const publicKey = process.env.MP_PUBLIC_KEY
  if (!publicKey) return c.json({ error: 'Checkout indisponível: configuração do gateway incompleta.' }, 503)
  return c.json({ publicKey })
})
app.get('/orders/:id/status', async c => {
  const order = await db.order.findUnique({ where: { id: c.req.param('id') }, select: { id: true, status: true, paymentStatus: true } })
  if (!order) return c.json({ error: 'Pedido não encontrado.' }, 404)
  return c.json({ order })
})

const paymentSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('pix') }).strict(),
  z.object({
    method: z.literal('card'), token: z.string().min(10).max(300), paymentMethodId: z.string().min(2).max(40),
    installments: z.number().int().min(1).max(24), identificationType: z.string().min(2).max(5), identificationNumber: z.string().min(5).max(20),
  }).strict(),
])

const checkoutSchema = z.object({
  customer: z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().max(150), phone: z.string().min(10).max(20) }).strict(),
  address: z.object({ cep: z.string().min(8).max(9), street: z.string().min(1).max(120), number: z.string().min(1).max(15), complement: z.string().max(60).optional(), district: z.string().min(1).max(80), city: z.string().min(1).max(80), state: z.string().length(2) }).strict(),
  items: z.array(z.object({ productId: z.coerce.string().min(1).max(64), quantity: z.number().int().min(1).max(10), size: z.string().max(30).optional() }).strict()).min(1).max(20),
  payment: paymentSchema,
}).strict()

type MpOrderResponse = {
  id?: string; status?: string; status_detail?: string; external_reference?: string;
  transactions?: { payments?: Array<{ id?: string; status?: string; status_detail?: string; payment_method?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } }> }
}

app.post('/orders', async c => {
  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) return c.json({ error: 'Pagamento indisponível: gateway não configurado.' }, 503)
  const body = await c.req.json().catch(() => null)
  const parsed = checkoutSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'Dados do checkout inválidos.' }, 400)
  const { customer, address, items, payment } = parsed.data

  const products = await db.product.findMany({ where: { id: { in: items.map(item => item.productId) }, active: true } })
  const byId = new Map(products.map(product => [product.id, product]))
  if (items.some(item => !byId.has(item.productId))) return c.json({ error: 'Produto indisponível.' }, 400)
  const orderItems = items.map(item => {
    const product = byId.get(item.productId)!
    return { productId: product.id, name: product.name, size: item.size, quantity: item.quantity, unitPriceCents: product.priceCents }
  })
  const totalCents = orderItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const order = await db.order.create({ data: { customerName: customer.name, email: customer.email, phone: customer.phone, address, totalCents, paymentMethod: payment.method, items: { create: orderItems } } })
  const amount = (totalCents / 100).toFixed(2)
  const paymentMethod = payment.method === 'pix'
    ? { id: 'pix', type: 'bank_transfer' }
    : { id: payment.paymentMethodId, type: 'credit_card', token: payment.token, installments: payment.installments }
  const payer = payment.method === 'pix'
    ? { email: customer.email }
    : { email: customer.email, identification: { type: payment.identificationType, number: payment.identificationNumber.replace(/\D/g, '') } }

  const gatewayResponse = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `aegon-${order.id}` },
    body: JSON.stringify({
      type: 'online', processing_mode: 'automatic', total_amount: amount, external_reference: order.id,
      payer, config: { location: { state_id: `BR-${address.state}` } },
      transactions: { payments: [{ amount, payment_method: paymentMethod }] },
    }),
  })
  const gatewayBody = await gatewayResponse.json().catch(() => null) as (MpOrderResponse & { message?: string }) | null
  if (!gatewayResponse.ok || !gatewayBody?.id) {
    await db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', paymentStatus: 'gateway_error' } })
    console.error('Mercado Pago order creation failed:', gatewayResponse.status)
    return c.json({ error: 'O gateway não conseguiu iniciar o pagamento. Confira os dados e tente novamente.' }, 502)
  }

  const transaction = gatewayBody.transactions?.payments?.[0]
  const pix = payment.method === 'pix' ? transaction?.payment_method : undefined
  await db.order.update({ where: { id: order.id }, data: { providerOrderId: gatewayBody.id, paymentStatus: `${gatewayBody.status ?? 'pending'}:${gatewayBody.status_detail ?? 'pending'}` } })
  return c.json({
    order: { id: order.id, status: gatewayBody.status ?? 'pending', totalCents },
    payment: { method: payment.method, status: transaction?.status ?? gatewayBody.status ?? 'pending', statusDetail: transaction?.status_detail ?? gatewayBody.status_detail, ticketUrl: pix?.ticket_url, qrCode: pix?.qr_code, qrCodeBase64: pix?.qr_code_base64 },
  }, 201)
})

app.post('/webhooks/mercadopago', async c => {
  const secret = process.env.MP_WEBHOOK_SECRET
  const dataId = c.req.query('data.id') || c.req.query('data_id')
  const signature = c.req.header('x-signature')
  const requestId = c.req.header('x-request-id')
  if (!secret || !dataId || !signature || !requestId) return c.json({ error: 'Webhook não configurado.' }, 401)
  const parts = Object.fromEntries(signature.split(',').map(part => part.trim().split('=').map(value => value.trim())))
  if (!parts.ts || !parts.v1 || Math.abs(Date.now() - Number(parts.ts)) > 5 * 60 * 1000) return c.json({ error: 'Assinatura inválida ou expirada.' }, 401)
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest()
  const received = Buffer.from(parts.v1, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return c.json({ error: 'Assinatura inválida.' }, 401)

  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) return c.json({ error: 'Gateway não configurado.' }, 503)
  const response = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) return c.json({ error: 'Não foi possível consultar a ordem no gateway.' }, 502)
  const gatewayOrder = await response.json() as MpOrderResponse
  if (!gatewayOrder.id || !gatewayOrder.external_reference) return c.json({ error: 'Ordem do gateway inválida.' }, 400)
  const order = await db.order.findUnique({ where: { id: gatewayOrder.external_reference }, select: { id: true } })
  if (!order) return c.json({ error: 'Pedido local não encontrado.' }, 404)
  const transaction = gatewayOrder.transactions?.payments?.[0]
  const paid = gatewayOrder.status === 'processed' && (gatewayOrder.status_detail === 'accredited' || transaction?.status_detail === 'accredited')
  const cancelled = ['canceled', 'cancelled', 'rejected'].includes(gatewayOrder.status ?? '')
  await db.order.update({ where: { id: order.id }, data: {
    providerOrderId: gatewayOrder.id,
    paymentStatus: `${gatewayOrder.status ?? 'unknown'}:${gatewayOrder.status_detail ?? transaction?.status_detail ?? 'unknown'}`,
    ...(paid ? { status: 'PAID' } : cancelled ? { status: 'CANCELLED' } : {}),
  } })
  return c.json({ received: true })
})

app.onError((error, c) => {
  console.error('API error:', error.name)
  return c.json({ error: 'Não foi possível processar a solicitação.' }, 500)
})
export default app
