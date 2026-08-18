# Deploy Seneko Market (Railway API + Netlify UI)

There is no Firebase. Railway runs the API, Postgres, uploads, and NabooPay.
Netlify serves the static UI in `public/`.

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
| `CORS_ORIGINS` | Netlify origin, e.g. `https://yoursite.netlify.app` |
| `ALLOWED_REDIRECT_ORIGINS` | Same as CORS, plus any custom domain |
| `ADMIN_EMAIL` | First admin login |
| `ADMIN_PASSWORD` | First admin password |
| `NABOOPAY_API_KEY` | From NabooPay |
| `NABOOPAY_WEBHOOK_SECRET` | From NabooPay |
| `NABOOPAY_DEFAULT_RETURN_URL` | `https://yoursite.netlify.app/?payment_return=success` |
| `NABOOPAY_DEFAULT_CANCEL_URL` | `https://yoursite.netlify.app/?payment_return=cancel` |
| `NABOOPAY_FEES_CUSTOMER_SIDE` | `false` |

6. Deploy. Open `/health` — it should return `{ "ok": true }`.
7. Copy `public/api-config.example.json` to `public/api-config.json` and set `apiUrl` to the Railway URL.

Local API without Docker:

```bash
cd functions
cp .env.example .env
npm install
npx prisma migrate deploy
npm run build
npm start
```

## 2. NabooPay webhook

In NabooPay → Settings → Integration:

`https://YOUR-RAILWAY-SERVICE.up.railway.app/webhooks/naboopay`

## 3. Netlify

Publish `public/`. `netlify.toml` already rewrites the SPA to `index.html`.

After the Railway URL is known, include `public/api-config.json` in the Netlify publish folder (it is gitignored locally so you can set it in the Netlify UI or as a build file).

The Railway `CORS_ORIGINS` value must include the Netlify site origin.
