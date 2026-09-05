import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import {
  COUNTRY_PHONE_DIAL,
  type PlatformCountry,
} from "../country.js";

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

export function toInternationalPhone(
  phone: string,
  countryCode: PlatformCountry = "SN",
): string {
  const dial = COUNTRY_PHONE_DIAL[countryCode];
  const digits = phone.replace(/[^0-9]/g, "");
  if (!digits) throw new Error("A payer phone number is required.");
  let normalized = digits;
  if (normalized.startsWith(dial) && normalized.length >= dial.length + 8) {
    normalized = normalized.slice(
      0,
      Math.min(normalized.length, dial.length + 10),
    );
  } else if (normalized.length === 8) {
    // BJ / TG local mobiles are often 8 digits (e.g. sandbox 60000001).
    normalized = `${dial}${normalized}`;
  } else if (normalized.length === 9) {
    normalized = `${dial}${normalized}`;
  } else if (normalized.length === 10 && normalized.startsWith("0")) {
    normalized = `${dial}${normalized.slice(1)}`;
  } else if (
    countryCode === "CD" &&
    normalized.length === 10 &&
    !normalized.startsWith("0")
  ) {
    // Some CD numbers are entered as 10 digits without a leading 0.
    normalized = `${dial}${normalized}`;
  }
  const international = `+${normalized}`;
  const patterns: Record<PlatformCountry, RegExp> = {
    SN: /^\+2217\d{8}$/,
    BJ: /^\+229\d{8,10}$/,
    TG: /^\+228\d{8,10}$/,
    CD: /^\+243\d{8,10}$/,
  };
  if (!patterns[countryCode].test(international)) {
    throw new Error(`A valid ${countryCode} mobile number is required.`);
  }
  return international;
}

export function normalizeSenePayStatus(value: unknown): PaymentStatus {
  if (typeof value !== "string") throw new Error("Missing payment status.");
  switch (value.trim()) {
    case "Open":
    case "Processing":
    case "Pending":
    case "pending":
      return "pending";
    case "Complete":
    case "Completed":
    case "Success":
    case "completed":
      return "completed";
    case "Failed":
    case "Expired":
    case "failed":
      return "failed";
    case "Cancelled":
    case "Canceled":
    case "cancelled":
    case "canceled":
      return "canceled";
    default:
      throw new Error("Unknown payment status.");
  }
}

export function verifySenePaySignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  return constantTimeHexEqual(hmacSha256Hex(secret, rawBody), signature.trim());
}

export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => {
      const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
      if (!trimmed) return "";
      try {
        const withProtocol = /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `https://${trimmed}`;
        return new URL(withProtocol).origin;
      } catch {
        return trimmed.replace(/\/$/, "");
      }
    })
    .filter(Boolean);
}

function isTrustedRedirectOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname.endsWith(".netlify.app")) {
      return true;
    }
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function resolveRedirectUrl(
  requested: string | undefined,
  fallback: string,
  allowedOrigins: string[],
): string {
  const candidates = [requested, fallback]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new Error("A payment redirect URL is not configured.");
  }
  for (const value of candidates) {
    try {
      const url = new URL(value);
      const origin = url.origin;
      const isLocal =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (
        isTrustedRedirectOrigin(origin) ||
        allowedOrigins.includes(origin) ||
        (allowedOrigins.length === 0 && (isLocal || value === fallback.trim()))
      ) {
        return value;
      }
    } catch {
      continue;
    }
  }
  throw new Error("Redirect URL origin is not allowed.");
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
