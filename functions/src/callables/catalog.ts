import type { HandlerRequest } from "../errors.js";
import { ApiError, asApiError, parseInput } from "../errors.js";
import { bootstrapPublicSchema, publicShopSchema } from "../schemas.js";
import { prisma } from "../prisma.js";
import {
  getPlatformConfig,
  isPublicShop,
  publicShop,
  toIso,
} from "../data.js";

export async function bootstrapPublic(request: HandlerRequest) {
  try {
    const input = parseInput(bootstrapPublicSchema, request.data);
    const now = new Date();
    const [config, banners] = await Promise.all([
      getPlatformConfig(),
      prisma.banner.findMany({
        where: { active: true },
        orderBy: { position: "asc" },
        take: 50,
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
