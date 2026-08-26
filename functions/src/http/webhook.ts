import type { Request, Response } from "express";
import { getNabooPayWebhookSecret, getSenePayWebhookSecret } from "../config.js";
import { prisma } from "../prisma.js";
import {
  normalizeNabooPayStatus,
  normalizeSenePayStatus,
  parseJsonBody,
  parseXofAmount,
  verifyNabooPaySignature,
  verifySenePaySignature,
} from "../payments/helpers.js";
import { applyVerifiedPayment } from "../payments/fulfillment.js";

function rawBody(request: Request): string {
  return Buffer.isBuffer(request.body)
    ? request.body.toString("utf8")
    : typeof request.body === "string"
      ? request.body
      : JSON.stringify(request.body ?? {});
}

export async function nabooPayWebhook(
  request: Request,
  response: Response,
): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = rawBody(request);

  if (
    !verifyNabooPaySignature(
      body,
      request.get("x-signature") ?? request.get("X-Signature"),
      getNabooPayWebhookSecret(),
    )
  ) {
    response.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload;
  try {
    payload = parseJsonBody(body);
  } catch {
    response.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const orderId = typeof payload.order_id === "string" ? payload.order_id : "";
  if (!orderId) {
    response.status(400).json({ error: "Missing order_id" });
    return;
  }

  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: orderId },
  });
  if (!payment) {
    response.status(404).json({ error: "Unknown order" });
    return;
  }

  try {
    const amount = parseXofAmount(payload.amount);
    if (amount !== payment.amount) {
      response.status(409).json({ error: "Amount mismatch" });
      return;
    }
    const status = normalizeNabooPayStatus(payload.transaction_status);
    await applyVerifiedPayment(payment.id, status, { raw: payload });
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        orderId,
        status,
      },
    });
    response.status(200).json({ status: "received" });
  } catch (error) {
    console.error("NabooPay webhook processing failed", error);
    response.status(500).json({ error: "Processing failed" });
  }
}

export async function senePayWebhook(
  request: Request,
  response: Response,
): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = rawBody(request);
  if (
    !verifySenePaySignature(
      body,
      request.get("x-senepay-signature") ?? request.get("X-SenePay-Signature"),
      getSenePayWebhookSecret(),
    )
  ) {
    response.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload;
  try {
    payload = parseJsonBody(body);
  } catch {
    response.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const sessionToken =
    typeof payload.sessionToken === "string" ? payload.sessionToken : "";
  const orderReference =
    typeof payload.orderReference === "string" ? payload.orderReference : "";
  if (!sessionToken && !orderReference) {
    response.status(400).json({ error: "Missing sessionToken" });
    return;
  }

  const payment =
    (sessionToken
      ? await prisma.payment.findUnique({
          where: { providerOrderId: sessionToken },
        })
      : null) ??
    (orderReference
      ? await prisma.payment.findUnique({ where: { id: orderReference } })
      : null);

  if (!payment) {
    response.status(404).json({ error: "Unknown order" });
    return;
  }

  try {
    const amount = parseXofAmount(payload.amount ?? payment.amount);
    if (amount !== payment.amount) {
      response.status(409).json({ error: "Amount mismatch" });
      return;
    }
    const status = normalizeSenePayStatus(payload.status);
    await applyVerifiedPayment(payment.id, status, { raw: payload });
    await prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        orderId: sessionToken || orderReference,
        status,
      },
    });
    response.status(200).json({ received: true });
  } catch (error) {
    console.error("SenePay webhook processing failed", error);
    response.status(500).json({ error: "Processing failed" });
  }
}
