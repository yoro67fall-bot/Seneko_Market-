import { getNabooPayApiKey } from "../config.js";
import { isRecord, type JsonRecord } from "./helpers.js";

const API_BASE = "https://api.naboopay.com/api/v2";

export class NabooPayError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "NabooPayError";
  }
}

export interface CreateTransactionInput {
  methodOfPayment: Array<"wave" | "orange_money" | "bank">;
  productName: string;
  productDescription: string;
  amount: number;
  firstName: string;
  lastName: string;
  phone: string;
  successUrl: string;
  errorUrl: string;
  feesCustomerSide: boolean;
}

export interface TransactionResult {
  orderId: string;
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
        Authorization: `Bearer ${getNabooPayApiKey()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new NabooPayError(
      `NabooPay request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
  }

  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new NabooPayError(
      `NabooPay returned HTTP ${response.status} with invalid JSON.`,
      response.status,
    );
  }
  if (!isRecord(json)) {
    throw new NabooPayError("NabooPay returned an invalid response.", response.status);
  }
  if (!response.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : `NabooPay returned HTTP ${response.status}.`;
    throw new NabooPayError(message, response.status);
  }
  return json;
}

export async function createTransaction(
  input: CreateTransactionInput,
): Promise<TransactionResult> {
  const result = await providerFetch("/transactions", {
    method: "POST",
    body: JSON.stringify({
      method_of_payment: input.methodOfPayment,
      products: [
        {
          name: input.productName,
          category: "services",
          price: input.amount,
          quantity: 1,
          description: input.productDescription,
        },
      ],
      customer: {
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone,
      },
      success_url: input.successUrl,
      error_url: input.errorUrl,
      fees_customer_side: input.feesCustomerSide,
      is_escrow: false,
      is_merchant: false,
    }),
  });

  const orderId =
    typeof result.order_id === "string" ? result.order_id : "";
  const checkoutUrl =
    typeof result.checkout_url === "string" ? result.checkout_url : "";
  if (!orderId || !checkoutUrl) {
    throw new NabooPayError("NabooPay did not return a checkout URL.");
  }
  return {
    orderId,
    checkoutUrl,
    amount: typeof result.amount === "number" ? result.amount : input.amount,
    status: typeof result.transaction_status === "string"
      ? result.transaction_status
      : "pending",
    raw: result,
  };
}

export async function getTransaction(orderId: string): Promise<JsonRecord> {
  return providerFetch(`/transactions/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
}
