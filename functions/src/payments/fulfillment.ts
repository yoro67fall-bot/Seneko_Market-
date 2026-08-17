import type { Payment, Prisma, Shop } from "@prisma/client";
import { ApiError } from "../errors.js";
import { prisma } from "../prisma.js";
import {
  computeShopVisible,
  getPlatformConfig,
  type PlatformConfig,
  type SponsorOption,
} from "../data.js";
import type { PaymentPurpose, PaymentStatus } from "./helpers.js";

export interface PaymentRecord {
  id: string;
  ownerUid: string;
  shopId: string;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: string;
  sponsorOption: SponsorOption | null;
  durationDays: number | null;
  bannerImages: string[];
  providerOrderId: string | null;
  checkoutUrl: string | null;
  appliedAt: Date | null;
}

export function asPayment(payment: Payment): PaymentRecord {
  return {
    id: payment.id,
    ownerUid: payment.ownerId,
    shopId: payment.shopId,
    purpose: payment.purpose === "sponsor" ? "sponsor" : "rent",
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status as PaymentStatus,
    paymentMethod: payment.paymentMethod,
    sponsorOption: (payment.sponsorOption as SponsorOption | null) ?? null,
    durationDays: payment.durationDays,
    bannerImages: payment.bannerImages,
    providerOrderId: payment.providerOrderId,
    checkoutUrl: payment.checkoutUrl,
    appliedAt: payment.appliedAt,
  };
}

export function serializePayment(payment: Payment): Record<string, unknown> {
  return {
    paymentId: payment.id,
    status: payment.status,
    purpose: payment.purpose,
    amount: payment.amount,
    currency: payment.currency,
    checkoutUrl: payment.checkoutUrl,
    providerOrderId: payment.providerOrderId,
    sponsorOption: payment.sponsorOption,
  };
}

export async function applyVerifiedPayment(
  paymentId: string,
  status: PaymentStatus,
  extras: { failReason?: string | null; raw?: unknown } = {},
): Promise<Payment> {
  const config = await getPlatformConfig();
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new ApiError("not-found", "Payment not found.");
    }
    const current = asPayment(payment);
    if (current.status === "completed" && current.appliedAt) {
      return;
    }
    if (status !== "completed") {
      if (current.status === "completed") return;
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status,
          failReason: extras.failReason ?? null,
        },
      });
      return;
    }
    const shop = await tx.shop.findUnique({ where: { id: current.shopId } });
    if (!shop || shop.deletedAt) {
      throw new ApiError("not-found", "Shop not found.");
    }
    const appliedAt = new Date();
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "completed",
        appliedAt,
        failReason: null,
      },
    });
    if (current.purpose === "rent") {
      await applyRent(tx, shop, config, appliedAt);
      return;
    }
    await applySponsorship(tx, current, shop, appliedAt);
  });
  const updated = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!updated) throw new ApiError("not-found", "Payment not found.");
  return updated;
}

async function applyRent(
  tx: Prisma.TransactionClient,
  shop: Shop,
  config: PlatformConfig,
  appliedAt: Date,
): Promise<void> {
  const paidUntil = new Date(
    appliedAt.getTime() + config.rentDurationDays * 24 * 60 * 60 * 1000,
  );
  const next: Shop = { ...shop, rentPaid: true, rentPaidUntil: paidUntil };
  await tx.shop.update({
    where: { id: shop.id },
    data: {
      rentPaid: true,
      rentPaidUntil: paidUntil,
      lastPayment: appliedAt,
      visible: computeShopVisible(next, appliedAt),
    },
  });
}

async function applySponsorship(
  tx: Prisma.TransactionClient,
  payment: PaymentRecord,
  shop: Shop,
  appliedAt: Date,
): Promise<void> {
  const durationDays = payment.durationDays ?? 30;
  const endDate = new Date(appliedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
  await tx.sponsorship.upsert({
    where: { paymentId: payment.id },
    create: {
      paymentId: payment.id,
      shopId: payment.shopId,
      ownerId: payment.ownerUid,
      option: payment.sponsorOption,
      durationDays,
      price: payment.amount,
      currency: payment.currency,
      bannerImages: payment.bannerImages,
      status: "active",
      startDate: appliedAt,
      endDate,
    },
    update: {
      bannerImages: payment.bannerImages,
      status: "active",
      startDate: appliedAt,
      endDate,
    },
  });
  await tx.shop.update({
    where: { id: shop.id },
    data: {
      sponsored: true,
      sponsorEndDate: endDate,
      bannerImage: payment.bannerImages[0] ?? shop.facade ?? null,
    },
  });
}
