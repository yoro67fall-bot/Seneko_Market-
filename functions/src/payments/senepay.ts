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

async function providerFetch(
  path: string,
  init: RequestInit,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": getSenePayApiKey(),
        "X-Api-Secret": getSenePayApiSecret(),
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
    throw new SenePayError(message, response.status);
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
