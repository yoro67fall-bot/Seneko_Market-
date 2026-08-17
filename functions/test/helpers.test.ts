import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  constantTimeHexEqual,
  hmacSha256Hex,
  mapPaymentMethod,
  normalizeNabooPayStatus,
  parseXofAmount,
  resolveRedirectUrl,
  toInternationalPhone,
  verifyNabooPaySignature,
} from "../src/payments/helpers.js";

describe("NabooPay helpers", () => {
  it("maps UI payment methods to NabooPay methods", () => {
    expect(mapPaymentMethod("orange")).toBe("orange_money");
    expect(mapPaymentMethod("wave")).toBe("wave");
    expect(mapPaymentMethod("card")).toBe("bank");
  });

  it("normalizes provider statuses used by GET and webhooks", () => {
    expect(normalizeNabooPayStatus("paid")).toBe("completed");
    expect(normalizeNabooPayStatus("completed")).toBe("completed");
    expect(normalizeNabooPayStatus("paid_and_blocked")).toBe("completed");
    expect(normalizeNabooPayStatus("cancelled")).toBe("canceled");
    expect(normalizeNabooPayStatus("refunded")).toBe("refunded");
    expect(() => normalizeNabooPayStatus("unknown")).toThrow();
  });

  it("parses integer XOF amounts only", () => {
    expect(parseXofAmount(5000)).toBe(5000);
    expect(parseXofAmount("12000")).toBe(12000);
    expect(() => parseXofAmount("12.5")).toThrow();
  });

  it("formats Senegal phone numbers for NabooPay", () => {
    expect(toInternationalPhone("221 77 123 45 67")).toBe("+221771234567");
    expect(toInternationalPhone("+221771234567")).toBe("+221771234567");
  });

  it("verifies HMAC signatures against the raw webhook body", () => {
    const secret = "webhook-secret-key";
    const raw = '{"order_id":"order_1","transaction_status":"completed","amount":5000}';
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(verifyNabooPaySignature(raw, signature, secret)).toBe(true);
    expect(verifyNabooPaySignature(raw, "00", secret)).toBe(false);
    expect(hmacSha256Hex(secret, raw)).toBe(signature);
  });

  it("compares hex signatures in constant time", () => {
    expect(constantTimeHexEqual("abc", "abc")).toBe(true);
    expect(constantTimeHexEqual("ab", "abcd")).toBe(false);
  });

  it("restricts payment redirect origins", () => {
    expect(
      resolveRedirectUrl(
        "https://seneko.example/?payment_return=success",
        "",
        ["https://seneko.example"],
      ),
    ).toContain("seneko.example");
    expect(() =>
      resolveRedirectUrl("https://evil.example/", "", ["https://seneko.example"]),
    ).toThrow();
  });
});
