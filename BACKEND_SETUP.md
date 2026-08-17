# Seneko Market backend (Railway + Postgres)

The API is a Node/Express service in `functions/`. It uses Prisma/Postgres,
JWT email/password auth, disk uploads, and NabooPay. The UI in `public/` is
static and talks to `/v1/:name` plus `/auth/*` and `/uploads`.

## Security model

- Public approved shops come from `bootstrapPublic` and `getPublicShop`.
- Merchants authenticate with `Authorization: Bearer` JWTs from `/auth/login`
  and `/auth/register`.
- Admins are users with `role=admin`. The first admin is created on boot from
  `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Payment amounts, rent, approval, and sponsorship windows are server-owned.
  A NabooPay redirect is not proof of payment; webhooks and `getPaymentStatus`
  are.
- Identity files live under `identity/{uid}/` and are not publicly served.
  Shop/product/banner images are under `/uploads/public/...`.

## API

- Auth: `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- Uploads: `POST /uploads` (multipart `file`, `kind`, optional `shopId`)
- Public files: `GET /uploads/public/...`
- Identity (owner or admin): `GET /uploads/identity/:uid/:filename`
- Callables (same names as the UI): `POST /v1/:name`
- Webhook: `POST /webhooks/naboopay`
- Health: `GET /health`

Public callables: `bootstrapPublic`, `getPublicShop`.

Merchant: `completeMerchantProfile`, `getMyAccount`, `updateMyShop`,
`deleteMyShop`, `upsertProduct`, `deleteProduct`, `createPayment`,
`getPaymentStatus`, `submitSponsorship`.

Admin: `adminListShops`, `adminBootstrap`, `adminSetShopStatus`,
`adminSetRentConfig`, `adminMarkRent`, `adminVerifyIdentity`,
`adminUpsertAgent`, `adminDeleteAgent`, `adminUpsertBanner`,
`adminDeleteBanner`, `adminSetPlatformBranding`.

Orange Money, Wave, and card in the UI map to NabooPay methods
`orange_money`, `wave`, and `bank`.

## Local run

```bash
cd functions
cp .env.example .env
npm install
npx prisma migrate deploy
npm test
npm run build
npm start
```

Serve `public/` separately (Netlify CLI or any static server) and point
`public/api-config.json` at `http://127.0.0.1:8080`.

See `RAILWAY.md` for production deploy.
