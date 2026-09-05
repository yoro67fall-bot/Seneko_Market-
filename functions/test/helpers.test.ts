import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  constantTimeHexEqual,
  hmacSha256Hex,
  mapPaymentMethod,
  normalizeNabooPayStatus,
  parseAllowedOrigins,
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
    expect(toInternationalPhone("785305575")).toBe("+221785305575");
    expect(toInternationalPhone("0785305575")).toBe("+221785305575");
    expect(() => toInternationalPhone("123")).toThrow();
  });

  it("formats Benin, Togo and DRC local numbers for SenePay", () => {
    expect(toInternationalPhone("60000001", "BJ")).toBe("+22960000001");
    expect(toInternationalPhone("0197000001", "BJ")).toBe("+2290197000001");
    expect(() => toInternationalPhone("785305575", "BJ")).toThrow(/Bénin/);
    expect(toInternationalPhone("60000001", "TG")).toBe("+22860000001");
    expect(toInternationalPhone("90123456", "TG")).toBe("+22890123456");
    expect(() => toInternationalPhone("785305575", "TG")).toThrow(/Togo/);
    expect(toInternationalPhone("120000011", "CD")).toBe("+243120000011");
    expect(toInternationalPhone("0120000011", "CD")).toBe("+243120000011");
    expect(toInternationalPhone("243120000011", "CD")).toBe("+243120000011");
    expect(toInternationalPhone("0812345678", "CD")).toBe("+243812345678");
    expect(toInternationalPhone("0991234567", "CD")).toBe("+243991234567");
    expect(() => toInternationalPhone("785305575", "CD")).toThrow(/RDC/);
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
    expect(
      resolveRedirectUrl(
        "https://fantastic-meringue-c930af.netlify.app/?payment_return=success",
        "https://example.com/?payment_return=success",
        ["example.com"],
      ),
    ).toContain("fantastic-meringue-c930af.netlify.app");
    expect(parseAllowedOrigins("fantastic-meringue-c930af.netlify.app")).toEqual([
      "https://fantastic-meringue-c930af.netlify.app",
    ]);
  });
});
