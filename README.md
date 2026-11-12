# E-commerce-Api

Backend independente da Aegon Store em Node.js 24, Hono, Prisma e PostgreSQL (Neon). A API é publicada como uma função na Vercel.

## Estado atual

Rotas disponíveis: `GET /api/health`, `GET /api/products`, `POST /api/orders` e `POST /api/webhooks/mercadopago`. O webhook valida a assinatura e consulta a ordem no Mercado Pago antes de atualizar o status do pedido.

O endpoint de pedidos cria pedidos pendentes usando preços do banco. A criação e cobrança de pagamentos via Mercado Pago ainda precisam ser integradas. Não são recebidos nem armazenados dados completos de cartão.

## Desenvolvimento

1. Instale Node.js 24 e execute `npm install`.
2. Copie `.env.example` para `.env`. Configure `DATABASE_URL` e `DIRECT_URL` com as conexões do Neon; `FRONTEND_ORIGIN` deve ser a origem exata do frontend.
3. Configure `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` localmente. Mantenha segredos fora do Git.
4. Execute `npm run db:migrate -- --name init` e `npm run dev`.
5. Cadastre os produtos de teste no banco antes de criar pedidos.

`npm run build` gera o Prisma Client e verifica TypeScript. Em produção, configure as variáveis secretas na Vercel, selecione Node 24 e aplique migrações com `npm run db:deploy`.

## Webhook

Após publicar, configure no Mercado Pago o evento **Order** para `https://SEU-BACKEND.vercel.app/api/webhooks/mercadopago`. A assinatura gerada deve ficar em `MP_WEBHOOK_SECRET` no ambiente da Vercel.
