import type { Agent, Banner, Shop, Sponsorship } from "@prisma/client";
import {
  ApiError,
  asApiError,
  parseInput,
  requireAdmin,
  type HandlerRequest,
} from "../errors.js";
import {
  adminAgentIdSchema,
  adminAgentSchema,
  adminBannerIdSchema,
  adminBannerSchema,
  adminBrandingSchema,
  adminListSchema,
  adminMarkRentSchema,
  adminRentConfigSchema,
  adminShopStatusSchema,
  adminVerifyIdentitySchema,
  emptySchema,
} from "../schemas.js";
import { prisma } from "../prisma.js";
import {
  computeShopVisible,
  getPlatformConfig,
  getPrivateShopById,
  privateShop,
  toIso,
} from "../data.js";

function serializeAgent(agent: Agent): Record<string, unknown> {
  return {
    id: agent.id,
    name: agent.name,
    phone: agent.phone,
    code: agent.code,
    commission: agent.commission,
    active: agent.active,
    createdAt: toIso(agent.createdAt),
    updatedAt: toIso(agent.updatedAt),
  };
}

function serializeBanner(banner: Banner): Record<string, unknown> {
  return {
    id: banner.id,
    title: banner.title,
    subtitle: banner.subtitle,
    image: banner.image,
    link: banner.link,
    position: banner.position,
    active: banner.active,
    startsAt: toIso(banner.startsAt),
    endsAt: toIso(banner.endsAt),
    createdAt: toIso(banner.createdAt),
    updatedAt: toIso(banner.updatedAt),
  };
}

function serializeSponsorship(row: Sponsorship): Record<string, unknown> {
  return {
    id: row.id,
    paymentId: row.paymentId,
    shopId: row.shopId,
    ownerUid: row.ownerId,
    option: row.option,
    durationDays: row.durationDays,
    price: row.price,
    currency: row.currency,
    bannerImages: row.bannerImages,
    status: row.status,
    startDate: toIso(row.startDate),
    endDate: toIso(row.endDate),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function requireShop(shopId: string): Promise<Shop> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.deletedAt) {
    throw new ApiError("not-found", "Shop not found.");
  }
  return shop;
}

export async function adminListShops(request: HandlerRequest) {
  try {
    requireAdmin(request);
    const input = parseInput(adminListSchema, request.data);
    const shops = await prisma.shop.findMany({
      include: { products: { orderBy: { createdAt: "desc" }, take: 200 } },
      orderBy: { id: "asc" },
      take: input.limit,
      ...(input.cursor ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    return {
      shops: shops.map((shop) => privateShop(shop, shop.products)),
      nextCursor: shops.length === input.limit ? (shops.at(-1)?.id ?? null) : null,
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminBootstrap(request: HandlerRequest) {
  try {
    requireAdmin(request);
    parseInput(emptySchema, request.data);
    const [config, agents, banners, sponsorings] = await Promise.all([
      getPlatformConfig(),
      prisma.agent.findMany({ orderBy: { name: "asc" }, take: 200 }),
      prisma.banner.findMany({ orderBy: { position: "asc" }, take: 200 }),
      prisma.sponsorship.findMany({
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);
    return {
      config,
      agents: agents.map(serializeAgent),
      banners: banners.map(serializeBanner),
      sponsorings: sponsorings.map(serializeSponsorship),
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminSetShopStatus(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminShopStatusSchema, request.data);
    const shop = await requireShop(input.shopId);
    const next: Shop = { ...shop };
    if (input.decision) {
      next.approvalStatus = input.decision;
      next.approved = input.decision === "approved";
    }
    if (input.visible !== undefined) {
      next.adminVisible = input.visible;
    }
    if (input.sponsored !== undefined) {
      next.sponsored = input.sponsored;
      if (!input.sponsored) {
        next.sponsorEndDate = null;
        next.bannerImage = null;
      } else if (input.sponsorEndDate === undefined && !shop.sponsorEndDate) {
        const end = new Date();
        end.setUTCDate(end.getUTCDate() + 30);
        next.sponsorEndDate = end;
        next.bannerImage = shop.bannerImage ?? shop.facade ?? null;
      }
    }
    if (input.sponsorEndDate !== undefined) {
      next.sponsorEndDate = input.sponsorEndDate
        ? new Date(input.sponsorEndDate)
        : null;
    }
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        approvalStatus: next.approvalStatus,
        approved: next.approved,
        adminVisible: next.adminVisible,
        sponsored: next.sponsored,
        sponsorEndDate: next.sponsorEndDate,
        bannerImage: next.bannerImage,
        visible: computeShopVisible(next),
        lastModeratedBy: adminUid,
        lastModeratedAt: new Date(),
      },
    });
    return { shop: await getPrivateShopById(input.shopId) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminSetRentConfig(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminRentConfigSchema, request.data);
    await prisma.platformConfig.upsert({
      where: { id: "config" },
      create: {
        id: "config",
        rentAmount: input.rentAmount,
        rentDurationDays: input.rentDurationDays,
        sponsorPrice7: input.sponsorPrices?.["7days"],
        sponsorPrice15: input.sponsorPrices?.["15days"],
        sponsorPrice30: input.sponsorPrices?.["30days"],
        sponsorPrice60: input.sponsorPrices?.["60days"],
        updatedBy: adminUid,
      },
      update: {
        rentAmount: input.rentAmount,
        rentDurationDays: input.rentDurationDays,
        ...(input.sponsorPrices
          ? {
              sponsorPrice7: input.sponsorPrices["7days"],
              sponsorPrice15: input.sponsorPrices["15days"],
              sponsorPrice30: input.sponsorPrices["30days"],
              sponsorPrice60: input.sponsorPrices["60days"],
            }
          : {}),
        updatedBy: adminUid,
      },
    });
    return { config: await getPlatformConfig() };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminMarkRent(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminMarkRentSchema, request.data);
    const [config, shop] = await Promise.all([
      getPlatformConfig(),
      requireShop(input.shopId),
    ]);
    const paidUntil = input.paid
      ? input.paidUntil
        ? new Date(input.paidUntil)
        : new Date(Date.now() + config.rentDurationDays * 24 * 60 * 60 * 1000)
      : null;
    const next: Shop = { ...shop, rentPaid: input.paid, rentPaidUntil: paidUntil };
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        rentPaid: input.paid,
        rentPaidUntil: paidUntil,
        lastPayment: input.paid ? new Date() : null,
        visible: computeShopVisible(next),
        rentMarkedBy: adminUid,
        rentMarkedAt: new Date(),
      },
    });
    return { shop: await getPrivateShopById(input.shopId) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminVerifyIdentity(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminVerifyIdentitySchema, request.data);
    const shop = await requireShop(input.shopId);
    const next: Shop = { ...shop, idVerified: input.verified };
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        idVerified: input.verified,
        visible: computeShopVisible(next),
        identityVerifiedBy: adminUid,
        identityVerifiedAt: new Date(),
      },
    });
    return { shop: await getPrivateShopById(input.shopId) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminUpsertAgent(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminAgentSchema, request.data);
    const code = input.code.toUpperCase();
    const duplicate = await prisma.agent.findUnique({ where: { code } });
    if (duplicate && duplicate.id !== input.agentId) {
      throw new ApiError("already-exists", "This agent code is already in use.");
    }
    const agent = input.agentId
      ? await prisma.agent.update({
          where: { id: input.agentId },
          data: {
            name: input.name,
            phone: input.phone,
            code,
            commission: input.commission,
            active: input.active,
            updatedBy: adminUid,
          },
        })
      : await prisma.agent.create({
          data: {
            name: input.name,
            phone: input.phone,
            code,
            commission: input.commission,
            active: input.active,
            updatedBy: adminUid,
          },
        });
    return { agent: serializeAgent(agent) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminDeleteAgent(request: HandlerRequest) {
  try {
    requireAdmin(request);
    const { agentId } = parseInput(adminAgentIdSchema, request.data);
    await prisma.agent.deleteMany({ where: { id: agentId } });
    return { deleted: true };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminUpsertBanner(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminBannerSchema, request.data);
    const data = {
      title: input.title,
      subtitle: input.subtitle,
      image: input.image ?? null,
      link: input.link ?? null,
      position: input.position,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      updatedBy: adminUid,
    };
    const banner = input.bannerId
      ? await prisma.banner.update({ where: { id: input.bannerId }, data })
      : await prisma.banner.create({ data });
    return { banner: serializeBanner(banner) };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminDeleteBanner(request: HandlerRequest) {
  try {
    requireAdmin(request);
    const { bannerId } = parseInput(adminBannerIdSchema, request.data);
    await prisma.banner.deleteMany({ where: { id: bannerId } });
    return { deleted: true };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function adminSetPlatformBranding(request: HandlerRequest) {
  try {
    const adminUid = requireAdmin(request);
    const input = parseInput(adminBrandingSchema, request.data);
    await prisma.platformConfig.upsert({
      where: { id: "config" },
      create: {
        id: "config",
        platformLogo: input.platformLogo ?? null,
        updatedBy: adminUid,
      },
      update: {
        platformLogo: input.platformLogo ?? null,
        updatedBy: adminUid,
      },
    });
    return { config: await getPlatformConfig() };
  } catch (error) {
    throw asApiError(error);
  }
}
