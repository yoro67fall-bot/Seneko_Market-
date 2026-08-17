import { ApiError } from "./errors.js";
import type { Product, Shop, User, PlatformConfig as ConfigRow } from "@prisma/client";
import { prisma } from "./prisma.js";

export const DEFAULT_PLATFORM_CONFIG = {
  rentAmount: 5_000,
  rentDurationDays: 30,
  sponsorPrices: {
    "7days": 5_000,
    "15days": 8_000,
    "30days": 12_000,
    "60days": 20_000,
  },
  sponsorDurations: {
    "7days": 7,
    "15days": 15,
    "30days": 30,
    "60days": 60,
  },
  currency: "XOF" as const,
  platformLogo: null as string | null,
};

export type SponsorOption = keyof typeof DEFAULT_PLATFORM_CONFIG.sponsorPrices;

export interface PlatformConfig {
  rentAmount: number;
  rentDurationDays: number;
  sponsorPrices: Record<SponsorOption, number>;
  sponsorDurations: Record<SponsorOption, number>;
  currency: "XOF";
  platformLogo: string | null;
}

export function normalizeShopName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function normalizeWhatsApp(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function isRentCurrentlyPaid(
  shop: Pick<Shop, "rentPaid" | "rentPaidUntil">,
  now = new Date(),
): boolean {
  if (!shop.rentPaid) return false;
  if (!shop.rentPaidUntil) return true;
  if (shop.rentPaidUntil.valueOf() >= now.valueOf()) return true;
  return now.getUTCDate() <= 10;
}

export function computeShopVisible(shop: Shop, now = new Date()): boolean {
  return (
    shop.approved &&
    shop.idVerified &&
    shop.adminVisible &&
    isRentCurrentlyPaid(shop, now) &&
    !shop.deletedAt
  );
}

export function isPublicShop(shop: Shop, now = new Date()): boolean {
  return !shop.deletedAt && computeShopVisible(shop, now);
}

function isActiveThrough(value: Date | null, now = new Date()): boolean {
  return value !== null && value.valueOf() > now.valueOf();
}

export function publicProduct(product: Product): Record<string, unknown> {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    description: product.description,
    category: product.category,
    images: product.images,
    createdAt: toIso(product.createdAt),
    updatedAt: toIso(product.updatedAt),
  };
}

export function publicShop(
  shop: Shop,
  products: Product[],
  now = new Date(),
): Record<string, unknown> {
  const sponsored = shop.sponsored && isActiveThrough(shop.sponsorEndDate, now);
  return {
    id: shop.id,
    name: shop.name,
    category: shop.category,
    description: shop.description,
    phone: shop.phone,
    whatsapp: shop.whatsapp,
    email: shop.email,
    logo: shop.logo ?? shop.name.charAt(0).toUpperCase(),
    icon: shop.icon,
    facade: shop.facade,
    rentPaid: shop.rentPaid,
    rentPaidUntil: toIso(shop.rentPaidUntil),
    approved: shop.approved,
    visible: shop.visible,
    sponsored,
    sponsorEndDate: sponsored ? toIso(shop.sponsorEndDate) : null,
    lastPayment: toIso(shop.lastPayment),
    bannerImage: sponsored ? shop.bannerImage : null,
    products: products.map(publicProduct),
  };
}

export function privateShop(
  shop: Shop,
  products: Product[],
): Record<string, unknown> {
  return {
    ...publicShop(shop, products),
    ownerUid: shop.ownerId,
    adminVisible: shop.adminVisible,
    approvalStatus: shop.approvalStatus,
    idCardPath: shop.idCardPath,
    idVerified: shop.idVerified,
    openingFor: shop.openingFor,
    agentCode: shop.agentCode,
    deletedAt: toIso(shop.deletedAt),
    createdAt: toIso(shop.createdAt),
    updatedAt: toIso(shop.updatedAt),
  };
}

export function serializeProfile(user: User | null): Record<string, unknown> | null {
  if (!user) return null;
  return {
    uid: user.id,
    firstname: user.firstname,
    lastname: user.lastname,
    phone: user.phone,
    email: user.email,
    role: user.role,
    shopId: null,
    onboardingCompleted: user.onboardingCompleted,
    createdAt: toIso(user.createdAt),
    updatedAt: toIso(user.updatedAt),
  };
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const row =
    (await prisma.platformConfig.findUnique({ where: { id: "config" } })) ??
    (await prisma.platformConfig.create({ data: { id: "config" } }));
  return fromConfigRow(row);
}

export function fromConfigRow(row: ConfigRow): PlatformConfig {
  return {
    rentAmount: row.rentAmount,
    rentDurationDays: row.rentDurationDays,
    sponsorPrices: {
      "7days": row.sponsorPrice7,
      "15days": row.sponsorPrice15,
      "30days": row.sponsorPrice30,
      "60days": row.sponsorPrice60,
    },
    sponsorDurations: { ...DEFAULT_PLATFORM_CONFIG.sponsorDurations },
    currency: "XOF",
    platformLogo: row.platformLogo,
  };
}

export async function getPrivateShopById(
  shopId: string,
): Promise<Record<string, unknown> | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: { products: { orderBy: { createdAt: "desc" }, take: 200 } },
  });
  if (!shop) return null;
  return privateShop(shop, shop.products);
}

export async function serializeProfileWithShop(
  userId: string,
  shop?: Shop | null,
): Promise<Record<string, unknown> | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const serialized = serializeProfile(user);
  if (!serialized) return null;
  serialized.shopId = shop?.id ?? (await prisma.shop.findUnique({ where: { ownerId: userId } }))?.id ?? null;
  return serialized;
}

export async function assertShopOwner(uid: string, shopId: string): Promise<Shop> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.deletedAt) {
    throw new ApiError("not-found", "Shop not found.");
  }
  if (shop.ownerId !== uid) {
    throw new ApiError("permission-denied", "You do not own this shop.");
  }
  return shop;
}
