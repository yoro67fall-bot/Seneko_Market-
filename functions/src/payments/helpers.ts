import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export type JsonRecord = Record<string, unknown>;
export type PaymentPurpose = "rent" | "sponsor";
export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "canceled"
  | "refunded";

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-fA-F0-9]+$/.test(left) || !/^[a-fA-F0-9]+$/.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left.toLowerCase(), "hex");
  const rightBuffer = Buffer.from(right.toLowerCase(), "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyNabooPaySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  return constantTimeHexEqual(hmacSha256Hex(secret, rawBody), signature.trim());
}

export function parseXofAmount(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid XOF amount.");
    }
    return value;
  }
  if (typeof value !== "string" || !/^\d+(?:\.0+)?$/.test(value.trim())) {
    throw new Error("Invalid XOF amount.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid XOF amount.");
  }
  return parsed;
}

export function normalizeNabooPayStatus(value: unknown): PaymentStatus {
  if (typeof value !== "string") throw new Error("Missing payment status.");
  switch (value.trim().toLowerCase()) {
    case "pending":
      return "pending";
    case "paid":
    case "paid_and_blocked":
    case "completed":
      return "completed";
    case "failed":
    case "expired":
      return "failed";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "refunded":
      return "refunded";
    default:
      throw new Error("Unknown payment status.");
  }
}

export function mapPaymentMethod(
  method: "orange" | "wave" | "card",
): "orange_money" | "wave" | "bank" {
  if (method === "orange") return "orange_money";
  if (method === "wave") return "wave";
  return "bank";
}

export function toInternationalPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) throw new Error("A payer phone number is required.");
  let normalized = digits;
  if (normalized.startsWith("221") && normalized.length >= 12) {
    normalized = normalized.slice(0, 12);
  } else if (normalized.length === 9 && /^7/.test(normalized)) {
    normalized = `221${normalized}`;
  } else if (normalized.length === 10 && normalized.startsWith("0")) {
    normalized = `221${normalized.slice(1)}`;
  }
  const international = `+${normalized}`;
  if (!/^\+2217\d{8}$/.test(international)) {
    throw new Error("A valid Senegal mobile number is required.");
  }
  return international;
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveRedirectUrl(
  requested: string | undefined,
  fallback: string,
  allowedOrigins: string[],
): string {
  const value = (requested ?? fallback).trim();
  if (!value) {
    throw new Error("A payment redirect URL is not configured.");
  }
  const url = new URL(value);
  const isLocal =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (allowedOrigins.length === 0) {
    if (isLocal || (fallback && value === fallback.trim())) return value;
    throw new Error("Redirect URL origin is not allowed.");
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new Error("Redirect URL origin is not allowed.");
  }
  return value;
}

export function appendQuery(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function parseJsonBody(raw: string): JsonRecord {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("Webhook body must be a JSON object.");
  return parsed;
}
