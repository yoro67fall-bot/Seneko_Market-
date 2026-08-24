import type { HandlerRequest } from "../errors.js";
import { ApiError, asApiError, parseInput } from "../errors.js";
import { bootstrapPublicSchema, publicShopSchema, shopEventSchema } from "../schemas.js";
import { prisma } from "../prisma.js";
import {
  getPlatformConfig,
  isPublicShop,
  publicShop,
  syncShopVisibility,
  toIso,
} from "../data.js";
import { toPublicAssetUrl } from "../uploads.js";

export async function bootstrapPublic(request: HandlerRequest) {
  try {
    const input = parseInput(bootstrapPublicSchema, request.data);
    const now = new Date();
    await syncShopVisibility(now);
    const [config, banners, categoryBanners] = await Promise.all([
      getPlatformConfig(),
      prisma.banner.findMany({
        where: { active: true },
        orderBy: { position: "asc" },
        take: 50,
      }),
      prisma.categoryBanner.findMany({
        where: { active: true },
        orderBy: { position: "asc" },
        take: 100,
      }),
    ]);
    const adBanners = banners
      .filter((banner) => {
        if (banner.startsAt && banner.startsAt > now) return false;
        if (banner.endsAt && banner.endsAt <= now) return false;
        return true;
      })
      .map((banner) => ({
        id: banner.id,
        title: banner.title,
        subtitle: banner.subtitle,
        image: banner.image,
        link: banner.link,
        position: banner.position,
        startsAt: toIso(banner.startsAt),
        endsAt: toIso(banner.endsAt),
      }));

    const categoryBannerFeed = categoryBanners.map((banner) => ({
      id: banner.id,
      categoryName: banner.categoryName,
      description: banner.description,
      image: banner.image ? toPublicAssetUrl(banner.image) : null,
      link: banner.link,
      price: banner.price,
      active: banner.active,
      position: banner.position,
    }));

    const where = {
      deletedAt: null,
      approved: true,
      visible: true,
      rentPaid: true,
      ...(input.category ? { category: input.category } : {}),
      ...(input.shopId ? { id: input.shopId } : {}),
    };

    const shops = await prisma.shop.findMany({
      where,
      include: { products: { orderBy: { createdAt: "desc" }, take: 200 } },
      orderBy: { id: "asc" },
      take: input.limit,
      ...(input.cursor && !input.shopId ? { skip: 1, cursor: { id: input.cursor } } : {}),
    });
    const visible = shops.filter((shop) => isPublicShop(shop, now));
    return {
      config,
      shops: visible.map((shop) => publicShop(shop, shop.products, now)),
      adBanners,
      categoryBanners: categoryBannerFeed,
      nextCursor:
        !input.shopId && shops.length === input.limit
          ? (shops.at(-1)?.id ?? null)
          : null,
    };
  } catch (error) {
    throw asApiError(error);
  }
}

export async function getPublicShop(request: HandlerRequest) {
  try {
    const { shopId } = parseInput(publicShopSchema, request.data);
    const now = new Date();
    await syncShopVisibility(now);
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      include: { products: { orderBy: { createdAt: "desc" }, take: 200 } },
    });
    if (!shop || !isPublicShop(shop, now)) {
      throw new ApiError("not-found", "Shop not found.");
    }
    return { shop: publicShop(shop, shop.products, now) };
  } catch (error) {
    throw asApiError(error);
  }
}

const eventHits = new Map<string, number>();

function allowEvent(key: string, windowMs = 90_000): boolean {
  const now = Date.now();
  const previous = eventHits.get(key) ?? 0;
  if (now - previous < windowMs) return false;
  eventHits.set(key, now);
  if (eventHits.size > 20_000) {
    for (const [item, at] of eventHits) {
      if (now - at > windowMs) eventHits.delete(item);
    }
  }
  return true;
}

function utcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function recordShopEvent(request: HandlerRequest) {
  try {
    const input = parseInput(shopEventSchema, request.data);
    const shop = await prisma.shop.findUnique({ where: { id: input.shopId } });
    if (!shop || shop.deletedAt) {
      throw new ApiError("not-found", "Shop not found.");
    }
    if (request.auth?.uid && request.auth.uid === shop.ownerId) {
      return { counted: false };
    }
    const ip = (request.ip || "unknown").slice(0, 128);
    if (!allowEvent(`${shop.id}:${input.type}:${ip}`)) {
      return { counted: false };
    }
    const day = utcDay();
    await prisma.$transaction([
      prisma.shop.update({
        where: { id: shop.id },
        data:
          input.type === "visit"
            ? { visitCount: { increment: 1 } }
            : { contactCount: { increment: 1 } },
      }),
      prisma.shopEvent.upsert({
        where: {
          shopId_type_day: { shopId: shop.id, type: input.type, day },
        },
        create: { shopId: shop.id, type: input.type, day, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ]);
    return { counted: true };
  } catch (error) {
    throw asApiError(error);
  }
}
