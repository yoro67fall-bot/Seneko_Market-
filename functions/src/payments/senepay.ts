import {
  getSenePayApiKey,
  getSenePayApiSecret,
} from "../config.js";
import { isRecord, type JsonRecord } from "./helpers.js";

const API_BASE = "https://api.sene-pay.com";

export class SenePayError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SenePayError";
  }
}

export interface CreateCheckoutSessionInput {
  amount: number;
  currency: string;
  country: string;
  orderReference: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl?: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionToken: string;
  checkoutUrl: string;
  amount: number;
  status: string;
  raw: JsonRecord;
}

export interface InitiateDirectPaymentInput {
  amount: number;
  currency: string;
  country: string;
  operator: string;
  customerPhone: string;
  orderId: string;
  customerName?: string;
  returnUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  metadata?: Record<string, string>;
}

export interface DirectPaymentResult {
  token: string;
  status: string;
  nextAction: string | null;
  redirectUrl: string | null;
  amount: number;
  raw: JsonRecord;
}

async function providerFetch(
  path: string,
  init: RequestInit,
): Promise<JsonRecord> {
  const apiKey = getSenePayApiKey();
  const apiSecret = getSenePayApiSecret();
  if (!apiKey || !apiSecret) {
    throw new SenePayError(
      "SenePay n'est pas configuré sur le serveur (clés API manquantes).",
      503,
      "missing_credentials",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "X-Api-Secret": apiSecret,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SenePayError(
      `SenePay request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SenePayError(
      `SenePay returned HTTP ${response.status} with invalid JSON.`,
      response.status,
    );
  }
  if (!isRecord(json)) {
    throw new SenePayError("SenePay returned an invalid response.", response.status);
  }
  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : typeof json.error === "string"
          ? json.error
          : `SenePay returned HTTP ${response.status}.`;
    const code = typeof json.code === "string" ? json.code : null;
    throw new SenePayError(message, response.status, code);
  }
  return json;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const result = await providerFetch("/api/v1/checkout/sessions", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      country: input.country,
      orderReference: input.orderReference,
      description: input.description,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      ...(input.webhookUrl ? { webhookUrl: input.webhookUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      expiresInMinutes: 60,
    }),
  });

  const sessionToken =
    typeof result.sessionToken === "string" ? result.sessionToken : "";
  const checkoutUrl =
    typeof result.checkoutUrl === "string" ? result.checkoutUrl : "";
  if (!sessionToken || !checkoutUrl) {
    throw new SenePayError("SenePay did not return a checkout URL.");
  }
  return {
    sessionToken,
    checkoutUrl,
    amount: typeof result.amount === "number" ? result.amount : input.amount,
    status: typeof result.status === "string" ? result.status : "Open",
    raw: result,
  };
}

export async function getCheckoutSession(
  sessionToken: string,
): Promise<JsonRecord> {
  return providerFetch(
    `/api/v1/checkout/sessions/${encodeURIComponent(sessionToken)}`,
    { method: "GET" },
  );
}

export async function initiateDirectPayment(
  input: InitiateDirectPaymentInput,
): Promise<DirectPaymentResult> {
  const phone = input.customerPhone.replace(/^\+/, "");
  const result = await providerFetch("/api/v1/payments/initiate", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      country_code: input.country,
      operator: input.operator,
      customer_phone: phone,
      order_id: input.orderId,
      ...(input.customerName ? { customer_name: input.customerName } : {}),
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
      ...(input.webhookUrl ? { webhook_url: input.webhookUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  });

  const token =
    typeof result.token === "string"
      ? result.token
      : typeof result.paymentToken === "string"
        ? result.paymentToken
        : "";
  if (!token) {
    throw new SenePayError("SenePay did not return a payment token.");
  }

  const nextAction =
    typeof result.nextAction === "string"
      ? result.nextAction
      : typeof result.next_action === "string"
        ? result.next_action
        : null;
  const redirectUrl =
    typeof result.redirectUrl === "string"
      ? result.redirectUrl
      : typeof result.redirect_url === "string"
        ? result.redirect_url
        : null;

  const status =
    typeof result.status === "string" ? result.status : "Processing";
  if (/^failed$/i.test(status)) {
    const reason =
      typeof result.failedReason === "string"
        ? result.failedReason
        : typeof result.errorCode === "string"
          ? result.errorCode
          : "Paiement refusé par l'opérateur.";
    throw new SenePayError(reason, 400, "payment_failed");
  }

  return {
    token,
    status,
    nextAction,
    redirectUrl,
    amount: typeof result.amount === "number" ? result.amount : input.amount,
    raw: result,
  };
}

export async function getDirectPaymentStatus(token: string): Promise<JsonRecord> {
  return providerFetch(
    `/api/v1/payments/${encodeURIComponent(token)}/status`,
    { method: "GET" },
  );
}

export function mapUiMethodToSenePayOperator(method: string): string {
  switch (method) {
    case "tmoney":
      return "tmoney";
    case "moov":
      return "moov";
    case "mtn":
      return "mtn";
    case "mpesa":
      return "mpesa";
    case "airtel":
      return "airtel";
    case "orange":
      return "orange";
    case "wave":
      return "wave";
    default:
      return method;
  }
}
