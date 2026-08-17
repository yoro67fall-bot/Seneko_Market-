import { describe, expect, it } from "vitest";
import { createPaymentSchema } from "../src/schemas.js";

describe("createPaymentSchema", () => {
  it("requires a sponsor option and banner for sponsorship", () => {
    const parsed = createPaymentSchema.safeParse({
      shopId: "shop1",
      purpose: "sponsor",
      paymentMethod: "wave",
      idempotencyKey: "idem-key-1",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a rent payment without sponsorship fields", () => {
    const parsed = createPaymentSchema.safeParse({
      shopId: "shop1",
      purpose: "rent",
      paymentMethod: "orange",
      payerPhone: "+221771234567",
      idempotencyKey: "idem-key-12",
      returnUrl: "http://127.0.0.1:5000/?payment_return=success",
      cancelUrl: "http://127.0.0.1:5000/?payment_return=cancel",
    });
    expect(parsed.success).toBe(true);
  });
});
