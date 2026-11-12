# E-commerce-Api

Backend independente da Aegon Store em Node.js 24, Hono, Prisma e PostgreSQL (Neon). A API é publicada como uma função na Vercel.

## Estado atual

Rotas disponíveis: `GET /api/health`, `GET /api/products`, `POST /api/orders`, `GET /api/orders/:id/status` e `POST /api/webhooks/mercadopago`. O webhook valida a assinatura e consulta a ordem no Mercado Pago antes de atualizar o status do pedido.

O endpoint valida itens e preços usando o catálogo do banco, cria a ordem na Orders API e retorna QR/Copia e Cola para Pix. Para cartões, recebe somente token de uso único gerado pelo Card Payment Brick; os dados completos do cartão nunca são enviados ou armazenados pela Aegon.

## Desenvolvimento

1. Instale Node.js 24 e execute `npm install`.
2. Copie `.env.example` para `.env`. Configure `DATABASE_URL` e `DIRECT_URL` com as conexões do Neon; `FRONTEND_ORIGIN` deve ser a origem exata do frontend.
3. Configure `MP_PUBLIC_KEY`, `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` localmente. Mantenha o Access Token e o segredo do webhook fora do Git.
4. Execute `npm run db:migrate -- --name init` e `npm run dev`.
5. Execute `npm run db:seed` para cadastrar o catálogo inicial da Aegon.

No frontend, configure apenas `VITE_API_URL` com a URL base deste backend. O checkout obtém a Public Key por `GET /api/payments/config`; o Access Token e a assinatura do webhook ficam somente no backend.

`npm run build` gera o Prisma Client e verifica TypeScript. Em produção, configure as variáveis secretas na Vercel, selecione Node 24 e aplique migrações com `npm run db:deploy`.

## Webhook

Após publicar, configure no Mercado Pago o evento **Order** para `https://SEU-BACKEND.vercel.app/api/webhooks/mercadopago`. A assinatura gerada deve ficar em `MP_WEBHOOK_SECRET` no ambiente da Vercel.
