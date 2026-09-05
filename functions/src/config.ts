export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function getJwtSecret(): string {
  const value = env("JWT_SECRET");
  if (!value) throw new Error("JWT_SECRET is required.");
  return value;
}

export function getPublicApiUrl(): string {
  const configured = env("PUBLIC_API_URL").replace(/\/$/, "");
  if (!configured) return "http://127.0.0.1:8080";
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

function isLocalHost(value: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(value);
}

export function resolvePublicBaseUrl(request?: {
  protocol?: string;
  get?(name: string): string | undefined;
}): string {
  const host = request?.get?.("x-forwarded-host") || request?.get?.("host") || "";
  const proto = request?.get?.("x-forwarded-proto") || request?.protocol || "https";
  const fromRequest = host ? `${proto}://${host}`.replace(/\/$/, "") : "";
  const configured = env("PUBLIC_API_URL").replace(/\/$/, "");
  const normalized = configured
    ? (/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
    : "";
  if (normalized && !(isLocalHost(normalized) && host && !isLocalHost(host))) {
    return normalized;
  }
  return fromRequest || normalized || "http://127.0.0.1:8080";
}

export function getUploadRoot(): string {
  return env("UPLOAD_ROOT", "/data/uploads");
}

export function getCorsOrigins(): string[] {
  const raw = env("CORS_ORIGINS");
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return origins.length
    ? origins
    : [
        "http://127.0.0.1:5000",
        "http://localhost:5000",
        "http://127.0.0.1:8888",
        "http://localhost:8888",
        "https://fantastic-meringue-c930af.netlify.app",
      ];
}

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (getCorsOrigins().includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname.endsWith(".netlify.app")) {
      return true;
    }
    if (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getNabooPayApiKey(): string {
  return env("NABOOPAY_API_KEY");
}

export function getNabooPayWebhookSecret(): string {
  return env("NABOOPAY_WEBHOOK_SECRET");
}

export function getNabooPayDefaultReturnUrl(): string {
  return env("NABOOPAY_DEFAULT_RETURN_URL");
}

export function getNabooPayDefaultCancelUrl(): string {
  return env("NABOOPAY_DEFAULT_CANCEL_URL");
}

export function getAllowedRedirectOrigins(): string {
  return env("ALLOWED_REDIRECT_ORIGINS", env("CORS_ORIGINS"));
}

export function getNabooPayFeesCustomerSide(): boolean {
  return env("NABOOPAY_FEES_CUSTOMER_SIDE", "false").toLowerCase() === "true";
}

export function getSenePayApiKey(): string {
  return env("SENEPAY_API_KEY");
}

export function getSenePayApiSecret(): string {
  return env("SENEPAY_API_SECRET");
}

export function getSenePayWebhookSecret(): string {
  return env("SENEPAY_WEBHOOK_SECRET");
}

export function getSenePayDefaultReturnUrl(): string {
  return env("SENEPAY_DEFAULT_RETURN_URL");
}

export function getSenePayDefaultCancelUrl(): string {
  return env("SENEPAY_DEFAULT_CANCEL_URL");
}

export function getSenePayWebhookUrl(): string {
  return env("SENEPAY_WEBHOOK_URL");
}

/** Merchant website domain registered in the SenePay dashboard (return_url must match). */
export function getSenePayMerchantDomain(): string {
  const raw = env("SENEPAY_MERCHANT_DOMAIN", "senekomarket.com")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  return raw || "senekomarket.com";
}

export function getAdminEmail(): string {
  return env("ADMIN_EMAIL").toLowerCase();
}

export function getAdminPassword(): string {
  return env("ADMIN_PASSWORD");
}

export function getCronSecret(): string {
  return env("CRON_SECRET");
}

/** Amounts at or below this use instant server-side fulfillment (SenePay min is 200; NabooPay often rejects low amounts). */
export function getPaymentProviderMinAmount(): number {
  const raw = Number(env("PAYMENT_PROVIDER_MIN_AMOUNT", "1000"));
  return Number.isInteger(raw) && raw > 0 ? raw : 1000;
}
