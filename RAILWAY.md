# Deploy Seneko Market (Railway API + Netlify UI)

There is no Firebase. Railway runs the API, Postgres, uploads, NabooPay (Senegal), and SenePay (Benin / Togo / DRC).
Netlify serves the static UI in `public/`.

One shared Railway backend can serve **four country frontends**. Each Netlify site sets its own `api-config.json` with `country`, theme colors, and flag.

## 1. Railway

1. Create a project at https://railway.app.
2. Add a **Postgres** plugin.
3. Create a service from this repo with root directory `functions`.
4. Attach a volume at `/data/uploads`.
5. Set variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | From the Postgres plugin |
| `JWT_SECRET` | Long random string |
| `PUBLIC_API_URL` | Must be the public Railway URL with `https://`, e.g. `https://senekomarket-production.up.railway.app`. Shop and product images break without this. |
| `UPLOAD_ROOT` | `/data/uploads` |
| `CORS_ORIGINS` | All Netlify origins, comma-separated (SN + BJ + TG + CD) |
| `ALLOWED_REDIRECT_ORIGINS` | Same as CORS, plus any custom domains |
| `ADMIN_EMAIL` | First admin login (created for each country) |
| `ADMIN_PASSWORD` | First admin password |
| `NABOOPAY_API_KEY` | From NabooPay (Senegal only) |
| `NABOOPAY_WEBHOOK_SECRET` | From NabooPay |
| `NABOOPAY_DEFAULT_RETURN_URL` | Senegal Netlify return URL |
| `NABOOPAY_DEFAULT_CANCEL_URL` | Senegal Netlify cancel URL |
| `NABOOPAY_FEES_CUSTOMER_SIDE` | `false` |
| `SENEPAY_API_KEY` | From SenePay (`X-Api-Key`) |
| `SENEPAY_API_SECRET` | From SenePay (`X-Api-Secret`) |
| `SENEPAY_WEBHOOK_SECRET` | `whsec_…` from SenePay |
| `SENEPAY_DEFAULT_RETURN_URL` | Optional fallback return URL |
| `SENEPAY_DEFAULT_CANCEL_URL` | Optional fallback cancel URL |
| `SENEPAY_WEBHOOK_URL` | Prefer Railway direct: `https://YOUR-RAILWAY/webhooks/senepay` (or a Netlify proxy URL) |

6. Deploy. Open `/health` — it should return `{ "ok": true }`.
7. Migrations create `PlatformConfig` rows for `SN`, `BJ`, `TG`, `CD` and add `countryCode` on shops/users/banners.

Local API without Docker:

```bash
cd functions
cp .env.example .env
npm install
npx prisma migrate deploy
npm run build
npm start
```

## 2. Payment webhooks

### NabooPay (Senegal)

In NabooPay → Settings → Integration:

`https://YOUR-RAILWAY-SERVICE.up.railway.app/webhooks/naboopay`

Or via Netlify proxy:

`https://YOUR-SENEGAL-SITE.netlify.app/.netlify/functions/naboopay-webhook`

### SenePay (Benin, Togo, DRC)

Register one webhook URL in SenePay (all three countries share the same Railway handler):

`https://YOUR-RAILWAY-SERVICE.up.railway.app/webhooks/senepay`

Or via Netlify proxy:

`https://YOUR-BENIN-SITE.netlify.app/.netlify/functions/senepay-webhook`

Signature header: `X-SenePay-Signature` (HMAC-SHA256 of raw body with `SENEPAY_WEBHOOK_SECRET`).

## 3. Netlify — one site per country

Publish `public/` for each country site. Use the matching template:

| Country | Template file | Payment provider |
| --- | --- | --- |
| Senegal | `api-config.example.json` | NabooPay |
| Benin | `api-config.example.benin.json` | SenePay |
| Togo | `api-config.example.togo.json` | SenePay |
| DRC | `api-config.example.drc.json` | SenePay |

For each site:

1. Copy the template to `api-config.json` (or inject it at build time) and set `apiUrl` to the Railway URL.
2. Set Netlify env `RAILWAY_API_URL` to the same Railway URL (needed by `create-payment` / webhook proxies).
3. Add the Netlify origin to Railway `CORS_ORIGINS` and `ALLOWED_REDIRECT_ORIGINS`.

Country routing uses the `X-Platform-Country` header (from `api-config.json` → `country`). Shops, users, banners, and admin config are isolated per country in the shared database.

### Admin contact details

In Admin → **Informations de contact**, set phone, email, and physical address. These appear in the top contact bar and footer for that country only.

### Country flag

The navbar shows the flag from `flagUrl` (assets in `public/flags/`: `sn.svg`, `bj.svg`, `tg.svg`, `cd.svg`).

## 4. Provider behavior

| Country code | Currency | Provider |
| --- | --- | --- |
| `SN` | XOF | NabooPay |
| `BJ` | XOF | SenePay hosted checkout |
| `TG` | XOF | SenePay hosted checkout |
| `CD` | CDF | SenePay hosted checkout |

SenePay docs: https://api.sene-pay.com/docs.html
