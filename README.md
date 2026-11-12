# Aegon Store — backend

Base independente em Node.js 24, Hono, Prisma e PostgreSQL (Neon). A API usa uma única função em `api/index.ts` na Vercel.

## Estado atual

O projeto disponibiliza `GET /api/health`, `GET /api/products` e `POST /api/orders`. O preço é consultado no banco, em centavos. O pedido não recebe nem armazena dados de cartão. Os pedidos criados são apenas pendentes: ainda não há gateway, cobrança, confirmação, controle de estoque, cálculo de frete ou acesso administrativo. Não use para vendas reais nesta etapa.

## Desenvolvimento

1. Instale Node.js 24 e execute `npm install`.
2. Copie `.env.example` para `.env`. Configure `DATABASE_URL` com a conexão do Neon e `DIRECT_URL` com a conexão direta para migrações. Defina `FRONTEND_ORIGIN` com a origem exata do frontend.
3. Execute `npm run db:migrate -- --name init` e `npm run dev`.
4. Cadastre produtos de teste no banco antes de criar pedidos. Os IDs enviados pelo frontend precisam corresponder aos IDs do banco.

`npm run build` gera o Prisma Client e verifica TypeScript. Para produção, crie e versione as migrações em desenvolvimento e execute `npm run db:deploy` no ambiente configurado. Configure as variáveis de ambiente também na Vercel e selecione Node 24 no projeto.

## Próxima etapa

Integrar Mercado Pago em teste: tokenização de cartão no cliente, Pix, idempotência, webhook com assinatura verificada e consulta ao provedor, persistência de tentativas e estados de pagamento, proteção contra abuso e integração do checkout Vue. A conta, credenciais de teste e banco Neon ainda precisam ser configurados. Nunca envie segredos ou dados de cartão para o repositório.
