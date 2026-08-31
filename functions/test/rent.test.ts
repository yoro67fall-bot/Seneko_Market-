import { describe, expect, it } from "vitest";
import {
  computeShopVisible,
  isRentCurrentlyPaid,
  RENT_GRACE_DAY_OF_MONTH,
} from "../src/data.js";
import type { Shop } from "@prisma/client";

function baseShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: "shop-1",
    ownerId: "owner-1",
    name: "Test Shop",
    nameNormalized: "test-shop",
    category: "Mode",
    description: "Test",
    phone: "+22100000000",
    whatsapp: "+22100000000",
    email: null,
    logo: "T",
    icon: "fa-store",
    facade: null,
    idCardPath: "identity/owner-1/id.jpg",
    idVerified: true,
    openingFor: "myself",
    agentCode: null,
    approvalStatus: "approved",
    approved: true,
    adminVisible: true,
    visible: true,
    rentPaid: true,
    rentPaidUntil: new Date("2026-08-01T00:00:00.000Z"),
    lastPayment: null,
    sponsored: false,
    sponsorEndDate: null,
    bannerImage: null,
    deletedAt: null,
    lastModeratedBy: null,
    lastModeratedAt: null,
    identityVerifiedBy: null,
    identityVerifiedAt: null,
    rentMarkedBy: null,
    rentMarkedAt: null,
    visitCount: 0,
    contactCount: 0,
    countryCode: "SN",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("isRentCurrentlyPaid", () => {
  it("returns false when rent is marked unpaid", () => {
    const shop = baseShop({ rentPaid: false });
    expect(isRentCurrentlyPaid(shop, new Date("2026-08-05T12:00:00.000Z"))).toBe(false);
  });

  it("keeps grace until the 10th after rentPaidUntil expires", () => {
    const shop = baseShop({
      rentPaid: true,
      rentPaidUntil: new Date("2026-08-01T00:00:00.000Z"),
    });
    expect(isRentCurrentlyPaid(shop, new Date("2026-08-09T12:00:00.000Z"))).toBe(true);
    expect(isRentCurrentlyPaid(shop, new Date("2026-08-11T12:00:00.000Z"))).toBe(false);
  });

  it("treats rent as paid while rentPaidUntil is in the future", () => {
    const shop = baseShop({
      rentPaid: true,
      rentPaidUntil: new Date("2026-09-15T00:00:00.000Z"),
    });
    expect(isRentCurrentlyPaid(shop, new Date("2026-08-20T12:00:00.000Z"))).toBe(true);
  });
});

describe("computeShopVisible", () => {
  it("hides the shop after the grace period when rent is overdue", () => {
    const shop = baseShop({
      rentPaid: true,
      rentPaidUntil: new Date("2026-08-01T00:00:00.000Z"),
      visible: true,
    });
    expect(
      computeShopVisible(shop, new Date(`2026-08-${RENT_GRACE_DAY_OF_MONTH + 1}T12:00:00.000Z`)),
    ).toBe(false);
  });

  it("shows the shop again once rent is paid", () => {
    const shop = baseShop({
      rentPaid: true,
      rentPaidUntil: new Date("2026-09-15T00:00:00.000Z"),
      visible: false,
    });
    expect(computeShopVisible(shop, new Date("2026-08-12T12:00:00.000Z"))).toBe(true);
  });
});
