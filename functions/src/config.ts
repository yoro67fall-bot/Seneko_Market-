export function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export function getJwtSecret(): string {
  const value = env("JWT_SECRET");
  if (!value) throw new Error("JWT_SECRET is required.");
  return value;
}

export function getPublicApiUrl(): string {
  return env("PUBLIC_API_URL", "http://127.0.0.1:8080").replace(/\/$/, "");
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

export function getAdminEmail(): string {
  return env("ADMIN_EMAIL").toLowerCase();
}

export function getAdminPassword(): string {
  return env("ADMIN_PASSWORD");
}
